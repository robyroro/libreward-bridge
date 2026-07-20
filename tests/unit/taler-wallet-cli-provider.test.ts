import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ProviderError } from "../../src/providers/provider.js";
import { TalerWalletCliProvider } from "../../src/providers/taler-wallet-cli-provider.js";

const fixture = fileURLToPath(new URL("../fixtures/fake-taler-wallet-cli.mjs", import.meta.url));

describe("GNU Taler wallet CLI provider", () => {
  it("uses the documented direct API envelope and maps peer-push state", async () => {
    const provider = new TalerWalletCliProvider({
      TALER_WALLET_CLI: "unused-when-node-script-is-set",
      TALER_WALLET_CLI_NODE_SCRIPT: fixture,
      TALER_WALLET_CRYPTO_WORKER: "sync",
      TALER_WALLET_COMMAND_TIMEOUT_MS: 1_000,
      TALER_WALLET_DB: "fixture-wallet.sqlite3",
      TALER_WALLET_CONNECTION: "fixture-wallet.sock",
      TALER_EXCHANGE_BASE_URL: "https://exchange.example/",
    });

    await expect(provider.verifyConfiguration()).resolves.toBeUndefined();
    await expect(provider.getBalances()).resolves.toEqual({
      balances: [
        {
          currency: "KUDOS",
          available: "KUDOS:25",
          pendingIncoming: "KUDOS:1",
          pendingOutgoing: "KUDOS:2",
          peerPaymentsAllowed: true,
        },
      ],
      haveProductionBalance: false,
    });
    const created = await provider.createRewardOperation({
      operationId: "operation-1",
      amount: { currency: "KUDOS", value: 1n, fraction: 0 },
      summary: "Fixture reward",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });

    expect(created).toEqual({
      state: "ready",
      externalOperationId: "txn:peer-push-debit:fixture",
      claimUri: "taler://pay-push/exchange.example/fixture",
      amount: "KUDOS:1",
    });
    await expect(provider.cancelOperation("txn:peer-push-debit:fixture")).resolves.toEqual({
      state: "cancelled",
      externalOperationId: "txn:peer-push-debit:fixture",
    });
  });

  it("does not retry an unknown initiation timeout", async () => {
    await expect(
      fixtureProvider("timeout-wallet.sqlite3", 100).createRewardOperation(operation()),
    ).rejects.toMatchObject({
      classification: "ambiguous",
      code: "wallet_cli_timeout",
    } satisfies Partial<ProviderError>);
  });

  it("maps current wallet errors and expired transactions", async () => {
    await expect(
      fixtureProvider("error-wallet.sqlite3").createRewardOperation(operation()),
    ).rejects.toMatchObject({
      classification: "permanent",
      code: "taler_7012",
      message: "insufficient balance",
    } satisfies Partial<ProviderError>);
    await expect(
      fixtureProvider("expired-wallet.sqlite3").getOperationStatus("txn:peer-push-debit:fixture"),
    ).resolves.toEqual({
      state: "failed",
      externalOperationId: "txn:peer-push-debit:fixture",
      amount: "KUDOS:1",
      errorCode: "wallet_expired",
    });
  });

  it("rejects unverified and malformed wallet versions", async () => {
    await expect(
      stableFixtureProvider("unsupported-wallet.sock").verifyConfiguration(),
    ).rejects.toMatchObject({
      classification: "permanent",
      code: "wallet_version_unsupported",
    } satisfies Partial<ProviderError>);
    await expect(
      stableFixtureProvider("malformed-wallet.sock").verifyConfiguration(),
    ).rejects.toMatchObject({
      classification: "permanent",
      code: "wallet_cli_malformed_response",
    } satisfies Partial<ProviderError>);
  });

  it("uses stable polling and retains a known transaction ID after initiation", async () => {
    await expect(
      stableFixtureProvider("pending-wallet.sock", 600).createRewardOperation(operation()),
    ).rejects.toMatchObject({
      classification: "ambiguous",
      code: "wallet_readiness_timeout",
      externalOperationId: "txn:peer-push-debit:fixture",
    } satisfies Partial<ProviderError>);
  });

  it("quarantines a malformed initiation response without retrying", async () => {
    await expect(
      stableFixtureProvider("malformed-init-wallet.sock").createRewardOperation(operation()),
    ).rejects.toMatchObject({
      classification: "ambiguous",
      code: "wallet_cli_initiate_unknown",
    } satisfies Partial<ProviderError>);
  });
});

function fixtureProvider(walletDb: string, timeoutMs = 1_000) {
  return new TalerWalletCliProvider({
    TALER_WALLET_CLI: "unused-when-node-script-is-set",
    TALER_WALLET_CLI_NODE_SCRIPT: fixture,
    TALER_WALLET_CRYPTO_WORKER: "sync",
    TALER_WALLET_COMMAND_TIMEOUT_MS: timeoutMs,
    TALER_WALLET_DB: walletDb,
    TALER_WALLET_ALLOW_TESTING_API: true,
    TALER_EXCHANGE_BASE_URL: "https://exchange.example/",
  });
}

function stableFixtureProvider(walletConnection: string, timeoutMs = 1_000) {
  return new TalerWalletCliProvider({
    TALER_WALLET_CLI: "unused-when-node-script-is-set",
    TALER_WALLET_CLI_NODE_SCRIPT: fixture,
    TALER_WALLET_CRYPTO_WORKER: "sync",
    TALER_WALLET_COMMAND_TIMEOUT_MS: timeoutMs,
    TALER_WALLET_DB: "unused.sqlite3",
    TALER_WALLET_CONNECTION: walletConnection,
    TALER_EXCHANGE_BASE_URL: "https://exchange.example/",
  });
}

function operation() {
  return {
    operationId: "operation-timeout",
    amount: { currency: "KUDOS", value: 1n, fraction: 0 },
    summary: "Fixture reward",
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  };
}
