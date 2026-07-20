import type pg from "pg";
import type { Config } from "../config.js";
import type { DbClient } from "../db.js";
import { transaction } from "../db.js";
import { uuid } from "../domain/ids.js";
import { amountAtoms, type Money, parseBalanceAmount, serializeAmount } from "../domain/money.js";
import { AppError } from "../errors.js";
import {
  liquidityAvailable,
  liquidityCheckFailures,
  liquidityHealthy,
  liquidityLastCheck,
} from "../metrics.js";
import type { RewardPaymentProvider } from "../providers/provider.js";
import { serializedProviderCall } from "./provider-lock.js";

type SnapshotRow = {
  currency: string;
  available_value: bigint;
  available_fraction: number;
  pending_incoming: string;
  pending_outgoing: string;
  peer_payments_allowed: boolean;
  have_production_balance: boolean;
  status: "ok" | "low" | "blocked";
  checked_at: Date;
};

export class LiquidityService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: Config,
    private readonly provider: RewardPaymentProvider,
  ) {}

  async check(): Promise<readonly ReturnType<typeof presentSnapshot>[]> {
    try {
      const providerBalances = await serializedProviderCall(this.pool, () =>
        this.provider.getBalances(),
      );
      const seen = new Set<string>();
      const snapshots = await transaction(this.pool, async (client) => {
        const rows: SnapshotRow[] = [];
        for (const balance of providerBalances.balances) {
          const currency = balance.currency.toUpperCase();
          if (!this.config.supportedCurrencies.has(currency) || seen.has(currency)) continue;
          seen.add(currency);
          const available = parseBalanceAmount(balance.available, this.config.supportedCurrencies);
          if (available.currency !== currency) throw new Error("wallet balance currency mismatch");
          const minimum = this.config.liquidityMinimums.get(currency);
          const status = !balance.peerPaymentsAllowed
            ? "blocked"
            : minimum && amountAtoms(available) < amountAtoms(minimum)
              ? "low"
              : "ok";
          const result = await client.query<SnapshotRow>(
            `INSERT INTO liquidity_snapshots(id,currency,available_value,available_fraction,
               pending_incoming,pending_outgoing,peer_payments_allowed,have_production_balance,status)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              uuid(),
              currency,
              available.value,
              available.fraction,
              balance.pendingIncoming,
              balance.pendingOutgoing,
              balance.peerPaymentsAllowed,
              providerBalances.haveProductionBalance,
              status,
            ],
          );
          const row = result.rows[0];
          if (row) rows.push(row);
          liquidityAvailable.set({ currency }, Number(available.value) + available.fraction / 1e8);
          liquidityHealthy.set({ currency }, status === "ok" ? 1 : 0);
          liquidityLastCheck.set({ currency }, Date.now() / 1000);
        }
        await client.query(
          "DELETE FROM liquidity_snapshots WHERE checked_at<now()-interval '30 days'",
        );
        return rows;
      });
      return snapshots.map((snapshot) => presentSnapshot(snapshot));
    } catch (error) {
      liquidityCheckFailures.inc();
      throw error;
    }
  }

  async requestCheck(operatorId: string): Promise<{ request_id: string; status: "pending" }> {
    const id = uuid();
    await this.pool.query(
      "INSERT INTO liquidity_check_requests(id,operator_id,status) VALUES($1,$2,'pending')",
      [id, operatorId],
    );
    return { request_id: id, status: "pending" };
  }

  async runRequestedCheck(): Promise<boolean> {
    const request = await transaction(this.pool, async (client) => {
      const row = (
        await client.query<{ id: string }>(
          `SELECT id FROM liquidity_check_requests WHERE status='pending'
           ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
        )
      ).rows[0];
      if (!row) return null;
      await client.query("UPDATE liquidity_check_requests SET status='processing' WHERE id=$1", [
        row.id,
      ]);
      return row;
    });
    if (!request) return false;
    try {
      await this.check();
      await this.pool.query(
        "UPDATE liquidity_check_requests SET status='completed',processed_at=now() WHERE id=$1",
        [request.id],
      );
    } catch {
      await this.pool.query(
        `UPDATE liquidity_check_requests SET status='failed',error_code='provider_balance_failed',
         processed_at=now() WHERE id=$1`,
        [request.id],
      );
    }
    return true;
  }

  async latest(): Promise<readonly ReturnType<typeof presentSnapshot>[]> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT DISTINCT ON (currency) currency,available_value,available_fraction,pending_incoming,
         pending_outgoing,peer_payments_allowed,have_production_balance,status,checked_at
       FROM liquidity_snapshots ORDER BY currency,checked_at DESC`,
    );
    return result.rows.map((row) =>
      presentSnapshot(
        row,
        Date.now() - row.checked_at.getTime() > this.config.LIQUIDITY_MAX_AGE_SECONDS * 1000,
      ),
    );
  }

  async assertFundingControls(client: DbClient, money: Money): Promise<void> {
    await this.assertDailyLimit(client, money);
    if (!this.config.LIQUIDITY_FAIL_CLOSED) return;
    const snapshot = (
      await client.query<SnapshotRow>(
        `SELECT currency,available_value,available_fraction,pending_incoming,pending_outgoing,
           peer_payments_allowed,have_production_balance,status,checked_at
         FROM liquidity_snapshots WHERE currency=$1 ORDER BY checked_at DESC LIMIT 1`,
        [money.currency],
      )
    ).rows[0];
    if (
      !snapshot ||
      snapshot.status !== "ok" ||
      Date.now() - snapshot.checked_at.getTime() > this.config.LIQUIDITY_MAX_AGE_SECONDS * 1000 ||
      amountAtoms({
        currency: snapshot.currency,
        value: snapshot.available_value,
        fraction: snapshot.available_fraction,
      }) < amountAtoms(money)
    )
      throw new AppError(503, "liquidity_unavailable", "Reward funding is temporarily unavailable");
  }

  private async assertDailyLimit(client: DbClient, money: Money): Promise<void> {
    const limit = this.config.dailyPayoutLimits.get(money.currency);
    if (!limit) return;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `libreward:payout:${money.currency}:${new Date().toISOString().slice(0, 10)}`,
    ]);
    const spent = BigInt(
      (
        await client.query<{ atoms: string }>(
          `SELECT COALESCE(sum(po.amount_value::numeric*100000000+po.amount_fraction),0)::text AS atoms
         FROM provider_operations po
         WHERE po.currency=$1
         AND po.created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
         AND po.state NOT IN ('failed','cancelled')`,
          [money.currency],
        )
      ).rows[0]?.atoms ?? "0",
    );
    if (spent + amountAtoms(money) > amountAtoms(limit))
      throw new AppError(429, "daily_payout_limit", "Daily payout limit reached");
  }
}

function presentSnapshot(row: SnapshotRow, stale = false) {
  return {
    currency: row.currency,
    available: serializeAmount({
      currency: row.currency,
      value: row.available_value,
      fraction: row.available_fraction,
    }),
    pending_incoming: row.pending_incoming,
    pending_outgoing: row.pending_outgoing,
    peer_payments_allowed: row.peer_payments_allowed,
    have_production_balance: row.have_production_balance,
    status: stale ? "stale" : row.status,
    checked_at: row.checked_at.toISOString(),
  } as const;
}
