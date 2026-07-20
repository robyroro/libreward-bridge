import type pg from "pg";
import type { OperatorPrincipal } from "../auth.js";
import { publicId, uuid } from "../domain/ids.js";
import { serializeAmount } from "../domain/money.js";
import { AppError, notFound } from "../errors.js";

export class OperatorService {
  constructor(private readonly pool: pg.Pool) {}

  async reward(reference: string) {
    const rows = await this.pool.query<{
      public_id: string;
      tenant_public_id: string;
      external_reference: string | null;
      status: string;
      currency: string;
      amount_value: bigint;
      amount_fraction: number;
      description: string;
      expires_at: Date;
      claimed_at: Date | null;
      cancelled_at: Date | null;
      failure_code: string | null;
      provider: string | null;
      provider_state: string | null;
      external_operation_id: string | null;
      provider_error_code: string | null;
      created_at: Date;
      updated_at: Date;
      exact_public: boolean;
    }>(
      `SELECT r.public_id,t.public_id AS tenant_public_id,r.external_reference,r.status,r.currency,
           r.amount_value,r.amount_fraction,r.description,r.expires_at,r.claimed_at,r.cancelled_at,
           r.failure_code,po.provider,po.state AS provider_state,po.external_operation_id,
           po.last_error_code AS provider_error_code,r.created_at,r.updated_at,(r.public_id=$1) AS exact_public
         FROM rewards r JOIN tenants t ON t.id=r.tenant_id
         LEFT JOIN provider_operations po ON po.reward_id=r.id
         WHERE r.public_id=$1 OR r.external_reference=$1 ORDER BY (r.public_id=$1) DESC,r.created_at DESC LIMIT 2`,
      [reference],
    );
    if (rows.rows.length > 1 && !rows.rows[0]?.exact_public)
      throw new AppError(
        409,
        "ambiguous_reference",
        "External reference matches multiple tenants; use the reward public ID",
      );
    const row = rows.rows[0];
    if (!row) throw notFound();
    const { amount_fraction, amount_value, exact_public: _exactPublic, ...safe } = row;
    return {
      ...safe,
      amount: serializeAmount({
        currency: row.currency,
        value: amount_value,
        fraction: amount_fraction,
      }),
    };
  }

  async events(reference: string) {
    const result = await this.pool.query(
      `SELECT e.event_id,e.event_type,e.data,e.created_at FROM reward_events e
       JOIN rewards r ON r.id=e.reward_id WHERE r.public_id=$1 OR r.external_reference=$1
       ORDER BY e.created_at,e.id`,
      [reference],
    );
    if (result.rowCount === 0 && !(await this.rewardExists(reference))) throw notFound();
    return { data: result.rows };
  }

  async deliveries(reference: string) {
    const result = await this.pool.query(
      `SELECT d.id,e.event_id,e.event_type,we.public_id AS endpoint_id,d.status,d.attempt_count,
         d.next_attempt_at,d.last_http_status,d.last_error_code,d.delivered_at,d.created_at,d.updated_at
       FROM webhook_deliveries d JOIN reward_events e ON e.id=d.event_id
       JOIN rewards r ON r.id=e.reward_id JOIN webhook_endpoints we ON we.id=d.endpoint_id
       WHERE r.public_id=$1 OR r.external_reference=$1 ORDER BY d.created_at,d.id`,
      [reference],
    );
    if (result.rowCount === 0 && !(await this.rewardExists(reference))) throw notFound();
    return { data: result.rows };
  }

  async retryDelivery(deliveryId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE webhook_deliveries SET status='retry',next_attempt_at=now(),last_error_code=NULL,
         updated_at=now() WHERE id=$1 AND status='failed'`,
      [deliveryId],
    );
    if (result.rowCount !== 1)
      throw new AppError(409, "delivery_not_retryable", "Failed delivery was not found");
  }

  async auditEvents(limit: number, before?: string) {
    const result = await this.pool.query(
      `SELECT event_id,operator_public_id,action,target_type,target_id,request_id,details,created_at
       FROM operator_audit_events
       WHERE ($1::timestamptz IS NULL OR created_at<$1)
       ORDER BY created_at DESC,id DESC LIMIT $2`,
      [before ?? null, limit],
    );
    return { data: result.rows };
  }

  async audit(
    operator: OperatorPrincipal,
    action: string,
    targetType: string,
    targetId: string | null,
    requestId: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO operator_audit_events(id,event_id,operator_id,operator_public_id,action,
         target_type,target_id,request_id,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        uuid(),
        publicId("opa"),
        operator.id,
        operator.publicId,
        action,
        targetType,
        targetId,
        requestId,
        details,
      ],
    );
  }

  private async rewardExists(reference: string): Promise<boolean> {
    return (
      (
        await this.pool.query("SELECT 1 FROM rewards WHERE public_id=$1 OR external_reference=$1", [
          reference,
        ])
      ).rowCount === 1
    );
  }
}
