import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { providerFor } from "./runtime.js";
import { LiquidityService } from "./services/liquidity-service.js";
import { OperationWorker } from "./services/operation-worker.js";
import { WebhookService } from "./services/webhook-service.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const provider = providerFor(config);
const operations = new OperationWorker(pool, config, provider);
const webhooks = new WebhookService(pool, config);
const liquidity = new LiquidityService(pool, config, provider);
let stopping = false;
process.once("SIGTERM", () => {
  stopping = true;
});
process.once("SIGINT", () => {
  stopping = true;
});
await operations.recoverStale();
await webhooks.recoverStale();
let lastReconcile = 0;
let lastRetention = 0;
let lastLiquidity = 0;
while (!stopping) {
  const liquidityRequested = await liquidity.runRequestedCheck();
  if (liquidityRequested) lastLiquidity = Date.now();
  const worked = liquidityRequested || (await operations.runOne()) || (await webhooks.deliverOne());
  if (Date.now() - lastReconcile > config.RECONCILIATION_INTERVAL_SECONDS * 1000) {
    await operations.reconcileOne();
    await operations.expireDue();
    lastReconcile = Date.now();
  }
  if (Date.now() - lastLiquidity > config.LIQUIDITY_CHECK_INTERVAL_SECONDS * 1000) {
    try {
      const snapshots = await liquidity.check();
      for (const snapshot of snapshots)
        if (snapshot.status !== "ok")
          process.stderr.write(
            `${JSON.stringify({ level: "warn", event: "liquidity_alert", currency: snapshot.currency, status: snapshot.status })}\n`,
          );
    } catch {
      process.stderr.write(
        `${JSON.stringify({ level: "error", event: "liquidity_check_failed" })}\n`,
      );
    }
    lastLiquidity = Date.now();
  }
  if (Date.now() - lastRetention > config.RETENTION_INTERVAL_SECONDS * 1000) {
    await operations.applyRetention();
    lastRetention = Date.now();
  }
  if (!worked) await delay(config.WORKER_POLL_MS);
}
await pool.end();
