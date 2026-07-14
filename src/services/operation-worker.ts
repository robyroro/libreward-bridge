import type pg from "pg";
import type { Config } from "../config.js";
import { transaction } from "../db.js";
import { encrypt } from "../domain/crypto.js";
import { publicId, uuid } from "../domain/ids.js";
import { serializeAmount } from "../domain/money.js";
import { assertTransition, type RewardStatus } from "../domain/state-machine.js";
import { claimsCompleted, providerDuration, reconciliationBacklog } from "../metrics.js";
import type { ProviderResult, RewardPaymentProvider } from "../providers/provider.js";
import { ProviderError } from "../providers/provider.js";
import { serializedProviderCall } from "./provider-lock.js";
import { type RetentionResult, RetentionService } from "./retention-service.js";

type OperationRow = {
  id: string;
  reward_id: string;
  state: string;
  external_operation_id: string | null;
  retry_count: number;
  amount_value: bigint;
  amount_fraction: number;
  currency: string;
  description: string;
  expires_at: Date;
};

export class OperationWorker {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: Config,
    private readonly provider: RewardPaymentProvider,
  ) {}

  async runOne(): Promise<boolean> {
    return serializedProviderCall(this.pool, async () => {
      const operation = await transaction(this.pool, async (client) => {
        const result = await client.query<OperationRow>(
          `SELECT po.*,r.description,r.expires_at FROM provider_operations po JOIN rewards r ON r.id=po.reward_id
           WHERE po.state IN ('pending','retry') AND po.external_operation_id IS NULL
           AND (po.next_retry_at IS NULL OR po.next_retry_at<=now())
           ORDER BY po.created_at FOR UPDATE OF po SKIP LOCKED LIMIT 1`,
        );
        const row = result.rows[0];
        if (!row) return null;
        await client.query(
          "UPDATE provider_operations SET state='processing',processing_started_at=now(),updated_at=now() WHERE id=$1",
          [row.id],
        );
        return row;
      });
      if (!operation) return false;
      const end = providerDuration.startTimer({ operation: "create" });
      try {
        const result = await this.provider.createRewardOperation({
          operationId: operation.id,
          amount: {
            value: operation.amount_value,
            fraction: operation.amount_fraction,
            currency: operation.currency,
          },
          summary: operation.description,
          expiresAt: operation.expires_at,
        });
        end({ result: result.state });
        await this.applyResult(operation, result);
      } catch (error) {
        const providerError =
          error instanceof ProviderError
            ? error
            : new ProviderError("ambiguous", "provider_unknown", "unknown provider outcome");
        end({ result: providerError.classification });
        await this.applyError(operation, providerError);
      }
      return true;
    });
  }

  async reconcileOne(rewardPublicId?: string): Promise<boolean> {
    const result = await this.pool.query<OperationRow>(
      `SELECT po.*,r.description,r.expires_at FROM provider_operations po JOIN rewards r ON r.id=po.reward_id
       WHERE po.external_operation_id IS NOT NULL AND po.state IN ('ready','ambiguous','processing','pending')
       AND ($1::text IS NULL OR r.public_id=$1) ORDER BY po.updated_at LIMIT 1`,
      [rewardPublicId ?? null],
    );
    const operation = result.rows[0];
    if (!operation?.external_operation_id) return false;
    try {
      const providerResult = await serializedProviderCall(this.pool, () =>
        this.provider.getOperationStatus(operation.external_operation_id as string),
      );
      await this.applyResult(operation, providerResult);
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : "provider_reconcile_unknown";
      await this.pool.query(
        "UPDATE provider_operations SET state='ambiguous',last_error_code=$1,updated_at=now() WHERE id=$2",
        [code, operation.id],
      );
      await this.markReward(
        operation.reward_id,
        "reconciliation_required",
        "reward.reconciliation_required",
        {
          code,
        },
      );
    }
    return true;
  }

  async recoverStale(): Promise<number> {
    const result = await this.pool.query(
      `UPDATE provider_operations SET state='ambiguous',last_error_code='worker_restarted',updated_at=now()
       WHERE state='processing' AND processing_started_at < now()-make_interval(secs=>$1) RETURNING reward_id`,
      [Math.ceil(this.config.TALER_WALLET_COMMAND_TIMEOUT_MS / 1000) + 30],
    );
    for (const row of result.rows as { reward_id: string }[]) {
      await this.markReward(
        row.reward_id,
        "reconciliation_required",
        "reward.reconciliation_required",
        { reason: "worker_restart" },
      );
    }
    const backlog = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM provider_operations WHERE state='ambiguous'",
    );
    reconciliationBacklog.set(Number(backlog.rows[0]?.count ?? 0));
    return result.rowCount ?? 0;
  }

  async expireDue(): Promise<number> {
    const due = await this.pool.query<{ id: string }>(
      "SELECT id FROM rewards WHERE status='claimable' AND expires_at<=now() ORDER BY expires_at LIMIT 100",
    );
    for (const row of due.rows) await this.markReward(row.id, "expired", "reward.expired", {});
    return due.rowCount ?? 0;
  }

  async applyRetention(): Promise<RetentionResult> {
    return new RetentionService(this.pool, this.config).run("worker");
  }

  private async applyResult(operation: OperationRow, result: ProviderResult): Promise<void> {
    const expectedAmount = serializeAmount({
      value: operation.amount_value,
      fraction: operation.amount_fraction,
      currency: operation.currency,
    });
    if (result.amount && result.amount !== expectedAmount) {
      await this.applyError(
        operation,
        new ProviderError(
          "permanent",
          "provider_amount_mismatch",
          "provider amount did not match reward",
        ),
      );
      return;
    }
    await transaction(this.pool, async (client) => {
      const state =
        result.state === "succeeded"
          ? "succeeded"
          : result.state === "ready"
            ? "ready"
            : result.state;
      await client.query(
        `UPDATE provider_operations SET state=$1::varchar,external_operation_id=COALESCE($2,external_operation_id),
         provider_secret_ciphertext=CASE WHEN $1::varchar='succeeded' THEN NULL ELSE COALESCE($3,provider_secret_ciphertext) END,
         last_error_code=$4,reconciled_at=now(),updated_at=now()
         WHERE id=$5`,
        [
          state,
          result.externalOperationId ?? null,
          result.claimUri ? encrypt(this.config.encryptionKey, result.claimUri) : null,
          result.errorCode ?? null,
          operation.id,
        ],
      );
    });
    if (result.state === "succeeded") {
      await this.markReward(operation.reward_id, "claimed", "reward.claimed", {
        provider: this.provider.key,
      });
      claimsCompleted.inc();
    } else if (result.state === "failed") {
      await this.markReward(operation.reward_id, "failed", "reward.failed", {
        code: result.errorCode ?? "provider_failed",
      });
    } else if (result.state === "cancelled") {
      // A provider-side cancellation after claim start cannot return to claimable safely.
      // Preserve the provider's cancelled state, but make the reward terminal and observable.
      await this.markReward(operation.reward_id, "failed", "reward.failed", {
        code: result.errorCode ?? "provider_cancelled",
      });
    } else if (result.state === "ambiguous") {
      await this.markReward(
        operation.reward_id,
        "reconciliation_required",
        "reward.reconciliation_required",
        {},
      );
    }
  }

  private async applyError(operation: OperationRow, error: ProviderError): Promise<void> {
    if (error.classification === "transient" && operation.retry_count < 4) {
      await this.pool.query(
        `UPDATE provider_operations SET state='retry',retry_count=retry_count+1,last_error_code=$1,
         next_retry_at=now()+make_interval(secs => LEAST(300, power(2,retry_count+1)::int)),updated_at=now() WHERE id=$2`,
        [error.code, operation.id],
      );
      return;
    }
    const ambiguous = error.classification === "ambiguous";
    await this.pool.query(
      "UPDATE provider_operations SET state=$1,last_error_code=$2,updated_at=now() WHERE id=$3",
      [ambiguous ? "ambiguous" : "failed", error.code, operation.id],
    );
    await this.markReward(
      operation.reward_id,
      ambiguous ? "reconciliation_required" : "failed",
      ambiguous ? "reward.reconciliation_required" : "reward.failed",
      { code: error.code },
    );
  }

  private async markReward(
    rewardId: string,
    target: RewardStatus,
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await transaction(this.pool, async (client) => {
      const result = await client.query<{
        id: string;
        tenant_id: string;
        status: RewardStatus;
        version: number;
      }>("SELECT id,tenant_id,status,version FROM rewards WHERE id=$1 FOR UPDATE", [rewardId]);
      const reward = result.rows[0];
      if (!reward || reward.status === target) return;
      assertTransition(reward.status, target);
      await client.query(
        `UPDATE rewards SET status=$1::varchar,version=version+1,updated_at=now(),
         claimed_at=CASE WHEN $1::varchar='claimed' THEN now() ELSE claimed_at END WHERE id=$2 AND version=$3`,
        [target, reward.id, reward.version],
      );
      const eventDbId = uuid();
      await client.query(
        "INSERT INTO reward_events(id,event_id,tenant_id,reward_id,event_type,data) VALUES($1,$2,$3,$4,$5,$6)",
        [eventDbId, publicId("evt"), reward.tenant_id, reward.id, eventType, data],
      );
      if (new Set(["reward.claimed", "reward.failed"]).has(eventType)) {
        const endpoints = await client.query<{ id: string }>(
          "SELECT id FROM webhook_endpoints WHERE tenant_id=$1 AND enabled=true",
          [reward.tenant_id],
        );
        for (const endpoint of endpoints.rows) {
          await client.query(
            "INSERT INTO webhook_deliveries(id,event_id,endpoint_id,status) VALUES($1,$2,$3,'pending') ON CONFLICT DO NOTHING",
            [uuid(), eventDbId, endpoint.id],
          );
        }
      }
    });
  }
}
