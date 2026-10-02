import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  WalletCoreError,
  WalletRpcClient,
  type WalletRpcError,
} from "../../src/providers/wallet-rpc/client.js";
import { FakeWalletRpcServer, type Handler } from "../fixtures/fake-wallet-rpc-server.js";

let server: FakeWalletRpcServer | undefined;
let client: WalletRpcClient | undefined;

afterEach(async () => {
  client?.close();
  await server?.close();
  client = undefined;
  server = undefined;
});

async function setup(
  handler: Handler,
  options: { timeoutMs?: number; maxLineBytes?: number } = {},
) {
  server = await FakeWalletRpcServer.start(handler);
  client = new WalletRpcClient({
    socketPath: server.path,
    requestTimeoutMs: options.timeoutMs ?? 1_000,
    maxLineBytes: options.maxLineBytes ?? 1_048_576,
    maxBackoffMs: 50,
  });
  return { server, client };
}

describe("WalletRpcClient", () => {
  it("correlates concurrent responses that arrive out of order", async () => {
    const { client } = await setup(async (request) => {
      if (request.operation === "slow") await delay(50);
      return { result: request.operation };
    });
    const [slow, fast] = await Promise.all([
      client.request("slow", {}),
      client.request("fast", {}),
    ]);
    expect([slow, fast]).toEqual(["slow", "fast"]);
  });

  it("surfaces wallet-core error envelopes", async () => {
    const { client } = await setup(() => ({
      error: { code: 7012, hint: "insufficient balance" },
    }));
    const error = await client.request("initiatePeerPushDebit", {}).catch((caught) => caught);
    expect(error).toBeInstanceOf(WalletCoreError);
    expect(error).toMatchObject({ talerCode: 7012, hint: "insufficient balance" });
  });

  it("delivers notifications sent before the response", async () => {
    const seen: unknown[] = [];
    const { client } = await setup((_request, connection) => {
      connection.notify({ type: "transaction-state-transition", transactionId: "t1" });
      return { result: "ok" };
    });
    client.onNotification((notification) => seen.push(notification));
    await client.request("getVersion", {});
    expect(seen).toEqual([{ type: "transaction-state-transition", transactionId: "t1" }]);
  });

  it("reassembles a response written in several chunks", async () => {
    const { client } = await setup(async (request, connection) => {
      const line = `${JSON.stringify({ type: "response", id: request.id, result: 42 })}\n`;
      connection.socket.write(line.slice(0, 10));
      await delay(10);
      connection.socket.write(line.slice(10));
      return { drop: true };
    });
    await expect(client.request("getVersion", {})).resolves.toBe(42);
  });

  it("ignores malformed lines and keeps serving", async () => {
    const { client } = await setup((request, connection) => {
      connection.socket.write('not json\n{"type":"unknown"}\n');
      return { result: request.operation };
    });
    await expect(client.request("getBalances", {})).resolves.toBe("getBalances");
  });

  it("times out a request that is never answered", async () => {
    const { client } = await setup(() => ({ drop: true }), { timeoutMs: 100 });
    await expect(client.request("getVersion", {})).rejects.toMatchObject({
      code: "wallet_rpc_timeout",
    } satisfies Partial<WalletRpcError>);
  });

  it("rejects in-flight requests on disconnect, then reconnects and signals the change", async () => {
    let first = true;
    const { client } = await setup(() => {
      if (first) {
        first = false;
        return { disconnect: true };
      }
      return { result: "again" };
    });
    const changes: string[] = [];
    client.onConnectionChange((state) => changes.push(state));
    await expect(client.request("getVersion", {})).rejects.toMatchObject({
      code: "wallet_rpc_disconnected",
    } satisfies Partial<WalletRpcError>);
    await expect(client.request("getVersion", {})).resolves.toBe("again");
    expect(changes).toEqual(["disconnected", "reconnected"]);
  });

  it("drops the connection when a line exceeds the size limit", async () => {
    const { client } = await setup(() => ({ raw: "x".repeat(200) }), { maxLineBytes: 64 });
    await expect(client.request("getVersion", {})).rejects.toMatchObject({
      code: "wallet_rpc_disconnected",
    } satisfies Partial<WalletRpcError>);
  });

  it("reports an unreachable endpoint without sending anything", async () => {
    client = new WalletRpcClient({
      socketPath:
        process.platform === "win32"
          ? "\\\\.\\pipe\\libreward-missing"
          : "/nonexistent/wallet.sock",
      requestTimeoutMs: 1_000,
      maxBackoffMs: 50,
    });
    await expect(client.request("getVersion", {})).rejects.toMatchObject({
      code: "wallet_rpc_unavailable",
    } satisfies Partial<WalletRpcError>);
  });
});
