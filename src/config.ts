import { z } from "zod";
import { type Money, parseAmount } from "./domain/money.js";

const boolString = (defaultValue: "true" | "false" = "false") =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");

const schema = z
  .object({
    LIBREREWARD_ENV: z.enum(["development", "test", "production"]).default("development"),
    LIBREREWARD_HOST: z.string().default("0.0.0.0"),
    LIBREREWARD_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LIBREREWARD_PUBLIC_URL: z.string().url().default("http://localhost:8080"),
    DATABASE_URL: z.string().min(1),
    API_KEY_HASH_SECRET: z.string().min(32),
    OPERATOR_API_KEY_HASH_SECRET: z.string().min(32),
    CLAIM_TOKEN_HASH_SECRET: z.string().min(32),
    DATA_ENCRYPTION_KEY: z.string().min(43).max(44),
    PROVIDER: z.enum(["mock", "taler-wallet-cli"]).default("mock"),
    TALER_WALLET_CLI: z.string().default("taler-wallet-cli"),
    TALER_WALLET_CLI_NODE_SCRIPT: z.string().optional().or(z.literal("")),
    TALER_WALLET_CRYPTO_WORKER: z.enum(["sync", "node-worker-thread"]).optional().or(z.literal("")),
    TALER_WALLET_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(60_000),
    TALER_WALLET_DB: z.string().default("/data/taler-wallet.sqlite3"),
    TALER_EXCHANGE_BASE_URL: z.string().url().optional().or(z.literal("")),
    TALER_ALLOW_HTTP: boolString(),
    SUPPORTED_CURRENCIES: z.string().default("KUDOS,TESTKUDOS"),
    CLAIM_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(2_592_000).default(604_800),
    MAX_REWARD_VALUE: z.coerce
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .default(1_000_000),
    DAILY_PAYOUT_LIMITS: z.string().default(""),
    LIQUIDITY_MIN_BALANCES: z.string().default(""),
    LIQUIDITY_MAX_AGE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    LIQUIDITY_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3600).default(60),
    LIQUIDITY_FAIL_CLOSED: boolString(),
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
    WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
    WEBHOOK_ALLOW_PRIVATE: boolString(),
    WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    RECONCILIATION_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
    RETENTION_INTERVAL_SECONDS: z.coerce.number().int().min(3600).max(604_800).default(86_400),
    CLAIM_TOKEN_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(30),
    PROVIDER_SECRET_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(30),
    WEBHOOK_DELIVERED_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
    WEBHOOK_FAILED_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
    REVOKED_KEY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(120),
    CLAIM_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(20),
    OPERATOR_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(60),
    METRICS_ENABLED: boolString("true"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .superRefine((env, context) => {
    if (env.TALER_EXCHANGE_BASE_URL?.startsWith("http:") && !env.TALER_ALLOW_HTTP) {
      context.addIssue({
        code: "custom",
        path: ["TALER_EXCHANGE_BASE_URL"],
        message: "HTTP Taler exchange requires TALER_ALLOW_HTTP=true",
      });
    }
    if (env.LIBREREWARD_ENV !== "production") return;
    for (const key of [
      "API_KEY_HASH_SECRET",
      "OPERATOR_API_KEY_HASH_SECRET",
      "CLAIM_TOKEN_HASH_SECRET",
    ] as const) {
      if (env[key].includes("development-only")) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: "development secret is forbidden in production",
        });
      }
    }
    if (env.PROVIDER === "mock") {
      context.addIssue({
        code: "custom",
        path: ["PROVIDER"],
        message: "mock provider is forbidden in production",
      });
    }
    if (/^A+$/.test(env.DATA_ENCRYPTION_KEY)) {
      context.addIssue({
        code: "custom",
        path: ["DATA_ENCRYPTION_KEY"],
        message: "example encryption key is forbidden in production",
      });
    }
    if (env.LIBREREWARD_PUBLIC_URL.startsWith("http:")) {
      context.addIssue({
        code: "custom",
        path: ["LIBREREWARD_PUBLIC_URL"],
        message: "HTTPS is required in production",
      });
    }
    if (env.TALER_ALLOW_HTTP || env.WEBHOOK_ALLOW_PRIVATE) {
      context.addIssue({
        code: "custom",
        message: "insecure network exceptions are forbidden in production",
      });
    }
    if (!env.LIQUIDITY_FAIL_CLOSED) {
      context.addIssue({
        code: "custom",
        path: ["LIQUIDITY_FAIL_CLOSED"],
        message: "production requires fail-closed liquidity checks",
      });
    }
    if (!env.DAILY_PAYOUT_LIMITS.trim() || !env.LIQUIDITY_MIN_BALANCES.trim()) {
      context.addIssue({
        code: "custom",
        message: "production requires daily payout limits and minimum wallet balances",
      });
    }
  });

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const env = schema.parse(source);
  const encryptionKey = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64url");
  if (encryptionKey.length !== 32)
    throw new Error("DATA_ENCRYPTION_KEY must decode to exactly 32 bytes");
  const supportedCurrencies = new Set(
    env.SUPPORTED_CURRENCIES.split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  );
  const dailyPayoutLimits = amountMap(env.DAILY_PAYOUT_LIMITS, supportedCurrencies);
  const liquidityMinimums = amountMap(env.LIQUIDITY_MIN_BALANCES, supportedCurrencies);
  if (env.LIBREREWARD_ENV === "production") {
    for (const currency of supportedCurrencies) {
      if (!dailyPayoutLimits.has(currency) || !liquidityMinimums.has(currency))
        throw new Error(`production controls are missing for ${currency}`);
    }
  }
  return {
    ...env,
    encryptionKey,
    supportedCurrencies,
    dailyPayoutLimits,
    liquidityMinimums,
  };
}

function amountMap(input: string, supported: ReadonlySet<string>): ReadonlyMap<string, Money> {
  const result = new Map<string, Money>();
  for (const item of input
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const amount = parseAmount(item, supported, Number.MAX_SAFE_INTEGER);
    if (result.has(amount.currency))
      throw new Error(`duplicate amount control for ${amount.currency}`);
    result.set(amount.currency, amount);
  }
  return result;
}
