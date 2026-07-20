import { describe, expect, it } from "vitest";
import { loadConfig, parseTrustProxy } from "../../src/config.js";

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

  it("requires an explicit, bounded proxy trust policy", () => {
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("2")).toBe(2);
    expect(parseTrustProxy("127.0.0.1, 10.0.0.0/8")).toEqual(["127.0.0.1", "10.0.0.0/8"]);
    expect(() => parseTrustProxy("true")).toThrow(/unsafe/);
    expect(() => parseTrustProxy("11")).toThrow();
    expect(() => parseTrustProxy("not-an-address")).toThrow();
  });

  it("requires stable wallet RPC unless sandbox compatibility is explicit", () => {
    expect(() => loadConfig({ ...base, PROVIDER: "taler-wallet-cli" })).toThrow(
      /TALER_WALLET_CONNECTION/,
    );
    expect(() =>
      loadConfig({
        ...base,
        PROVIDER: "taler-wallet-cli",
        TALER_WALLET_CONNECTION: "/run/taler/wallet.sock",
      }),
    ).not.toThrow();
    expect(() =>
      loadConfig({
        ...base,
        PROVIDER: "taler-wallet-cli",
        TALER_WALLET_ALLOW_TESTING_API: "true",
      }),
    ).not.toThrow();
  });

  it("caps reward values at the database-safe aggregate limit", () => {
    expect(() => loadConfig({ ...base, MAX_REWARD_VALUE: "92233720367" })).not.toThrow();
    expect(() => loadConfig({ ...base, MAX_REWARD_VALUE: "92233720368" })).toThrow();
  });
});
