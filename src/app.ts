import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyRequest } from "fastify";
import type pg from "pg";
import QRCode from "qrcode";
import { ZodError, z } from "zod";
import { authenticate, authenticateOperator, requireOperator, requireTenant } from "./auth.js";
import type { Config } from "./config.js";
import { decrypt } from "./domain/crypto.js";
import { AppError } from "./errors.js";
import { registry } from "./metrics.js";
import type { RewardPaymentProvider } from "./providers/provider.js";
import { LiquidityService } from "./services/liquidity-service.js";
import { OperationWorker } from "./services/operation-worker.js";
import { OperatorService } from "./services/operator-service.js";
import { RetentionService } from "./services/retention-service.js";
import { RewardService } from "./services/reward-service.js";
import { WebhookService } from "./services/webhook-service.js";

const rewardInput = z
  .object({
    amount: z.string().min(3).max(64),
    description: z.string().trim().min(1).max(256),
    external_reference: z.string().trim().min(1).max(128).optional(),
    metadata: z
      .record(z.string().max(64), z.union([z.string().max(512), z.number(), z.boolean(), z.null()]))
      .optional(),
    expires_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Buffer.byteLength(JSON.stringify(value.metadata ?? {})) > 4096)
      context.addIssue({
        code: "custom",
        path: ["metadata"],
        message: "metadata exceeds 4096 bytes",
      });
  });

const webhookInput = z
  .object({ url: z.url().max(2048), description: z.string().max(120).optional() })
  .strict();
