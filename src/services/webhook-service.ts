import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import type pg from "pg";
import { Agent, request } from "undici";
import type { Config } from "../config.js";
import { transaction } from "../db.js";
import { canonicalJson, decrypt, encrypt } from "../domain/crypto.js";
import { publicId, randomSecret, uuid } from "../domain/ids.js";
import { signWebhook } from "../domain/webhook-signing.js";
import { AppError, notFound } from "../errors.js";
import { webhookFailures } from "../metrics.js";
import type { Tenant } from "./reward-service.js";

type Delivery = {
  id: string;
  attempt_count: number;
  url: string;
  secret_ciphertext: string;
  event_id: string;
  public_event_id: string;
  event_type: string;
  data: Record<string, unknown>;
  created_at: Date;
  reward_public_id: string;
  tenant_public_id: string;
};

export class WebhookService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: Config,
  ) {}

  async createEndpoint(tenant: Tenant, input: { url: string; description?: string | undefined }) {
    await this.validateDestination(input.url);
    const id = uuid();
    const secret = `lwhsec_${randomSecret()}`;
    const row = await this.pool.query<{
      public_id: string;
      url: string;
      description: string;
      enabled: boolean;
      created_at: Date;
    }>(
      `INSERT INTO webhook_endpoints(id,public_id,tenant_id,url,secret_ciphertext,description)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING public_id,url,description,enabled,created_at`,
      [
        id,
        publicId("wh"),
        tenant.id,
        input.url,
        encrypt(this.config.encryptionKey, secret),
        input.description ?? "",
      ],
    );
    return { ...row.rows[0], secret };
  }

  async listEndpoints(tenant: Tenant) {
    return (
      await this.pool.query(
        "SELECT public_id AS id,url,description,enabled,created_at,updated_at FROM webhook_endpoints WHERE tenant_id=$1 ORDER BY created_at",
        [tenant.id],
      )
    ).rows;
  }

  async updateEndpoint(
    tenant: Tenant,
    endpointId: string,
    input: {
      url?: string | undefined;
      description?: string | undefined;
      enabled?: boolean | undefined;
    },
  ) {
    if (input.url) await this.validateDestination(input.url);
    const row = (
      await this.pool.query(
        `UPDATE webhook_endpoints SET url=COALESCE($1,url),description=COALESCE($2,description),enabled=COALESCE($3,enabled),updated_at=now()
       WHERE tenant_id=$4 AND public_id=$5 RETURNING public_id AS id,url,description,enabled,created_at,updated_at`,
        [
          input.url ?? null,
          input.description ?? null,
          input.enabled ?? null,
          tenant.id,
          endpointId,
        ],
      )
    ).rows[0];
    if (!row) throw notFound();
    return row;
  }

  async deleteEndpoint(tenant: Tenant, endpointId: string): Promise<void> {
    const result = await this.pool.query(
      "DELETE FROM webhook_endpoints WHERE tenant_id=$1 AND public_id=$2",
      [tenant.id, endpointId],
    );
    if (result.rowCount !== 1) throw notFound();
  }

  async queueTest(tenant: Tenant, endpointId: string): Promise<{ event_id: string }> {
    return transaction(this.pool, async (client) => {
      const endpoint = (
        await client.query<{ id: string }>(
          "SELECT id FROM webhook_endpoints WHERE tenant_id=$1 AND public_id=$2",
          [tenant.id, endpointId],
        )
      ).rows[0];
      if (!endpoint) throw notFound();
      const reward = (
        await client.query<{ id: string }>(
          "SELECT id FROM rewards WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1",
          [tenant.id],
        )
      ).rows[0];
      if (!reward)
        throw new AppError(
          409,
          "test_event_unavailable",
          "Create a reward before testing webhooks",
        );
      const dbEventId = uuid();
      const eventId = publicId("evt");
      await client.query(
        "INSERT INTO reward_events(id,event_id,tenant_id,reward_id,event_type,data) VALUES($1,$2,$3,$4,'webhook.test',$5)",
        [dbEventId, eventId, tenant.id, reward.id, { test: true }],
      );
      await client.query(
        "INSERT INTO webhook_deliveries(id,event_id,endpoint_id,status) VALUES($1,$2,$3,'pending')",
        [uuid(), dbEventId, endpoint.id],
      );
      return { event_id: eventId };
    });
  }

  async deliverOne(): Promise<boolean> {
    const delivery = await transaction(this.pool, async (client) => {
      const result = await client.query<Delivery>(
        `SELECT d.id,d.attempt_count,e.event_id AS public_event_id,e.event_type,e.data,e.created_at,
          we.url,we.secret_ciphertext,r.public_id AS reward_public_id,t.public_id AS tenant_public_id
         FROM webhook_deliveries d JOIN reward_events e ON e.id=d.event_id JOIN webhook_endpoints we ON we.id=d.endpoint_id
         JOIN rewards r ON r.id=e.reward_id JOIN tenants t ON t.id=e.tenant_id
         WHERE d.status IN ('pending','retry') AND d.next_attempt_at<=now() AND we.enabled=true
         ORDER BY d.next_attempt_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`,
      );
      const row = result.rows[0];
      if (!row) return null;
      await client.query(
        "UPDATE webhook_deliveries SET status='processing',processing_started_at=now(),updated_at=now() WHERE id=$1",
        [row.id],
      );
      return row;
    });
    if (!delivery) return false;
    let dispatcher: Agent | undefined;
    try {
      const addresses = await this.validateDestination(delivery.url);
      const body = canonicalJson({
        id: delivery.public_event_id,
        type: delivery.event_type,
        created_at: delivery.created_at.toISOString(),
        tenant_id: delivery.tenant_public_id,
        reward_id: delivery.reward_public_id,
        data: delivery.data,
      });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = signWebhook(
        decrypt(this.config.encryptionKey, delivery.secret_ciphertext),
        timestamp,
        body,
      );
      const destination = new URL(delivery.url);
      const pinnedLookup: LookupFunction = (hostname, options, callback) => {
        if (hostname !== destination.hostname) {
          callback(Object.assign(new Error("webhook hostname changed"), { code: "EACCES" }), "");
          return;
        }
        if (options.all) callback(null, addresses);
        else {
          const selected = addresses[0];
          if (!selected)
            callback(
              Object.assign(new Error("no validated webhook address"), { code: "ENOTFOUND" }),
              "",
            );
          else callback(null, selected.address, selected.family);
        }
      };
      dispatcher = new Agent({
        connect: { lookup: pinnedLookup },
        maxResponseSize: 65_536,
        connections: 1,
        pipelining: 0,
      });
      const response = await request(delivery.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "LibreReward-Bridge/0.1",
          "x-libreward-event-id": delivery.public_event_id,
          "x-libreward-timestamp": timestamp,
          "x-libreward-signature": signature,
        },
        body,
        headersTimeout: this.config.WEBHOOK_TIMEOUT_MS,
        bodyTimeout: this.config.WEBHOOK_TIMEOUT_MS,
        dispatcher,
      });
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 65_536) break;
      }
      await dispatcher.close();
      dispatcher = undefined;
      if (response.statusCode < 200 || response.statusCode >= 300)
        throw new AppError(
          502,
          `webhook_http_${response.statusCode}`,
          "Webhook returned non-success status",
        );
      await this.pool.query(
        "UPDATE webhook_deliveries SET status='delivered',attempt_count=attempt_count+1,last_http_status=$1,response_bytes=$2,delivered_at=now(),updated_at=now() WHERE id=$3",
        [response.statusCode, bytes, delivery.id],
      );
    } catch (error) {
      if (dispatcher) await dispatcher.close().catch(() => undefined);
      webhookFailures.inc();
      const attempts = delivery.attempt_count + 1;
      const final = attempts >= this.config.WEBHOOK_MAX_ATTEMPTS;
      await this.pool.query(
        `UPDATE webhook_deliveries SET status=$1,attempt_count=$2,last_error_code=$3,
         next_attempt_at=now()+make_interval(secs => LEAST(86400,power(2,$2)::int)),updated_at=now() WHERE id=$4`,
        [
          final ? "failed" : "retry",
          attempts,
          error instanceof AppError ? error.code : "webhook_transport",
          delivery.id,
        ],
      );
    }
    return true;
  }

  async recoverStale(): Promise<number> {
    const result = await this.pool.query(
      `UPDATE webhook_deliveries SET status='retry',next_attempt_at=now(),last_error_code='worker_restarted',updated_at=now()
       WHERE status='processing' AND processing_started_at<now()-interval '2 minutes'`,
    );
    return result.rowCount ?? 0;
  }

  private async validateDestination(rawUrl: string): Promise<LookupAddress[]> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new AppError(422, "invalid_webhook_url", "Webhook URL is invalid");
    }
    const developmentPortAllowed =
      this.config.LIBREREWARD_ENV !== "production" && this.config.WEBHOOK_ALLOW_PRIVATE;
    if (
      url.username ||
      url.password ||
      (url.port && !["443", "8443"].includes(url.port) && !developmentPortAllowed)
    )
      throw new AppError(
        422,
        "unsafe_webhook_url",
        "Webhook URL contains forbidden authority or port",
      );
    if (
      url.protocol !== "https:" &&
      !(this.config.LIBREREWARD_ENV !== "production" && url.protocol === "http:")
    ) {
      throw new AppError(422, "webhook_https_required", "Webhook URL must use HTTPS");
    }
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length)
      throw new AppError(422, "webhook_dns_failed", "Webhook hostname did not resolve");
    if (!this.config.WEBHOOK_ALLOW_PRIVATE) {
      for (const entry of addresses) {
        const range = ipaddr.parse(entry.address).range();
        if (range !== "unicast")
          throw new AppError(
            422,
            "webhook_private_address",
            "Webhook address is not public unicast",
          );
      }
    }
    return addresses;
  }
}
