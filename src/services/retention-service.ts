import type pg from "pg";
import type { Config } from "../config.js";
import { transaction } from "../db.js";
import { uuid } from "../domain/ids.js";
import { retentionDeleted } from "../metrics.js";

export type RetentionResult = Readonly<{
  claimTokens: number;
  providerSecrets: number;
  deliveredWebhooks: number;
  failedWebhooks: number;
  revokedTenantKeys: number;
  revokedOperatorKeys: number;
}>;

export class RetentionService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: Config,
  ) {}

  async run(trigger: "worker" | "operator", dryRun = false): Promise<RetentionResult> {
    const result = await transaction(this.pool, async (client) => {
      if (dryRun) {
        const counts = await client.query<{
          claim_tokens: bigint;
          provider_secrets: bigint;
          delivered_webhooks: bigint;
          failed_webhooks: bigint;
          revoked_tenant_keys: bigint;
          revoked_operator_keys: bigint;
        }>(
          `SELECT
             (SELECT count(*) FROM claim_tokens ct JOIN rewards r ON r.id=ct.reward_id
              WHERE r.status IN ('claimed','expired','cancelled','failed')
              AND r.updated_at<now()-make_interval(days=>$1)) AS claim_tokens,
             (SELECT count(*) FROM provider_operations po JOIN rewards r ON r.id=po.reward_id
              WHERE po.provider_secret_ciphertext IS NOT NULL
              AND r.status IN ('claimed','expired','cancelled','failed')
              AND r.updated_at<now()-make_interval(days=>$2)) AS provider_secrets,
             (SELECT count(*) FROM webhook_deliveries WHERE status='delivered'
              AND delivered_at<now()-make_interval(days=>$3)) AS delivered_webhooks,
             (SELECT count(*) FROM webhook_deliveries WHERE status='failed'
              AND updated_at<now()-make_interval(days=>$4)) AS failed_webhooks,
             (SELECT count(*) FROM api_keys WHERE revoked_at IS NOT NULL
              AND revoked_at<now()-make_interval(days=>$5)) AS revoked_tenant_keys,
             (SELECT count(*) FROM operator_api_keys WHERE revoked_at IS NOT NULL
              AND revoked_at<now()-make_interval(days=>$5)) AS revoked_operator_keys`,
          this.policyValues(),
        );
        const row = counts.rows[0];
        return {
          claimTokens: Number(row?.claim_tokens ?? 0n),
          providerSecrets: Number(row?.provider_secrets ?? 0n),
          deliveredWebhooks: Number(row?.delivered_webhooks ?? 0n),
          failedWebhooks: Number(row?.failed_webhooks ?? 0n),
          revokedTenantKeys: Number(row?.revoked_tenant_keys ?? 0n),
          revokedOperatorKeys: Number(row?.revoked_operator_keys ?? 0n),
        };
      }
      const claimTokens = await client.query(
        `DELETE FROM claim_tokens ct USING rewards r WHERE ct.reward_id=r.id
         AND r.status IN ('claimed','expired','cancelled','failed')
         AND r.updated_at<now()-make_interval(days=>$1)`,
        [this.config.CLAIM_TOKEN_RETENTION_DAYS],
      );
      const providerSecrets = await client.query(
        `UPDATE provider_operations po SET provider_secret_ciphertext=NULL,updated_at=now() FROM rewards r
         WHERE po.reward_id=r.id AND po.provider_secret_ciphertext IS NOT NULL
         AND r.status IN ('claimed','expired','cancelled','failed')
         AND r.updated_at<now()-make_interval(days=>$1)`,
        [this.config.PROVIDER_SECRET_RETENTION_DAYS],
      );
      const deliveredWebhooks = await client.query(
        `DELETE FROM webhook_deliveries WHERE status='delivered'
         AND delivered_at<now()-make_interval(days=>$1)`,
        [this.config.WEBHOOK_DELIVERED_RETENTION_DAYS],
      );
      const failedWebhooks = await client.query(
        `DELETE FROM webhook_deliveries WHERE status='failed'
         AND updated_at<now()-make_interval(days=>$1)`,
        [this.config.WEBHOOK_FAILED_RETENTION_DAYS],
      );
      const revokedTenantKeys = await client.query(
        `DELETE FROM api_keys WHERE revoked_at IS NOT NULL
         AND revoked_at<now()-make_interval(days=>$1)`,
        [this.config.REVOKED_KEY_RETENTION_DAYS],
      );
      const revokedOperatorKeys = await client.query(
        `DELETE FROM operator_api_keys WHERE revoked_at IS NOT NULL
         AND revoked_at<now()-make_interval(days=>$1)`,
        [this.config.REVOKED_KEY_RETENTION_DAYS],
      );
      return {
        claimTokens: claimTokens.rowCount ?? 0,
        providerSecrets: providerSecrets.rowCount ?? 0,
        deliveredWebhooks: deliveredWebhooks.rowCount ?? 0,
        failedWebhooks: failedWebhooks.rowCount ?? 0,
        revokedTenantKeys: revokedTenantKeys.rowCount ?? 0,
        revokedOperatorKeys: revokedOperatorKeys.rowCount ?? 0,
      };
    });
    await this.pool.query(
      "INSERT INTO retention_runs(id,trigger,dry_run,result) VALUES($1,$2,$3,$4)",
      [uuid(), trigger, dryRun, result],
    );
    if (!dryRun)
      for (const [name, count] of Object.entries(result))
        if (count > 0) retentionDeleted.inc({ class: name }, count);
    return result;
  }

  private policyValues(): number[] {
    return [
      this.config.CLAIM_TOKEN_RETENTION_DAYS,
      this.config.PROVIDER_SECRET_RETENTION_DAYS,
      this.config.WEBHOOK_DELIVERED_RETENTION_DAYS,
      this.config.WEBHOOK_FAILED_RETENTION_DAYS,
      this.config.REVOKED_KEY_RETENTION_DAYS,
    ];
  }
}
