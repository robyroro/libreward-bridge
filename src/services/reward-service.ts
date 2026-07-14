import type pg from "pg";
import type { Config } from "../config.js";
import { type DbClient, one, transaction } from "../db.js";
import { fingerprint, keyedHash, safeEqualHex } from "../domain/crypto.js";
import { publicId, randomSecret, uuid } from "../domain/ids.js";
import { parseAmount, serializeAmount } from "../domain/money.js";
import { assertTransition, type RewardStatus, terminalStatuses } from "../domain/state-machine.js";
import { AppError, notFound } from "../errors.js";
import { claimsStarted, duplicatesPrevented, rewardsCreated } from "../metrics.js";
import type { RewardPaymentProvider } from "../providers/provider.js";
import { LiquidityService } from "./liquidity-service.js";

export type Tenant = Readonly<{ id: string; publicId: string }>;
type RewardRow = {
  id: string;
  public_id: string;
  tenant_id: string;
  external_reference: string | null;
  idempotency_key: string;
  request_fingerprint: string;
  amount_value: bigint;
  amount_fraction: number;
  currency: string;
  description: string;
  metadata: Record<string, unknown>;
  status: RewardStatus;
  expires_at: Date;
  claimed_at: Date | null;
  cancelled_at: Date | null;
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
  version: number;
};

export type CreateRewardInput = {
  amount: string;
  description: string;
  external_reference?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  expires_at?: string | undefined;
};

export class RewardService {
  private readonly liquidity: LiquidityService;

  constructor(
    private readonly pool: pg.Pool,
    private readonly config: Config,
    provider: RewardPaymentProvider,
  ) {
    this.liquidity = new LiquidityService(pool, config, provider);
  }

