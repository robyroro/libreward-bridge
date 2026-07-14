import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createPool, migrate } from "../../src/db.js";
import { keyedHash } from "../../src/domain/crypto.js";
import { publicId, randomSecret, uuid } from "../../src/domain/ids.js";
import { verifyWebhookSignature } from "../../src/domain/webhook-signing.js";
import { MockProvider } from "../../src/providers/mock-provider.js";
import type { RewardPaymentProvider } from "../../src/providers/provider.js";
import { LiquidityService } from "../../src/services/liquidity-service.js";
import { OperationWorker } from "../../src/services/operation-worker.js";
import { serializedProviderCall } from "../../src/services/provider-lock.js";
import { RetentionService } from "../../src/services/retention-service.js";
import { WebhookService } from "../../src/services/webhook-service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("PostgreSQL reward flow", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    LIBREREWARD_ENV: "test",
    LIBREREWARD_PUBLIC_URL: "http://localhost:8080",
    DATABASE_URL: databaseUrl ?? "postgres://unused:unused@localhost/unused",
    API_KEY_HASH_SECRET: "a".repeat(32),
    OPERATOR_API_KEY_HASH_SECRET: "o".repeat(32),
    CLAIM_TOKEN_HASH_SECRET: "c".repeat(32),
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
    PROVIDER: "mock",
    WEBHOOK_ALLOW_PRIVATE: "true",
    LOG_LEVEL: process.env.INTEGRATION_LOG_LEVEL ?? "silent",
  });
  const pool = createPool(config.DATABASE_URL);
  const provider = new MockProvider();
  const app = buildApp(pool, config, provider);
  let key = "";
  let otherKey = "";
  let adminKey = "";
  let viewerKey = "";
  let webhookServer: Server | undefined;

  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await migrate(pool);
    key = await tenant("A");
    otherKey = await tenant("B");
    adminKey = await operator("Admin", "admin");
    viewerKey = await operator("Viewer", "viewer");
    await app.ready();
  });
  afterAll(async () => {
    if (webhookServer?.listening)
      await new Promise<void>((resolve, reject) =>
        webhookServer?.close((error) => (error ? reject(error) : resolve())),
      );
    await app.close();
    await pool.end();
  });

  it("prevents 50 concurrent duplicate creations and claims", async () => {
    const payload = {
      amount: "KUDOS:2.00000001",
      description: "Research participation",
      external_reference: "survey-42",
    };
    const creations = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({
          method: "POST",
          url: "/v1/rewards",
          headers: {
            authorization: `Bearer ${key}`,
            "idempotency-key": "survey-42",
            "content-type": "application/json",
          },
          payload,
        }),
      ),
    );
    const creationFailures = creations
      .filter((response) => ![200, 201].includes(response.statusCode))
      .map((response) => ({ status: response.statusCode, body: response.json() }));
    expect(creationFailures, JSON.stringify(creationFailures)).toEqual([]);
    const bodies = creations.map((response) => response.json<{ id: string; claim_url: string }>());
    expect(new Set(bodies.map((body) => body.id)).size).toBe(1);
    expect((await pool.query("SELECT count(*) FROM rewards")).rows[0].count).toBe(1n);
    const token = bodies[0]?.claim_url.split("/").at(-1) as string;

    const claims = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({ method: "POST", url: `/claim/${token}/start` }),
      ),
    );
    expect(claims.every((response) => response.statusCode === 202)).toBe(true);
    expect((await pool.query("SELECT count(*) FROM provider_operations")).rows[0].count).toBe(1n);

    const worker = new OperationWorker(pool, config, provider);
    expect(await worker.runOne()).toBe(true);
    expect(provider.effects.size).toBe(1);
    const externalId = [...provider.effects.values()][0]?.externalOperationId as string;
    provider.complete(externalId);
    expect(await new OperationWorker(pool, config, provider).reconcileOne()).toBe(true);
    const status = await app.inject({
      method: "GET",
      url: `/claim/${token}/status`,
      headers: { accept: "application/json" },
    });
    expect(status.json<{ status: string }>().status).toBe("claimed");
  });

  it("rejects idempotency key reuse with a different body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/rewards",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": "survey-42" },
      payload: { amount: "KUDOS:3", description: "Different" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("idempotency_conflict");
  });

  it("cancels before claim start without creating a provider operation", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/rewards",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": "cancel-before-claim" },
      payload: {
        amount: "KUDOS:1",
        description: "Cancellation evidence",
        external_reference: "cancel-before-claim",
      },
    });
    expect(created.statusCode).toBe(201);
    const reward = created.json<{ id: string; claim_url: string }>();
    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/rewards/${reward.id}/cancel`,
      headers: { authorization: `Bearer ${key}` },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<{ status: string }>().status).toBe("cancelled");
    expect(
      (
        await pool.query(
          `SELECT count(*) FROM provider_operations po JOIN rewards r ON r.id=po.reward_id
           WHERE r.public_id=$1`,
          [reward.id],
        )
      ).rows[0].count,
    ).toBe(0n);
    const token = reward.claim_url.split("/").at(-1) as string;
    expect((await app.inject({ method: "POST", url: `/claim/${token}/start` })).statusCode).toBe(
      404,
    );
  });

  it("makes provider cancellation after claim start terminal and observable", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/rewards",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": "provider-cancelled" },
      payload: {
        amount: "KUDOS:1",
        description: "Provider cancellation evidence",
        external_reference: "provider-cancelled",
      },
    });
    const reward = created.json<{ id: string; claim_url: string }>();
    const token = reward.claim_url.split("/").at(-1) as string;
    expect((await app.inject({ method: "POST", url: `/claim/${token}/start` })).statusCode).toBe(
      202,
    );
    const cancelledProvider: RewardPaymentProvider = {
      key: "cancelled-fixture",
      verifyConfiguration: async () => undefined,
      getBalances: async () => ({ balances: [], haveProductionBalance: false }),
      createRewardOperation: async () => ({
        state: "cancelled",
        externalOperationId: "txn:peer-push-debit:cancelled",
      }),
      getOperationStatus: async () => ({ state: "cancelled" }),
      cancelOperation: async () => ({ state: "cancelled" }),
    };
    expect(await new OperationWorker(pool, config, cancelledProvider).runOne()).toBe(true);
    const persisted = (
      await pool.query<{ reward_status: string; provider_state: string }>(
        `SELECT r.status AS reward_status,po.state AS provider_state FROM rewards r
         JOIN provider_operations po ON po.reward_id=r.id WHERE r.public_id=$1`,
        [reward.id],
      )
    ).rows[0];
    expect(persisted).toEqual({ reward_status: "failed", provider_state: "cancelled" });
  });

  it("enforces tenant resource isolation", async () => {
    const reward = (
      await pool.query<{ public_id: string }>("SELECT public_id FROM rewards LIMIT 1")
    ).rows[0];
    const response = await app.inject({
      method: "GET",
      url: `/v1/rewards/${reward?.public_id}`,
      headers: { authorization: `Bearer ${otherKey}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it("delivers a signed webhook and records the delivery", async () => {
    let resolveDelivery:
      | ((delivery: { body: string; headers: Record<string, string> }) => void)
      | undefined;
    const delivered = new Promise<{ body: string; headers: Record<string, string> }>((resolve) => {
      resolveDelivery = resolve;
    });
    webhookServer = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        resolveDelivery?.({
          body: Buffer.concat(chunks).toString("utf8"),
          headers: Object.fromEntries(
            Object.entries(request.headers).flatMap(([name, value]) =>
              typeof value === "string" ? [[name, value]] : [],
            ),
          ),
        });
        response.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      webhookServer?.once("error", reject).listen(0, "127.0.0.1", resolve);
    });
    const port = (webhookServer.address() as AddressInfo).port;

    const endpointResponse = await app.inject({
      method: "POST",
      url: "/v1/webhook-endpoints",
      headers: { authorization: `Bearer ${key}` },
      payload: { url: `http://127.0.0.1:${port}/events`, description: "integration" },
    });
    expect(endpointResponse.statusCode).toBe(201);
    const endpoint = endpointResponse.json<{ public_id: string; secret: string }>();
    const queued = await app.inject({
      method: "POST",
      url: `/v1/webhook-endpoints/${endpoint.public_id}/test`,
      headers: { authorization: `Bearer ${key}` },
    });
    expect(queued.statusCode).toBe(202);

    expect(await new WebhookService(pool, config).deliverOne()).toBe(true);
    const received = await delivered;
    const timestamp = received.headers["x-libreward-timestamp"] as string;
    const signature = received.headers["x-libreward-signature"] as string;
    const eventId = received.headers["x-libreward-event-id"] as string;
    expect(
      verifyWebhookSignature(
        endpoint.secret,
        timestamp,
        received.body,
        signature,
        Math.floor(Date.now() / 1000),
      ),
    ).toBe(true);
    expect(JSON.parse(received.body).id).toBe(eventId);
    expect(
      (await pool.query("SELECT status FROM webhook_deliveries ORDER BY created_at DESC LIMIT 1"))
        .rows[0]?.status,
    ).toBe("delivered");
  });

  it("enforces separate operator RBAC and records audited operations", async () => {
    const reward = (
      await pool.query<{ public_id: string }>(
        "SELECT public_id FROM rewards ORDER BY created_at LIMIT 1",
      )
    ).rows[0]?.public_id as string;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/operator/rewards/${reward}`,
          headers: { authorization: `Bearer ${key}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/operator/rewards/${reward}`,
          headers: { authorization: `Bearer ${adminKey}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/operator/rewards/${reward}/reconcile`,
          headers: { authorization: `Bearer ${viewerKey}` },
        })
      ).statusCode,
    ).toBe(403);
    const checked = await app.inject({
      method: "POST",
      url: "/v1/operator/liquidity/check",
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(checked.statusCode).toBe(202);
    expect(await new LiquidityService(pool, config, provider).runRequestedCheck()).toBe(true);
    const liquidity = await app.inject({
      method: "GET",
      url: "/v1/operator/liquidity",
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(liquidity.json<{ data: Array<{ currency: string; status: string }> }>().data).toEqual(
      expect.arrayContaining([expect.objectContaining({ currency: "KUDOS", status: "ok" })]),
    );
    const audit = await app.inject({
      method: "GET",
      url: "/v1/operator/audit-events",
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(audit.statusCode).toBe(200);
    expect(
      audit.json<{ data: Array<{ action: string }> }>().data.map((item) => item.action),
    ).toEqual(expect.arrayContaining(["reward.read", "liquidity.check.request"]));
    await expect(
      pool.query(
        "UPDATE operator_audit_events SET action='tampered' WHERE event_id=(SELECT event_id FROM operator_audit_events LIMIT 1)",
      ),
    ).rejects.toThrow(/append-only/);
    await pool.query("UPDATE operator_accounts SET role='viewer' WHERE display_name='Admin'");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/operator/audit-events",
          headers: { authorization: `Bearer ${adminKey}` },
        })
      ).statusCode,
    ).toBe(403);
    await pool.query("UPDATE operator_accounts SET role='admin' WHERE display_name='Admin'");
  });

  it("enforces an atomic per-currency daily payout limit", async () => {
    const limitedConfig = loadConfig({
      NODE_ENV: "test",
      LIBREREWARD_ENV: "test",
      LIBREREWARD_PUBLIC_URL: "http://localhost:8080",
      DATABASE_URL: config.DATABASE_URL,
      API_KEY_HASH_SECRET: "a".repeat(32),
      OPERATOR_API_KEY_HASH_SECRET: "o".repeat(32),
      CLAIM_TOKEN_HASH_SECRET: "c".repeat(32),
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
      PROVIDER: "mock",
      SUPPORTED_CURRENCIES: "KUDOS,TESTKUDOS",
      DAILY_PAYOUT_LIMITS: "TESTKUDOS:1",
      LOG_LEVEL: "silent",
    });
    const limitedApp = buildApp(pool, limitedConfig, new MockProvider());
    await limitedApp.ready();
    try {
      const tokens: string[] = [];
      for (const suffix of ["a", "b"]) {
        const created = await limitedApp.inject({
          method: "POST",
          url: "/v1/rewards",
          headers: {
            authorization: `Bearer ${key}`,
            "idempotency-key": `daily-limit-${suffix}`,
          },
          payload: {
            amount: "TESTKUDOS:1",
            description: "Daily payout limit evidence",
            external_reference: `daily-limit-${suffix}`,
          },
        });
        tokens.push(created.json<{ claim_url: string }>().claim_url.split("/").at(-1) as string);
      }
      expect(
        (await limitedApp.inject({ method: "POST", url: `/claim/${tokens[0]}/start` })).statusCode,
      ).toBe(202);
      const blocked = await limitedApp.inject({ method: "POST", url: `/claim/${tokens[1]}/start` });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json<{ error: { code: string } }>().error.code).toBe("daily_payout_limit");
    } finally {
      await limitedApp.close();
    }
  });

  it("fails closed when liquidity evidence is missing and opens after a healthy check", async () => {
    const guardedConfig = loadConfig({
      NODE_ENV: "test",
      LIBREREWARD_ENV: "test",
      LIBREREWARD_PUBLIC_URL: "http://localhost:8080",
      DATABASE_URL: config.DATABASE_URL,
      API_KEY_HASH_SECRET: "a".repeat(32),
      OPERATOR_API_KEY_HASH_SECRET: "o".repeat(32),
      CLAIM_TOKEN_HASH_SECRET: "c".repeat(32),
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
      PROVIDER: "mock",
      SUPPORTED_CURRENCIES: "KUDOS",
      DAILY_PAYOUT_LIMITS: "KUDOS:1000000",
      LIQUIDITY_MIN_BALANCES: "KUDOS:10",
      LIQUIDITY_FAIL_CLOSED: "true",
      LOG_LEVEL: "silent",
    });
    const guardedProvider = new MockProvider();
    const guardedApp = buildApp(pool, guardedConfig, guardedProvider);
    await guardedApp.ready();
    try {
      const created = await guardedApp.inject({
        method: "POST",
        url: "/v1/rewards",
        headers: {
          authorization: `Bearer ${key}`,
          "idempotency-key": "liquidity-fail-closed",
        },
        payload: {
          amount: "KUDOS:1",
          description: "Liquidity fail-closed evidence",
          external_reference: "liquidity-fail-closed",
        },
      });
      const token = created.json<{ claim_url: string }>().claim_url.split("/").at(-1) as string;
      await pool.query("DELETE FROM liquidity_snapshots");
      const blocked = await guardedApp.inject({ method: "POST", url: `/claim/${token}/start` });
      expect(blocked.statusCode).toBe(503);
      expect(blocked.json<{ error: { code: string } }>().error.code).toBe("liquidity_unavailable");
      expect(
        (
          await guardedApp.inject({
            method: "POST",
            url: "/v1/operator/liquidity/check",
            headers: { authorization: `Bearer ${adminKey}` },
          })
        ).statusCode,
      ).toBe(202);
      expect(
        await new LiquidityService(pool, guardedConfig, guardedProvider).runRequestedCheck(),
      ).toBe(true);
      expect(
        (await guardedApp.inject({ method: "POST", url: `/claim/${token}/start` })).statusCode,
      ).toBe(202);
    } finally {
      await guardedApp.close();
    }
  });

  it("executes configurable retention and records the run", async () => {
    const tenantId = (await pool.query<{ id: string }>("SELECT id FROM tenants LIMIT 1")).rows[0]
      ?.id as string;
    const prefix = publicId("lrk");
    await pool.query(
      `INSERT INTO api_keys(id,tenant_id,key_prefix,secret_hash,scopes,revoked_at)
       VALUES($1,$2,$3,$4,$5,now()-interval '400 days')`,
      [
        uuid(),
        tenantId,
        prefix,
        keyedHash(config.API_KEY_HASH_SECRET, `${prefix}.${randomSecret()}`),
        ["rewards:read"],
      ],
    );
    const result = await new RetentionService(pool, config).run("operator");
    expect(result.revokedTenantKeys).toBeGreaterThanOrEqual(1);
    expect(
      (await pool.query("SELECT count(*) FROM retention_runs")).rows[0]?.count,
    ).toBeGreaterThan(0n);
  });

  it("serializes wallet-affecting calls across concurrent workers", async () => {
    let active = 0;
    let maximum = 0;
    const call = () =>
      serializedProviderCall(pool, async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await delay(10);
        active -= 1;
      });
    await Promise.all(Array.from({ length: 25 }, call));
    expect(maximum).toBe(1);
  });

  async function tenant(name: string): Promise<string> {
    const tenantId = uuid();
    await pool.query(
      "INSERT INTO tenants(id,public_id,display_name,status) VALUES($1,$2,$3,'active')",
      [tenantId, publicId("tn"), name],
    );
    const prefix = publicId("lrk");
    const raw = `${prefix}.${randomSecret()}`;
    await pool.query(
      "INSERT INTO api_keys(id,tenant_id,key_prefix,secret_hash,scopes) VALUES($1,$2,$3,$4,$5)",
      [
        uuid(),
        tenantId,
        prefix,
        keyedHash(config.API_KEY_HASH_SECRET, raw),
        ["rewards:read", "rewards:write", "webhooks:read", "webhooks:write"],
      ],
    );
    return raw;
  }

  async function operator(name: string, role: "viewer" | "admin"): Promise<string> {
    const operatorId = uuid();
    await pool.query(
      "INSERT INTO operator_accounts(id,public_id,display_name,role,status) VALUES($1,$2,$3,$4,'active')",
      [operatorId, publicId("op"), name, role],
    );
    const prefix = publicId("lro");
    const raw = `${prefix}.${randomSecret()}`;
    const scopes =
      role === "admin"
        ? [
            "operator:read",
            "operator:reconcile",
            "operator:webhook-retry",
            "operator:liquidity-check",
            "operator:audit-read",
            "operator:retention-run",
          ]
        : ["operator:read"];
    await pool.query(
      `INSERT INTO operator_api_keys(id,operator_id,key_prefix,secret_hash,scopes)
       VALUES($1,$2,$3,$4,$5)`,
      [uuid(), operatorId, prefix, keyedHash(config.OPERATOR_API_KEY_HASH_SECRET, raw), scopes],
    );
    return raw;
  }
});
