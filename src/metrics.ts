import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "libreward_" });
export const rewardsCreated = new Counter({
  name: "libreward_rewards_created_total",
  help: "Rewards created",
  registers: [registry],
});
export const claimsStarted = new Counter({
  name: "libreward_claims_started_total",
  help: "Claims started",
  registers: [registry],
});
export const claimsCompleted = new Counter({
  name: "libreward_claims_completed_total",
  help: "Claims completed",
  registers: [registry],
});
export const duplicatesPrevented = new Counter({
  name: "libreward_duplicates_prevented_total",
  help: "Duplicate requests prevented",
  registers: [registry],
});
export const webhookFailures = new Counter({
  name: "libreward_webhook_failures_total",
  help: "Webhook delivery failures",
  registers: [registry],
});
export const providerDuration = new Histogram({
  name: "libreward_provider_duration_seconds",
  help: "Provider operation duration",
  labelNames: ["operation", "result"] as const,
  registers: [registry],
});
export const reconciliationBacklog = new Gauge({
  name: "libreward_reconciliation_backlog",
  help: "Operations requiring reconciliation",
  registers: [registry],
});
export const liquidityAvailable = new Gauge({
  name: "libreward_liquidity_available",
  help: "Wallet available balance in whole currency units",
  labelNames: ["currency"] as const,
  registers: [registry],
});
export const liquidityHealthy = new Gauge({
  name: "libreward_liquidity_healthy",
  help: "Whether the latest wallet balance satisfies the configured funding floor",
  labelNames: ["currency"] as const,
  registers: [registry],
});
export const liquidityLastCheck = new Gauge({
  name: "libreward_liquidity_last_check_timestamp_seconds",
  help: "Unix timestamp of the latest successful wallet balance check",
  labelNames: ["currency"] as const,
  registers: [registry],
});
export const liquidityCheckFailures = new Counter({
  name: "libreward_liquidity_check_failures_total",
  help: "Wallet balance check failures",
  registers: [registry],
});
export const retentionDeleted = new Counter({
  name: "libreward_retention_deleted_total",
  help: "Records or secrets removed by retention class",
  labelNames: ["class"] as const,
  registers: [registry],
});