const webhookPatch = z
  .object({
    url: z.url().max(2048).optional(),
    description: z.string().max(120).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0);

export function buildApp(pool: pg.Pool, config: Config, provider: RewardPaymentProvider) {
  const app = Fastify({
    bodyLimit: 16 * 1024,
    requestIdHeader: "x-request-id",
    trustProxy: false,
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.url",
          "res.headers.location",
          "claim_url",
          "taler_uri",
          "secret",
        ],
        censor: "[REDACTED]",
      },
    },
  });
  const rewards = new RewardService(pool, config, provider);
  const webhooks = new WebhookService(pool, config);
  const operators = new OperatorService(pool);
  const liquidity = new LiquidityService(pool, config, provider);
  const retention = new RetentionService(pool, config);

  app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'unsafe-inline'"],
        formAction: ["'self'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  });
  app.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply
      .header("x-request-id", request.id)
      .header(
        "cache-control",
        request.url.startsWith("/claim/") ? "no-store, max-age=0" : "no-store",
      );
    if (request.url.startsWith("/claim/"))
      reply.header("permissions-policy", "camera=(), geolocation=(), microphone=(), payment=()");
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const appError = normalizeError(error);
    if (appError.status >= 500)
      request.log.error({ err: error, code: appError.code }, "request_failed");
    else request.log.info({ code: appError.code }, "request_rejected");
    void reply.status(appError.status).send({
      error: {
        code: appError.code,
        message: appError.message,
        request_id: request.id,
        ...(appError.details ? { details: appError.details } : {}),
      },
    });
  });

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      const snapshots = await liquidity.latest();
      if (
        config.LIQUIDITY_FAIL_CLOSED &&
        (snapshots.length < config.supportedCurrencies.size ||
          snapshots.some((snapshot) => snapshot.status !== "ok"))
      )
        throw new Error("liquidity snapshot is missing, stale, or below the funding floor");
      return {
        status: "ready",
        database: "ok",
        provider: config.LIQUIDITY_FAIL_CLOSED ? "ok" : "not_checked",
        liquidity: config.LIQUIDITY_FAIL_CLOSED ? "ok" : "not_enforced",
      };
    } catch {
      return reply.status(503).send({
        status: "not_ready",
        database: "unknown",
        provider: "unavailable",
        liquidity: "unavailable",
      });
    }
  });
  app.get("/version", async () => ({
    name: "libreward-bridge",
    version: "0.1.0",
    api: "v1",
    taler_flow: "wallet-core-peer-push",
  }));
  app.get("/metrics", async (_request, reply) => {
    if (!config.METRICS_ENABLED) throw new AppError(404, "not_found", "Resource not found");
    return reply.type(registry.contentType).send(await registry.metrics());
  });

  app.post(
    "/v1/rewards",
    { preHandler: authenticate(pool, config, "rewards:write") },
    async (request, reply) => {
      const key = z
        .string()
        .min(8)
        .max(128)
        .regex(/^[A-Za-z0-9._:-]+$/)
        .parse(request.headers["idempotency-key"]);
      const result = await rewards.create(
        requireTenant(request),
        key,
        rewardInput.parse(request.body),
      );
      return reply.status(result.idempotent ? 200 : 201).send(result);
    },
  );

  const operatorRate = {
    config: { rateLimit: { max: config.OPERATOR_RATE_LIMIT_MAX, timeWindow: "1 minute" } },
  };
  app.get(
    "/v1/operator/rewards/:reference",
    {
      ...operatorRate,
      preHandler: authenticateOperator(pool, config, "operator:read"),
    },
    async (request) => {
      const operator = requireOperator(request);
      const reference = referenceParam(request);
      const result = await operators.reward(reference);
      await operators.audit(operator, "reward.read", "reward", result.public_id, request.id);
      return result;
    },
  );
  app.get(
    "/v1/operator/rewards/:reference/events",
    {
      ...operatorRate,
      preHandler: authenticateOperator(pool, config, "operator:read"),
    },
    async (request) => {
      const operator = requireOperator(request);
      const reference = referenceParam(request);
      const reward = await operators.reward(reference);
      const result = await operators.events(reference);
      await operators.audit(operator, "reward.events.read", "reward", reward.public_id, request.id);
      return result;
    },
  );
  app.get(
    "/v1/operator/rewards/:reference/webhook-deliveries",
    {
      ...operatorRate,
      preHandler: authenticateOperator(pool, config, "operator:read"),
    },
    async (request) => {
      const operator = requireOperator(request);
      const reference = referenceParam(request);
      const reward = await operators.reward(reference);
      const result = await operators.deliveries(reference);
      await operators.audit(
        operator,
        "webhook.deliveries.read",
        "reward",
        reward.public_id,
        request.id,
      );
      return result;
    },
  );
  app.post(
    "/v1/operator/rewards/:reference/reconcile",
    {
      ...operatorRate,
      preHandler: authenticateOperator(pool, config, "operator:reconcile"),
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const reference = referenceParam(request);
      const reward = await operators.reward(reference);
      const found = await new OperationWorker(pool, config, provider).reconcileOne(
        reward.public_id,
      );
      if (!found)
        throw new AppError(409, "operation_not_reconcilable", "No reconcilable operation found");
      await operators.audit(operator, "reward.reconcile", "reward", reward.public_id, request.id);
      return reply.status(202).send({ status: "reconciled" });
    },
  );
  app.post(
    "/v1/operator/webhook-deliveries/:id/retry",
    {
      ...operatorRate,
      preHandler: authenticateOperator(pool, config, "operator:webhook-retry"),
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const id = idParam(request);
      await operators.retryDelivery(id);
      await operators.audit(operator, "webhook.retry", "webhook_delivery", id, request.id);
      return reply.status(202).send({ status: "queued" });
    },
  );
  app.get(
    "/v1/operator/liquidity",
    {
      ...operatorRate,
      preHandler: authenticateOperator(pool, config, "operator:read"),
    },
    async (request) => {
      const operator = requireOperator(request);
      const data = await liquidity.latest();
      await operators.audit(operator, "liquidity.read", "wallet", null, request.id);
      return { data };
    },
  );
  app.post(
    "/v1/operator/liquidity/check",
    {
      ...operatorRate,
      preHandler: authenticateOperator(pool, config, "operator:liquidity-check"),
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const queued = await liquidity.requestCheck(operator.id);
      await operators.audit(operator, "liquidity.check.request", "wallet", null, request.id, {
        liquidity_request_id: queued.request_id,
      });
      return reply.status(202).send(queued);
    },
  );
  app.post(
    "/v1/operator/retention/run",
    {
      ...operatorRate,
      preHandler: authenticateOperator(pool, config, "operator:retention-run"),
    },
    async (request) => {
      const operator = requireOperator(request);
      const input = z
        .object({ dry_run: z.boolean().default(true) })
        .strict()
        .parse(request.body ?? {});
      const result = await retention.run("operator", input.dry_run);
      await operators.audit(operator, "retention.run", "retention", null, request.id, {
        dry_run: input.dry_run,
        result,
      });
      return { dry_run: input.dry_run, result };
    },
  );
  app.get(
    "/v1/operator/audit-events",
    {
      ...operatorRate,
      preHandler: authenticateOperator(pool, config, "operator:audit-read"),
    },
    async (request) => {
      const operator = requireOperator(request);
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          before: z.iso.datetime({ offset: true }).optional(),
        })
        .parse(request.query);
      const result = await operators.auditEvents(query.limit, query.before);
      await operators.audit(operator, "audit.read", "operator_audit", null, request.id);
      return result;
    },
  );
  app.get(
    "/v1/rewards/:id",
    { preHandler: authenticate(pool, config, "rewards:read") },
    async (request) => {
      const id = idParam(request);
      return rewards.get(requireTenant(request), id);
    },
  );
  app.post(
    "/v1/rewards/:id/cancel",
    { preHandler: authenticate(pool, config, "rewards:write") },
    async (request) => rewards.cancel(requireTenant(request), idParam(request)),
  );
  app.post(
    "/v1/rewards/:id/regenerate-claim",
    { preHandler: authenticate(pool, config, "rewards:write") },
    async (request) => rewards.regenerateClaim(requireTenant(request), idParam(request)),
  );
  app.get(
    "/v1/rewards/:id/events",
    { preHandler: authenticate(pool, config, "rewards:read") },
    async (request) => {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cursor: z.string().max(128).optional(),
        })
        .parse(request.query);
      return rewards.events(requireTenant(request), idParam(request), query.limit, query.cursor);
    },
  );

  app.post(
    "/v1/webhook-endpoints",
    { preHandler: authenticate(pool, config, "webhooks:write") },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await webhooks.createEndpoint(requireTenant(request), webhookInput.parse(request.body)),
        ),
  );
  app.get(
    "/v1/webhook-endpoints",
    { preHandler: authenticate(pool, config, "webhooks:read") },
    async (request) => ({ data: await webhooks.listEndpoints(requireTenant(request)) }),
  );
  app.patch(
    "/v1/webhook-endpoints/:id",
    { preHandler: authenticate(pool, config, "webhooks:write") },
    async (request) =>
      webhooks.updateEndpoint(
        requireTenant(request),
        idParam(request),
        webhookPatch.parse(request.body),
      ),
  );
  app.delete(
    "/v1/webhook-endpoints/:id",
    { preHandler: authenticate(pool, config, "webhooks:write") },
    async (request, reply) => {
      await webhooks.deleteEndpoint(requireTenant(request), idParam(request));
      return reply.status(204).send();
    },
  );
  app.post(
    "/v1/webhook-endpoints/:id/test",
    { preHandler: authenticate(pool, config, "webhooks:write") },
    async (request, reply) =>
      reply.status(202).send(await webhooks.queueTest(requireTenant(request), idParam(request))),
  );

  const claimRate = {
    config: { rateLimit: { max: config.CLAIM_RATE_LIMIT_MAX, timeWindow: "1 minute" } },
  };
  app.get("/claim/:token", claimRate, async (request, reply) => {
    const token = tokenParam(request);
    const reward = await rewards.claimInfo(token);
    return reply.type("text/html; charset=utf-8").send(claimPage(reward, token));
  });
  app.post("/claim/:token/start", claimRate, async (request, reply) => {
    const token = tokenParam(request);
    const result = await rewards.startClaim(token);
    if ((request.headers.accept ?? "").includes("text/html"))
      return reply
        .status(303)
        .header("location", `/claim/${encodeURIComponent(token)}/status`)
        .send();
    return reply.status(202).send(result);
  });
  app.get("/claim/:token/status", claimRate, async (request, reply) => {
    const token = tokenParam(request);
    const result = await rewards.claimStatus(token, (ciphertext) =>
      decrypt(config.encryptionKey, ciphertext),
    );
    if (!(request.headers.accept ?? "").includes("text/html")) return result;
    const qr = result.taler_uri
      ? await QRCode.toDataURL(result.taler_uri, {
          margin: 1,
          width: 280,
          errorCorrectionLevel: "M",
        })
      : null;
    return reply.type("text/html; charset=utf-8").send(statusPage(result, token, qr));
  });
  return app;
}