  async create(tenant: Tenant, idempotencyKey: string, input: CreateRewardInput) {
    const money = parseAmount(
      input.amount,
      this.config.supportedCurrencies,
      this.config.MAX_REWARD_VALUE,
    );
    const expiresAt = input.expires_at
      ? new Date(input.expires_at)
      : new Date(Date.now() + this.config.CLAIM_TOKEN_TTL_SECONDS * 1000);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
      throw new AppError(422, "invalid_expiration", "expires_at must be in the future");
    const normalized = {
      amount: serializeAmount(money),
      description: input.description.trim(),
      external_reference: input.external_reference ?? null,
      metadata: input.metadata ?? {},
      expires_at: expiresAt.toISOString(),
    };
    const requestFingerprint = fingerprint({
      amount: normalized.amount,
      description: normalized.description,
      external_reference: normalized.external_reference,
      metadata: normalized.metadata,
      // A server-generated default expiry is response state, not part of the client's request.
      expires_at: input.expires_at ? normalized.expires_at : null,
    });
    const result = await transaction(this.pool, async (client) => {
      const rewardId = uuid();
      const tokenMaterial = randomSecret();
      const token = this.tokenFromMaterial(tokenMaterial);
      const inserted = await client.query<RewardRow>(
        `INSERT INTO rewards(id, public_id, tenant_id, external_reference, idempotency_key, request_fingerprint,
           amount_value, amount_fraction, currency, description, metadata, status, expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'created',$12)
         ON CONFLICT DO NOTHING RETURNING *`,
        [
          rewardId,
          publicId("rw"),
          tenant.id,
          normalized.external_reference,
          idempotencyKey,
          requestFingerprint,
          money.value,
          money.fraction,
          money.currency,
          normalized.description,
          normalized.metadata,
          expiresAt,
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        const existing = await client.query<RewardRow & { token_material: string }>(
          `SELECT r.*,ct.token_material FROM rewards r JOIN claim_tokens ct ON ct.reward_id=r.id
           WHERE r.tenant_id=$1 AND r.idempotency_key=$2`,
          [tenant.id, idempotencyKey],
        );
        const duplicate = existing.rows[0];
        if (!duplicate)
          throw new AppError(409, "duplicate_reference", "external_reference is already in use");
        if (!safeEqualHex(duplicate.request_fingerprint, requestFingerprint)) {
          throw new AppError(
            409,
            "idempotency_conflict",
            "Idempotency-Key was already used with a different request",
          );
        }
        return {
          row: duplicate,
          token: this.tokenFromMaterial(duplicate.token_material),
          idempotent: true,
        };
      }
      await client.query(
        "INSERT INTO claim_tokens(id,reward_id,token_material,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)",
        [
          uuid(),
          row.id,
          tokenMaterial,
          keyedHash(this.config.CLAIM_TOKEN_HASH_SECRET, token),
          expiresAt,
        ],
      );
      await this.event(client, row, "reward.created", {});
      const claimable = await this.transition(
        client,
        row,
        "claimable",
        "reward.claim_link_generated",
        {},
      );
      return { row: claimable, token, idempotent: false };
    });
    if (result.idempotent) duplicatesPrevented.inc();
    else rewardsCreated.inc();
    return this.creationResponse(result.row, result.token, result.idempotent);
  }

  async get(tenant: Tenant, publicRewardId: string) {
    const row = (
      await this.pool.query<RewardRow>(
        "SELECT * FROM rewards WHERE tenant_id=$1 AND public_id=$2",
        [tenant.id, publicRewardId],
      )
    ).rows[0];
    if (!row) throw notFound();
    return this.publicReward(row);
  }

  async claimInfo(rawToken: string) {
    const row = await this.findByToken(rawToken);
    if (!row) throw notFound();
    return this.publicReward(row);
  }

  async startClaim(rawToken: string) {
    const tokenHash = keyedHash(this.config.CLAIM_TOKEN_HASH_SECRET, rawToken);
    const result = await transaction(this.pool, async (client) => {
      const found = await client.query<
        RewardRow & { consumed_at: Date | null; revoked_at: Date | null }
      >(
        `SELECT r.*,ct.consumed_at,ct.revoked_at FROM rewards r JOIN claim_tokens ct ON ct.reward_id=r.id
         WHERE ct.token_hash=$1 FOR UPDATE OF r,ct`,
        [tokenHash],
      );
      const row = found.rows[0];
      if (!row || row.revoked_at) throw notFound();
      if (row.expires_at <= new Date()) {
        if (row.status === "claimable")
          await this.transition(client, row, "expired", "reward.expired", {});
        throw new AppError(410, "reward_expired", "Reward has expired");
      }
      if (row.status === "cancelled")
        throw new AppError(409, "reward_cancelled", "Reward was cancelled");
      if (terminalStatuses.has(row.status))
        throw new AppError(409, `reward_${row.status}`, `Reward is ${row.status}`);
      const existing = await client.query<{ id: string; state: string }>(
        "SELECT id,state FROM provider_operations WHERE reward_id=$1",
        [row.id],
      );
      if (existing.rows[0])
        return { reward: row, operationId: existing.rows[0].id, duplicate: true };
      if (row.status !== "claimable")
        throw new AppError(
          409,
          "claim_not_available",
          "Claim cannot be started in the current state",
        );
      await this.liquidity.assertFundingControls(client, {
        currency: row.currency,
        value: row.amount_value,
        fraction: row.amount_fraction,
      });
      const operationId = uuid();
      await client.query("UPDATE claim_tokens SET consumed_at=now() WHERE reward_id=$1", [row.id]);
      const updated = await this.transition(
        client,
        row,
        "claim_in_progress",
        "reward.claim_started",
        {},
      );
      await client.query(
        `INSERT INTO provider_operations(id,reward_id,provider,operation_type,request_fingerprint,state,
          amount_value,amount_fraction,currency,next_retry_at) VALUES($1,$2,$3,'peer_push_debit',$4,'pending',$5,$6,$7,now())`,
        [
          operationId,
          row.id,
          this.config.PROVIDER,
          fingerprint({ reward: row.public_id, amount: this.amount(row) }),
          row.amount_value,
          row.amount_fraction,
          row.currency,
        ],
      );
      return { reward: updated, operationId, duplicate: false };
    });
    if (!result.duplicate) claimsStarted.inc();
    return {
      reward: this.publicReward(result.reward),
      operation_id: result.operationId,
      duplicate: result.duplicate,
    };
  }

  async claimStatus(rawToken: string, decryptSecret: (ciphertext: string) => string) {
    const tokenHash = keyedHash(this.config.CLAIM_TOKEN_HASH_SECRET, rawToken);
    const result = await this.pool.query<
      RewardRow & { provider_secret_ciphertext: string | null; operation_state: string | null }
    >(
      `SELECT r.*,po.provider_secret_ciphertext,po.state AS operation_state FROM rewards r
       JOIN claim_tokens ct ON ct.reward_id=r.id LEFT JOIN provider_operations po ON po.reward_id=r.id
       WHERE ct.token_hash=$1 AND ct.revoked_at IS NULL`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) throw notFound();
    return {
      ...this.publicReward(row),
      operation_state: row.operation_state,
      taler_uri: row.provider_secret_ciphertext
        ? decryptSecret(row.provider_secret_ciphertext)
        : null,
    };
  }

  async cancel(tenant: Tenant, publicRewardId: string) {
    return transaction(this.pool, async (client) => {
      const row = (
        await client.query<RewardRow>(
          "SELECT * FROM rewards WHERE tenant_id=$1 AND public_id=$2 FOR UPDATE",
          [tenant.id, publicRewardId],
        )
      ).rows[0];
      if (!row) throw notFound();
      if (!new Set<RewardStatus>(["created", "claimable"]).has(row.status))
        throw new AppError(
          409,
          "reward_not_cancellable",
          "Reward cannot be cancelled after claim starts",
        );
      await client.query("UPDATE claim_tokens SET revoked_at=now() WHERE reward_id=$1", [row.id]);
      return this.publicReward(
        await this.transition(client, row, "cancelled", "reward.cancelled", {}),
      );
    });
  }

  async regenerateClaim(tenant: Tenant, publicRewardId: string) {
    return transaction(this.pool, async (client) => {
      const row = (
        await client.query<RewardRow>(
          "SELECT * FROM rewards WHERE tenant_id=$1 AND public_id=$2 FOR UPDATE",
          [tenant.id, publicRewardId],
        )
      ).rows[0];
      if (!row) throw notFound();
      if (row.status !== "claimable")
        throw new AppError(
          409,
          "claim_not_regenerable",
          "Only an unstarted claim can be regenerated",
        );
      const material = randomSecret();
      const token = this.tokenFromMaterial(material);
      await client.query(
        "UPDATE claim_tokens SET token_material=$1,token_hash=$2,created_at=now(),revoked_at=NULL WHERE reward_id=$3",
        [material, keyedHash(this.config.CLAIM_TOKEN_HASH_SECRET, token), row.id],
      );
      await this.event(client, row, "reward.claim_link_generated", { regenerated: true });
      return { claim_url: `${this.config.LIBREREWARD_PUBLIC_URL}/claim/${token}` };
    });
  }

  async events(tenant: Tenant, publicRewardId: string, limit: number, cursor?: string) {
    const reward = (
      await this.pool.query<{ id: string }>(
        "SELECT id FROM rewards WHERE tenant_id=$1 AND public_id=$2",
        [tenant.id, publicRewardId],
      )
    ).rows[0];
    if (!reward) throw notFound();
    const rows = await this.pool.query<{
      event_id: string;
      event_type: string;
      data: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT event_id,event_type,data,created_at FROM reward_events WHERE reward_id=$1
       AND ($2::timestamptz IS NULL OR created_at < $2) ORDER BY created_at DESC,id DESC LIMIT $3`,
      [
        reward.id,
        cursor ? new Date(Buffer.from(cursor, "base64url").toString("utf8")) : null,
        limit,
      ],
    );
    const last = rows.rows.at(-1);
    return {
      data: rows.rows,
      next_cursor:
        last && rows.rows.length === limit
          ? Buffer.from(last.created_at.toISOString()).toString("base64url")
          : null,
    };
  }

  private async findByToken(rawToken: string): Promise<RewardRow | undefined> {
    const result = await this.pool.query<RewardRow>(
      `SELECT r.* FROM rewards r JOIN claim_tokens ct ON ct.reward_id=r.id
       WHERE ct.token_hash=$1 AND ct.revoked_at IS NULL`,
      [keyedHash(this.config.CLAIM_TOKEN_HASH_SECRET, rawToken)],
    );
    return result.rows[0];
  }

  private tokenFromMaterial(material: string): string {
    return Buffer.from(
      keyedHash(this.config.CLAIM_TOKEN_HASH_SECRET, `claim:v1:${material}`),
      "hex",
    ).toString("base64url");
  }

  private amount(row: RewardRow): string {
    return serializeAmount({
      value: row.amount_value,
      fraction: row.amount_fraction,
      currency: row.currency,
    });
  }

  private publicReward(row: RewardRow) {
    return {
      id: row.public_id,
      external_reference: row.external_reference,
      amount: this.amount(row),
      description: row.description,
      metadata: row.metadata,
      status: row.status,
      expires_at: row.expires_at.toISOString(),
      claimed_at: row.claimed_at?.toISOString() ?? null,
      cancelled_at: row.cancelled_at?.toISOString() ?? null,
      failure_code: row.failure_code,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  private creationResponse(row: RewardRow, token: string, idempotent: boolean) {
    return {
      ...this.publicReward(row),
      claim_url: `${this.config.LIBREREWARD_PUBLIC_URL}/claim/${token}`,
      idempotent,
    };
  }

  private async transition(
    client: DbClient,
    row: RewardRow,
    to: RewardStatus,
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<RewardRow> {
    assertTransition(row.status, to);
    const result = await one<RewardRow>(
      client,
      `UPDATE rewards SET status=$1::varchar,version=version+1,updated_at=now(),
       claimed_at=CASE WHEN $1::varchar='claimed' THEN now() ELSE claimed_at END,
       cancelled_at=CASE WHEN $1::varchar='cancelled' THEN now() ELSE cancelled_at END
       WHERE id=$2 AND version=$3 RETURNING *`,
      [to, row.id, row.version],
    );
    await this.event(client, result, eventType, data);
    return result;
  }

  private async event(
    client: DbClient,
    row: RewardRow,
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const eventId = uuid();
    await client.query(
      "INSERT INTO reward_events(id,event_id,tenant_id,reward_id,event_type,data) VALUES($1,$2,$3,$4,$5,$6)",
      [eventId, publicId("evt"), row.tenant_id, row.id, eventType, data],
    );
    if (
      new Set(["reward.claimed", "reward.expired", "reward.cancelled", "reward.failed"]).has(
        eventType,
      )
    ) {
      const endpoints = await client.query<{ id: string }>(
        "SELECT id FROM webhook_endpoints WHERE tenant_id=$1 AND enabled=true",
        [row.tenant_id],
      );
      for (const endpoint of endpoints.rows) {
        await client.query(
          "INSERT INTO webhook_deliveries(id,event_id,endpoint_id,status) VALUES($1,$2,$3,'pending') ON CONFLICT(event_id,endpoint_id) DO NOTHING",
          [uuid(), eventId, endpoint.id],
        );
      }
    }
  }
}
