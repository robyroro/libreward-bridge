import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

const base = {
  DATABASE_URL: "postgres://localhost/test",
  API_KEY_HASH_SECRET: "a".repeat(32),
  OPERATOR_API_KEY_HASH_SECRET: "o".repeat(32),
  CLAIM_TOKEN_HASH_SECRET: "c".repeat(32),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
};

describe("configuration", () => {
  it("rejects insecure exchange HTTP without an explicit development override", () => {
    expect(() =>
      loadConfig({ ...base, TALER_EXCHANGE_BASE_URL: "http://exchange.test/" }),
    ).toThrow();
    expect(() =>
      loadConfig({
        ...base,
        TALER_EXCHANGE_BASE_URL: "http://exchange.test/",
        TALER_ALLOW_HTTP: "true",
      }),
    ).not.toThrow();
  });

  it("refuses mock and insecure defaults in production", () => {
    expect(() =>
      loadConfig({
        ...base,
        LIBREREWARD_ENV: "production",
        LIBREREWARD_PUBLIC_URL: "https://bridge.example",
        PROVIDER: "mock",
      }),
    ).toThrow();
  });

  it("parses per-currency production controls", () => {
    const config = loadConfig({
      ...base,
      DAILY_PAYOUT_LIMITS: "KUDOS:100,EUR:50",
      LIQUIDITY_MIN_BALANCES: "KUDOS:10,EUR:5",
      SUPPORTED_CURRENCIES: "KUDOS,EUR",
    });
    expect(config.dailyPayoutLimits.get("KUDOS")?.value).toBe(100n);
    expect(config.liquidityMinimums.get("EUR")?.value).toBe(5n);
  });
});