function idParam(request: FastifyRequest): string {
  return z.object({ id: z.string().min(4).max(64) }).parse(request.params).id;
}
function referenceParam(request: FastifyRequest): string {
  return z.object({ reference: z.string().min(4).max(128) }).parse(request.params).reference;
}
function tokenParam(request: FastifyRequest): string {
  return z
    .object({
      token: z
        .string()
        .length(43)
        .regex(/^[A-Za-z0-9_-]+$/),
    })
    .parse(request.params).token;
}
function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError)
    return new AppError(422, "validation_error", "Request validation failed", {
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  return new AppError(500, "internal_error", "An internal error occurred");
}
// biome-ignore lint/suspicious/noShadowRestrictedNames: local HTML encoder; it is never used for URI encoding.
function escape(value: unknown): string {
  return String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ??
      character,
  );
}
function shell(title: string, body: string, refresh?: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ""}<title>${escape(title)} — LibreReward</title><style>:root{color-scheme:dark light;font:16px system-ui}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#10141f;color:#eef2ff}.card{width:min(92vw,34rem);padding:2rem;border:1px solid #394159;border-radius:1rem;background:#191f2d;box-shadow:0 1rem 3rem #0005}h1{margin-top:0}.amount{font-size:2rem;font-weight:750;color:#76e0b5}.muted{color:#b5bdd0}.button{display:inline-block;border:0;border-radius:.65rem;background:#76e0b5;color:#07140f;padding:.8rem 1.15rem;font:inherit;font-weight:700;cursor:pointer}img{max-width:100%;background:white;border-radius:.5rem;padding:.5rem}a{color:#76e0b5;overflow-wrap:anywhere}@media(prefers-color-scheme:light){body{background:#f4f6fb;color:#172033}.card{background:white;border-color:#d9deea}.muted{color:#566078}}</style></head><body><main class="card">${body}</main></body></html>`;
}
function claimPage(reward: Record<string, unknown>, token: string): string {
  const disabled = reward.status !== "claimable";
  return shell(
    "Claim reward",
    `<p class="muted">LibreReward Bridge</p><h1>Claim reward</h1><p class="amount">${escape(reward.amount)}</p><p>${escape(reward.description)}</p><p class="muted">Expires ${escape(reward.expires_at)}</p><p>Status: <strong>${escape(reward.status)}</strong></p>${disabled ? "<p>This reward cannot be started.</p>" : `<form method="post" action="/claim/${encodeURIComponent(token)}/start"><button class="button" type="submit">Continue to GNU Taler</button></form>`}<p class="muted">No account or personal information is required.</p>`,
  );
}
function statusPage(result: Record<string, unknown>, token: string, qr: string | null): string {
  const uri = typeof result.taler_uri === "string" ? result.taler_uri : null;
  const pending = result.status === "claim_in_progress" && !uri;
  return shell(
    "Reward status",
    `<p class="muted">LibreReward Bridge</p><h1>Reward status</h1><p class="amount">${escape(result.amount)}</p><p>Status: <strong>${escape(result.status)}</strong></p>${uri ? `<p><a class="button" href="${escape(uri)}">Open GNU Taler wallet</a></p>${qr ? `<img alt="QR code for the GNU Taler claim" src="${qr}">` : ""}<p class="muted">The QR code contains a bearer payment URI. Do not share it.</p>` : pending ? "<p>Preparing the one-time wallet claim…</p>" : ""}`,
    pending ? `2;url=/claim/${encodeURIComponent(token)}/status` : undefined,
  );
}
