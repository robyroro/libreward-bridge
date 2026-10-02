import { afterEach, describe, expect, it } from "vitest";
import type { ProviderError } from "../../src/providers/provider.js";
import { TalerWalletRpcProvider } from "../../src/providers/taler-wallet-rpc-provider.js";
import { FakeWalletRpcServer, type Handler } from "../fixtures/fake-wallet-rpc-server.js";

const id = "txn:peer-push-debit:rpc";
const uri = "taler://pay-push/exchange.example/rpc";
const input = {
  operationId: "op-rpc",
  amount: { currency: "KUDOS", value: 1n, fraction: 0 },
  summary: "RPC reward",
  expiresAt: new Date("2030-01-01T00:00:00Z"),
};
const checkOk = {
  type: "ok",
  amountRaw: "KUDOS:1",
  amountEffective: "KUDOS:1.01",
  exchangeBaseUrl: "https://exchange.example/",
  maxExpirationDate: { t_s: 1_956_528_000 },
};
const tx = (txState: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  transactionId: id,
  type: "peer-push-debit",
  txState,
  amountRaw: "KUDOS:1",
  ...extra,
});

let server: FakeWalletRpcServer | undefined;
let provider: TalerWalletRpcProvider | undefined;
afterEach(async () => {
  provider?.close();
  await server?.close();
  provider = undefined;
  server = undefined;
});

async function setup(handler: Handler, timeoutMs = 1_000, safetyPollMs = 60_000) {
  server = await FakeWalletRpcServer.start(handler);
  provider = new TalerWalletRpcProvider(
    {
      TALER_WALLET_CONNECTION: server.path,
      TALER_WALLET_COMMAND_TIMEOUT_MS: timeoutMs,
      TALER_EXCHANGE_BASE_URL: "",
    },
    { safetyPollMs, maxBackoffMs: 50 },
  );
  return { server, provider };
}

describe("GNU Taler wallet RPC provider", () => {
  it("gates the wallet version over RPC", async () => {
    const { provider } = await setup(() => ({
      result: { implementationSemver: "1.6.48", version: "10:0:0" },
    }));
    await expect(provider.verifyConfiguration()).rejects.toMatchObject({
      code: "wallet_version_unsupported",
    } satisfies Partial<ProviderError>);
  });

  it("preflights and initiates with the checked exchange and quote", async () => {
    const { server, provider } = await setup((request) =>
      request.operation === "checkPeerPushDebit"
        ? { result: { ...checkOk, peerPushDebitQuote: "q1" } }
        : { result: { transactionId: id } },
    );
    const preflight = await provider.preflight(input);
    expect(preflight).toEqual({
      amountEffective: "KUDOS:1.01",
      exchangeBaseUrl: "https://exchange.example/",
      quote: "q1",
    });
    await expect(provider.initiate(input, preflight)).resolves.toBe(id);
    expect(server.requests.map((request) => request.operation)).toEqual([
      "checkPeerPushDebit",
      "initiatePeerPushDebit",
    ]);
    expect(server.requests[1]?.args).toMatchObject({
      exchangeBaseUrl: "https://exchange.example/",
      peerPushDebitQuote: "q1",
    });
  });

  it("classifies insufficient balance as transient", async () => {
    const { provider } = await setup(() => ({
      result: { type: "insufficient-balance", insufficientBalanceDetails: {} },
    }));
    await expect(provider.preflight(input)).rejects.toMatchObject({
      classification: "transient",
      code: "wallet_insufficient_balance",
    } satisfies Partial<ProviderError>);
  });

  it("treats a lost initiation as ambiguous and a wallet refusal as permanent", async () => {
    const lost = await setup(() => ({ disconnect: true }));
    await expect(
      lost.provider.initiate(input, { amountEffective: "KUDOS:1.01" }),
    ).rejects.toMatchObject({
      classification: "ambiguous",
      code: "wallet_rpc_disconnected",
    } satisfies Partial<ProviderError>);
    provider?.close();
    await server?.close();

    const refused = await setup(() => ({ error: { code: 7012, hint: "insufficient balance" } }));
    await expect(
      refused.provider.initiate(input, { amountEffective: "KUDOS:1.01" }),
    ).rejects.toMatchObject({
      classification: "permanent",
      code: "taler_7012",
    } satisfies Partial<ProviderError>);
  });

  it("treats a lost read as transient", async () => {
    const { provider } = await setup(() => ({ disconnect: true }));
    await expect(provider.getOperationStatus(id)).rejects.toMatchObject({
      classification: "transient",
      code: "wallet_rpc_disconnected",
    } satisfies Partial<ProviderError>);
  });

  it("waits for the ready notification instead of polling", async () => {
    let ready = false;
    const { server, provider } = await setup((request) =>
      request.operation === "getTransactionById"
        ? {
            result: ready
              ? tx({ major: "pending", minor: "ready" }, { talerUri: uri })
              : tx({ major: "pending", minor: "create-purse" }),
          }
        : { result: {} },
    );
    const waiting = provider.waitUntilShareable(id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    ready = true;
    server.notifyAll({
      type: "transaction-state-transition",
      transactionId: id,
      oldTxState: { major: "pending", minor: "create-purse" },
      newTxState: { major: "pending", minor: "ready" },
    });
    await expect(waiting).resolves.toMatchObject({ state: "ready", claimUri: uri });
    expect(
      server.requests.filter((request) => request.operation === "getTransactionById"),
    ).toHaveLength(2);
  });

  it("returns immediately when the transaction was ready before subscribing", async () => {
    const { provider } = await setup(() => ({
      result: tx({ major: "pending", minor: "ready" }, { talerUri: uri }),
    }));
    await expect(provider.waitUntilShareable(id)).resolves.toMatchObject({ state: "ready" });
  });

  it("times out as ambiguous and keeps the transaction ID", async () => {
    const { provider } = await setup(
      () => ({ result: tx({ major: "pending", minor: "create-purse" }) }),
      200,
      50,
    );
    await expect(provider.waitUntilShareable(id)).rejects.toMatchObject({
      classification: "ambiguous",
      code: "wallet_readiness_timeout",
      externalOperationId: id,
    } satisfies Partial<ProviderError>);
  });

  it("emits operation updates only for peer-push-debit transitions", async () => {
    const { server, provider } = await setup(() => ({
      result: { balances: [], haveProdBalance: false },
    }));
    const updates: string[] = [];
    provider.onOperationUpdate((externalId) => updates.push(externalId));
    await provider.getBalances();
    server.notifyAll({ type: "transaction-state-transition", transactionId: "txn:withdrawal:x" });
    server.notifyAll({ type: "transaction-state-transition", transactionId: id });
    server.notifyAll({ type: "balance-change" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(updates).toEqual([id]);
  });

  it("maps a suspended wallet transaction as ambiguous", async () => {
    const { provider } = await setup(() => ({
      result: tx({ major: "suspended", minor: "ready" }),
    }));
    await expect(provider.getOperationStatus(id)).resolves.toMatchObject({
      state: "ambiguous",
      errorCode: "wallet_suspended",
    });
  });
});
