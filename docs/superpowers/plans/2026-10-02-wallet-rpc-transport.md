# Wallet RPC Transport and Upstream Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-call `taler-wallet-cli` spawning with a persistent wallet-core RPC client, add `checkPeerPushDebit` preflight, notification-driven readiness, early transaction-ID persistence and explicit DD037 state mapping, as specified in `docs/superpowers/specs/2026-10-02-wallet-rpc-transport-design.md`.

**Architecture:** A small NDJSON client (`src/providers/wallet-rpc/`) talks to `taler-wallet-cli advanced serve` over its Unix socket. A new `TalerWalletRpcProvider` uses it; shared parsing/mapping lives in `src/providers/wallet-core.ts` and is reused by the existing CLI provider. The provider interface is split into `preflight` → `initiate` → `waitUntilShareable`, so the worker can commit the wallet transaction ID and release the provider lock before waiting.

**Tech Stack:** Node.js 22, TypeScript (strict, `exactOptionalPropertyTypes`), `node:net`, PostgreSQL via `pg`, Vitest, Biome.

---

## Conventions for every task

- Work on branch `wallet-rpc-transport` in `C:\Users\robyv\Desktop\DLU\libreward-bridge`.
- Before each commit run `npx biome format --write <changed files>` and `npx biome check <changed files>`.
- Commits use the maintainer's git identity (`robyroro`). **No `Co-Authored-By` trailer.** Each commit body ends with the provenance trailer required by `AGENTS.md`:

  ```
  GenAI-use: Anthropic Claude (Opus 5.5) implemented this change from the approved design docs/superpowers/specs/2026-10-02-wallet-rpc-transport-design.md. Verification: <commands run and their result>. Owner review: pending.
  ```

- Commit with `git commit -F - <<'EOF' … EOF` so the trailer is preserved verbatim.
- PostgreSQL is not installed locally. Integration tests (`tests/integration`) run in CI (`.github/workflows/ci.yml`, job `integration`, PostgreSQL 17.10). Locally run `npm run test:unit`, `npm run typecheck`, `npm run lint`.
- Known baseline failure before this work: `tests/unit/taler-wallet-cli-provider.test.ts` "uses stable polling…" times out on Windows because a 600 ms budget is shorter than one CLI process spawn. Task 5 raises that budget.

## File map

| File | Responsibility |
| --- | --- |
| `src/providers/provider.ts` (modify) | Provider interface: `preflight`, `initiate`, `waitUntilShareable`, optional `onOperationUpdate`, `close`; `WalletState`, `PreflightResult` types |
| `src/providers/wallet-core.ts` (create) | Pure wallet-core response parsing, version gate, DD037 state mapping, request builders |
| `src/providers/wallet-rpc/framing.ts` (create) | NDJSON decoder/encoder with line-size limit |
| `src/providers/wallet-rpc/client.ts` (create) | Persistent socket client: request correlation, timeouts, notifications, reconnect |
| `src/providers/taler-wallet-rpc-provider.ts` (create) | `RewardPaymentProvider` over `WalletRpcClient` |
| `src/providers/taler-wallet-cli-provider.ts` (modify) | Same interface over CLI; uses `wallet-core.ts` |
| `src/providers/mock-provider.ts` (modify) | Same interface for tests/dev |
| `src/config.ts`, `src/runtime.ts` (modify) | `PROVIDER=taler-wallet-rpc` |
| `src/services/provider-lock.ts` (modify) | In-process queue + blocking `pg_advisory_lock` with `lock_timeout` |
| `src/services/operation-worker.ts` (modify) | Split flow, early ID persistence, wallet state columns, `claim_resumed` |
| `src/worker-main.ts`, `src/server.ts` (modify) | Notification-driven reconcile, provider shutdown |
| `src/metrics.ts` (modify) | `libreward_wallet_rpc_malformed_messages_total` |
| `migrations/003_wallet_rpc.sql` (create) | New `provider_operations` columns + index |
| `tests/fixtures/fake-wallet-rpc-server.ts` (create) | Scriptable NDJSON socket server |
| `tests/unit/*.test.ts`, `tests/integration/reward-flow.test.ts` | Tests per task |
| Docs listed in Task 9 | Upstream answers, compatibility, ADR-003, changelog, provenance |

---

### Task 1: Shared wallet-core parsing and DD037 state mapping

**Files:**
- Modify: `src/providers/provider.ts`
- Create: `src/providers/wallet-core.ts`
- Test: `tests/unit/wallet-core.test.ts`

- [ ] **Step 1: Add `WalletState` to the provider result type**

In `src/providers/provider.ts` replace the `ProviderResult` type with:

```ts
export type WalletState = Readonly<{ major: string; minor?: string }>;

export type ProviderResult = Readonly<{
  state: ProviderState;
  externalOperationId?: string;
  claimUri?: string;
  errorCode?: string;
  amount?: string;
  walletState?: WalletState;
}>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/wallet-core.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertSupportedWalletVersion,
  mapPeerPushDebitTransaction,
  parseWalletBalances,
} from "../../src/providers/wallet-core.js";

const id = "txn:peer-push-debit:abc";
const tx = (txState: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  transactionId: id,
  type: "peer-push-debit",
  txState,
  amountRaw: "KUDOS:1",
  ...extra,
});
const uri = "taler://pay-push/exchange.example/abc";

describe("wallet-core peer-push-debit state mapping (DD037)", () => {
  it.each([
    [{ major: "pending", minor: "create-purse" }, {}, { state: "pending" }],
    [{ major: "pending", minor: "ready" }, { talerUri: uri }, { state: "ready", claimUri: uri }],
    [{ major: "pending", minor: "ready" }, {}, { state: "pending" }],
    [{ major: "finalizing" }, {}, { state: "pending" }],
    [{ major: "aborting", minor: "delete-purse" }, {}, { state: "pending" }],
    [{ major: "suspended", minor: "ready" }, {}, { state: "ambiguous", errorCode: "wallet_suspended" }],
    [{ major: "done" }, {}, { state: "succeeded" }],
    [{ major: "aborted" }, {}, { state: "cancelled" }],
    [{ major: "expired" }, {}, { state: "failed", errorCode: "wallet_expired" }],
    [{ major: "failed" }, {}, { state: "failed", errorCode: "wallet_failed" }],
    [{ major: "deleted" }, {}, { state: "failed", errorCode: "wallet_deleted" }],
    [{ major: "dialog", minor: "proposed" }, {}, { state: "ambiguous", errorCode: "wallet_state_unexpected" }],
    [{ major: "something-new" }, {}, { state: "ambiguous", errorCode: "wallet_state_unexpected" }],
  ])("maps %j", (txState, extra, expected) => {
    expect(mapPeerPushDebitTransaction(tx(txState, extra), id)).toEqual({
      externalOperationId: id,
      amount: "KUDOS:1",
      walletState: txState,
      ...expected,
    });
  });

  it("rejects malformed, foreign and mismatched transactions", () => {
    expect(() => mapPeerPushDebitTransaction({}, id)).toThrow(
      expect.objectContaining({ code: "wallet_malformed_response" }),
    );
    expect(() =>
      mapPeerPushDebitTransaction({ ...tx({ major: "done" }), type: "withdrawal" }, id),
    ).toThrow(expect.objectContaining({ code: "wallet_tx_type" }));
    expect(() => mapPeerPushDebitTransaction(tx({ major: "done" }), "txn:other")).toThrow(
      expect.objectContaining({ code: "wallet_tx_id_mismatch" }),
    );
    expect(() =>
      mapPeerPushDebitTransaction(tx({ major: "pending", minor: "ready" }, { talerUri: "https://x" }), id),
    ).toThrow(expect.objectContaining({ code: "wallet_uri_scheme" }));
  });
});

describe("wallet-core version gate and balances", () => {
  it("accepts only verified versions", () => {
    expect(() =>
      assertSupportedWalletVersion({ implementationSemver: "1.6.12", version: "7:0:0" }),
    ).not.toThrow();
    expect(() =>
      assertSupportedWalletVersion({ implementationSemver: "1.6.48", version: "10:0:0" }),
    ).toThrow(expect.objectContaining({ code: "wallet_version_unsupported" }));
    expect(() =>
      assertSupportedWalletVersion({ implementationSemver: "1.6.12", version: "10:0:0" }),
    ).toThrow(expect.objectContaining({ code: "wallet_api_version_unsupported" }));
    expect(() => assertSupportedWalletVersion({ implementationSemver: 12 })).toThrow(
      expect.objectContaining({ code: "wallet_malformed_response" }),
    );
  });

  it("parses balances", () => {
    expect(
      parseWalletBalances({
        balances: [
          {
            scopeInfo: { currency: "KUDOS" },
            available: "KUDOS:25",
            pendingIncoming: "KUDOS:1",
            pendingOutgoing: "KUDOS:2",
            disablePeerPayments: true,
          },
        ],
        haveProdBalance: false,
      }),
    ).toEqual({
      balances: [
        {
          currency: "KUDOS",
          available: "KUDOS:25",
          pendingIncoming: "KUDOS:1",
          pendingOutgoing: "KUDOS:2",
          peerPaymentsAllowed: false,
        },
      ],
      haveProductionBalance: false,
    });
    expect(() => parseWalletBalances({ balances: [{}] })).toThrow(
      expect.objectContaining({ code: "wallet_malformed_response" }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/wallet-core.test.ts`
Expected: FAIL — cannot resolve `../../src/providers/wallet-core.js`.

- [ ] **Step 4: Implement `src/providers/wallet-core.ts`**

```ts
import { ProviderError, type ProviderBalances, type ProviderResult } from "./provider.js";

// Exact versions verified against official source and valueless sandbox evidence.
export const supportedWalletVersions: ReadonlySet<string> = new Set(["1.6.10", "1.6.12"]);
export const supportedWalletApiVersion = "7:0:0";

const peerPushUri = /^taler:\/\/pay-push\/\S+$/;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function malformedResponse(message: string): ProviderError {
  return new ProviderError("permanent", "wallet_malformed_response", message);
}

export function assertSupportedWalletVersion(version: unknown): void {
  if (!isObject(version)) throw malformedResponse("wallet version response is malformed");
  const implementation = version.implementationSemver;
  const api = version.version;
  if (typeof implementation !== "string" || typeof api !== "string")
    throw malformedResponse("wallet version response is malformed");
  const semanticVersion = /^(\d+\.\d+\.\d+)(?:[-+].*)?$/.exec(implementation)?.[1];
  if (!semanticVersion || !supportedWalletVersions.has(semanticVersion))
    throw new ProviderError(
      "permanent",
      "wallet_version_unsupported",
      `wallet-core ${implementation} is unsupported; supported versions are ${[...supportedWalletVersions].join(", ")}`,
    );
  if (api !== supportedWalletApiVersion)
    throw new ProviderError(
      "permanent",
      "wallet_api_version_unsupported",
      `wallet API ${api} is unsupported; expected ${supportedWalletApiVersion}`,
    );
}

export function parseWalletBalances(result: unknown): ProviderBalances {
  if (!isObject(result) || !Array.isArray(result.balances))
    throw malformedResponse("wallet balances response is malformed");
  return {
    balances: result.balances.map((balance: unknown) => {
      if (!isObject(balance) || !isObject(balance.scopeInfo))
        throw malformedResponse("wallet balance entry is malformed");
      const { currency } = balance.scopeInfo;
      const { available, pendingIncoming, pendingOutgoing } = balance;
      if (
        typeof currency !== "string" ||
        typeof available !== "string" ||
        typeof pendingIncoming !== "string" ||
        typeof pendingOutgoing !== "string"
      )
        throw malformedResponse("wallet balance entry is malformed");
      return {
        currency,
        available,
        pendingIncoming,
        pendingOutgoing,
        peerPaymentsAllowed: balance.disablePeerPayments !== true,
      };
    }),
    haveProductionBalance: result.haveProdBalance === true,
  };
}

/**
 * Maps a wallet-core peer-push-debit transaction to a provider result using the states of
 * GNU Taler design document 037. Anything not listed there fails closed as ambiguous.
 */
export function mapPeerPushDebitTransaction(
  tx: unknown,
  externalOperationId: string,
): ProviderResult {
  if (!isObject(tx) || !isObject(tx.txState))
    throw malformedResponse("wallet transaction response is malformed");
  const { transactionId, type, amountRaw, talerUri } = tx;
  const { major, minor } = tx.txState;
  if (
    typeof transactionId !== "string" ||
    typeof type !== "string" ||
    typeof major !== "string" ||
    typeof amountRaw !== "string"
  )
    throw malformedResponse("wallet transaction response is malformed");
  if (type !== "peer-push-debit")
    throw new ProviderError(
      "permanent",
      "wallet_tx_type",
      "wallet transaction is not peer-push-debit",
    );
  if (transactionId !== externalOperationId)
    throw new ProviderError(
      "permanent",
      "wallet_tx_id_mismatch",
      "wallet returned a different transaction ID",
    );
  if (
    talerUri !== undefined &&
    (typeof talerUri !== "string" || talerUri.length > 4096 || !peerPushUri.test(talerUri))
  )
    throw new ProviderError(
      "permanent",
      "wallet_uri_scheme",
      "wallet returned a non peer-push URI",
    );
  const base = {
    externalOperationId,
    amount: amountRaw,
    walletState: typeof minor === "string" ? { major, minor } : { major },
  };
  switch (major) {
    case "done":
      return { ...base, state: "succeeded" };
    case "aborted":
      return { ...base, state: "cancelled" };
    case "expired":
    case "failed":
    case "deleted":
      return { ...base, state: "failed", errorCode: `wallet_${major}` };
    case "pending":
      return minor === "ready" && typeof talerUri === "string"
        ? { ...base, state: "ready", claimUri: talerUri }
        : { ...base, state: "pending" };
    case "finalizing":
    case "aborting":
      return { ...base, state: "pending" };
    case "suspended":
      return { ...base, state: "ambiguous", errorCode: "wallet_suspended" };
    default:
      return { ...base, state: "ambiguous", errorCode: "wallet_state_unexpected" };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/wallet-core.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` → no errors.

```bash
git add src/providers/provider.ts src/providers/wallet-core.ts tests/unit/wallet-core.test.ts
git commit -F - <<'EOF'
Add shared wallet-core parsing and DD037 peer-push-debit state mapping

GenAI-use: Anthropic Claude (Opus 5.5) implemented this change from the approved design docs/superpowers/specs/2026-10-02-wallet-rpc-transport-design.md. Verification: npx vitest run tests/unit/wallet-core.test.ts and npm run typecheck passed. Owner review: pending.
EOF
```

---

### Task 2: NDJSON framing

**Files:**
- Create: `src/providers/wallet-rpc/framing.ts`
- Test: `tests/unit/wallet-rpc-framing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  encodeFrame,
  FrameTooLargeError,
  NdjsonDecoder,
} from "../../src/providers/wallet-rpc/framing.js";

describe("NDJSON framing", () => {
  it("joins lines split across chunks and splits batched lines", () => {
    const decoder = new NdjsonDecoder(1024);
    expect(decoder.push(Buffer.from('{"a":'))).toEqual([]);
    expect(decoder.push(Buffer.from('1}\n{"b":2}\n{"c"'))).toEqual(['{"a":1}', '{"b":2}']);
    expect(decoder.push(Buffer.from(":3}\n"))).toEqual(['{"c":3}']);
  });

  it("skips blank lines and keeps multi-byte characters intact across chunks", () => {
    const decoder = new NdjsonDecoder(1024);
    const bytes = Buffer.from('{"s":"ă"}\n\n');
    expect([
      ...decoder.push(bytes.subarray(0, 7)),
      ...decoder.push(bytes.subarray(7)),
    ]).toEqual(['{"s":"ă"}']);
  });

  it("rejects a line longer than the limit even before its newline arrives", () => {
    const decoder = new NdjsonDecoder(8);
    expect(() => decoder.push(Buffer.from("123456789"))).toThrow(FrameTooLargeError);
  });

  it("encodes one JSON value per line", () => {
    expect(encodeFrame({ operation: "getVersion", id: "1", args: {} })).toBe(
      '{"operation":"getVersion","id":"1","args":{}}\n',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/wallet-rpc-framing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/providers/wallet-rpc/framing.ts`**

```ts
// wallet-core's RPC socket (taler-util twrpc) exchanges one JSON value per newline-terminated line.
export class FrameTooLargeError extends Error {
  constructor() {
    super("wallet RPC line exceeds the configured limit");
  }
}

export class NdjsonDecoder {
  private parts: Buffer[] = [];
  private length = 0;

  constructor(private readonly maxLineBytes: number) {}

  push(chunk: Buffer): string[] {
    const lines: string[] = [];
    let rest = chunk;
    for (let index = rest.indexOf(0x0a); index >= 0; index = rest.indexOf(0x0a)) {
      this.append(rest.subarray(0, index));
      const line = Buffer.concat(this.parts, this.length).toString("utf8");
      this.parts = [];
      this.length = 0;
      if (line.trim()) lines.push(line);
      rest = rest.subarray(index + 1);
    }
    if (rest.length) this.append(rest);
    return lines;
  }

  private append(part: Buffer): void {
    this.length += part.length;
    if (this.length > this.maxLineBytes) throw new FrameTooLargeError();
    this.parts.push(part);
  }
}

export function encodeFrame(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/wallet-rpc-framing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/wallet-rpc/framing.ts tests/unit/wallet-rpc-framing.test.ts
git commit -F - <<'EOF'
Add NDJSON framing for the wallet-core RPC socket

GenAI-use: Anthropic Claude (Opus 5.5) implemented this change from the approved design docs/superpowers/specs/2026-10-02-wallet-rpc-transport-design.md. Verification: npx vitest run tests/unit/wallet-rpc-framing.test.ts passed. Owner review: pending.
EOF
```

---

### Task 3: Persistent `WalletRpcClient` and fake RPC server

**Files:**
- Modify: `src/metrics.ts`
- Create: `src/providers/wallet-rpc/client.ts`
- Create: `tests/fixtures/fake-wallet-rpc-server.ts`
- Test: `tests/unit/wallet-rpc-client.test.ts`

- [ ] **Step 1: Add the malformed-message metric**

Append to `src/metrics.ts`:

```ts
export const walletRpcMalformedMessages = new Counter({
  name: "libreward_wallet_rpc_malformed_messages_total",
  help: "Wallet RPC messages dropped because they were not understood",
  registers: [registry],
});
```

- [ ] **Step 2: Create the fake server fixture `tests/fixtures/fake-wallet-rpc-server.ts`**

```ts
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type RpcRequest = { operation: string; id: string; args: Record<string, unknown> };
export type Reply =
  | { result: unknown }
  | { error: { code: number; hint: string } }
  | { raw: string }
  | { drop: true }
  | { disconnect: true };
export type Handler = (request: RpcRequest, connection: FakeConnection) => Reply | Promise<Reply>;

export class FakeConnection {
  constructor(readonly socket: Socket) {}

  notify(payload: unknown): void {
    this.socket.write(`${JSON.stringify({ type: "notification", payload })}\n`);
  }
}

export class FakeWalletRpcServer {
  readonly requests: RpcRequest[] = [];
  readonly connections = new Set<FakeConnection>();
  private server: Server | undefined;

  constructor(
    readonly path: string,
    private readonly handler: Handler,
  ) {}

  static async start(handler: Handler): Promise<FakeWalletRpcServer> {
    const name = `libreward-test-${randomBytes(8).toString("hex")}`;
    const path =
      process.platform === "win32" ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
    const instance = new FakeWalletRpcServer(path, handler);
    await instance.listen();
    return instance;
  }

  notifyAll(payload: unknown): void {
    for (const connection of this.connections) connection.notify(payload);
  }

  disconnectAll(): void {
    for (const connection of this.connections) connection.socket.destroy();
  }

  async close(): Promise<void> {
    this.disconnectAll();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
    if (process.platform !== "win32") rmSync(this.path, { force: true });
  }

  private listen(): Promise<void> {
    this.server = createServer((socket) => this.accept(socket));
    return new Promise((resolve, reject) => {
      this.server?.once("error", reject).listen(this.path, resolve);
    });
  }

  private accept(socket: Socket): void {
    const connection = new FakeConnection(socket);
    this.connections.add(connection);
    socket.on("close", () => this.connections.delete(connection));
    socket.on("error", () => undefined);
    let buffered = "";
    socket.setEncoding("utf8").on("data", (chunk: string) => {
      buffered += chunk;
      for (let index = buffered.indexOf("\n"); index >= 0; index = buffered.indexOf("\n")) {
        const request = JSON.parse(buffered.slice(0, index)) as RpcRequest;
        buffered = buffered.slice(index + 1);
        this.requests.push(request);
        void Promise.resolve(this.handler(request, connection)).then((reply) =>
          this.reply(socket, request, reply),
        );
      }
    });
  }

  private reply(socket: Socket, request: RpcRequest, reply: Reply): void {
    if ("drop" in reply) return;
    if ("disconnect" in reply) {
      socket.destroy();
      return;
    }
    if ("raw" in reply) {
      socket.write(reply.raw);
      return;
    }
    const envelope =
      "error" in reply
        ? { type: "error", operation: request.operation, id: request.id, error: reply.error }
        : { type: "response", operation: request.operation, id: request.id, result: reply.result };
    socket.write(`${JSON.stringify(envelope)}\n`);
  }
}
```

- [ ] **Step 3: Write the failing client test `tests/unit/wallet-rpc-client.test.ts`**

```ts
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  WalletCoreError,
  WalletRpcClient,
  WalletRpcError,
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

async function setup(handler: Handler, options: { timeoutMs?: number; maxLineBytes?: number } = {}) {
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
    const [slow, fast] = await Promise.all([client.request("slow", {}), client.request("fast", {})]);
    expect([slow, fast]).toEqual(["slow", "fast"]);
  });

  it("surfaces wallet-core error envelopes", async () => {
    const { client } = await setup(() => ({ error: { code: 7012, hint: "insufficient balance" } }));
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
      connection.socket.write("not json\n{\"type\":\"unknown\"}\n");
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
        process.platform === "win32" ? "\\\\.\\pipe\\libreward-missing" : "/nonexistent/wallet.sock",
      requestTimeoutMs: 1_000,
      maxBackoffMs: 50,
    });
    await expect(client.request("getVersion", {})).rejects.toMatchObject({
      code: "wallet_rpc_unavailable",
    } satisfies Partial<WalletRpcError>);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/unit/wallet-rpc-client.test.ts`
Expected: FAIL — `client.js` not found.

- [ ] **Step 5: Implement `src/providers/wallet-rpc/client.ts`**

```ts
import { randomBytes } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { walletRpcMalformedMessages } from "../../metrics.js";
import { encodeFrame, NdjsonDecoder } from "./framing.js";

export type WalletRpcErrorCode =
  | "wallet_rpc_unavailable"
  | "wallet_rpc_disconnected"
  | "wallet_rpc_timeout"
  | "wallet_rpc_protocol";

/** Transport failure. `wallet_rpc_unavailable` guarantees the request was never written. */
export class WalletRpcError extends Error {
  constructor(
    readonly code: WalletRpcErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** wallet-core answered with an `error` envelope. */
export class WalletCoreError extends Error {
  constructor(
    readonly talerCode: number | undefined,
    readonly hint: string,
  ) {
    super(hint);
  }
}

export type WalletRpcClientOptions = Readonly<{
  socketPath: string;
  requestTimeoutMs: number;
  maxLineBytes?: number;
  maxBackoffMs?: number;
}>;

export type ConnectionChange = "disconnected" | "reconnected";

type Pending = {
  socket: Socket;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
};

export class WalletRpcClient {
  private socket: Socket | undefined;
  private connecting: Promise<Socket> | undefined;
  private readonly pending = new Map<string, Pending>();
  private readonly notificationListeners = new Set<(notification: unknown) => void>();
  private readonly connectionListeners = new Set<(change: ConnectionChange) => void>();
  private failures = 0;
  private nextAttemptAt = 0;
  private everConnected = false;
  private closed = false;

  constructor(private readonly options: WalletRpcClientOptions) {}

  async request<T>(operation: string, args: Record<string, unknown>): Promise<T> {
    const socket = await this.connect();
    const id = `lr-${randomBytes(12).toString("hex")}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WalletRpcError("wallet_rpc_timeout", "wallet-core request timed out"));
      }, this.options.requestTimeoutMs);
      this.pending.set(id, { socket, resolve: resolve as (value: unknown) => void, reject, timer });
      socket.write(encodeFrame({ operation, id, args }));
    });
  }

  onNotification(listener: (notification: unknown) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onConnectionChange(listener: (change: ConnectionChange) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.socket?.destroy();
  }

  private connect(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.closed)
      return Promise.reject(new WalletRpcError("wallet_rpc_unavailable", "wallet RPC client closed"));
    this.connecting ??= this.open().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async open(): Promise<Socket> {
    const wait = this.nextAttemptAt - Date.now();
    if (wait > 0) await delay(wait);
    let socket: Socket;
    try {
      socket = await new Promise<Socket>((resolve, reject) => {
        const candidate = createConnection(this.options.socketPath);
        candidate.once("error", reject);
        candidate.once("connect", () => {
          candidate.off("error", reject);
          resolve(candidate);
        });
      });
    } catch {
      this.failures += 1;
      this.nextAttemptAt =
        Date.now() + Math.min(this.options.maxBackoffMs ?? 30_000, 100 * 2 ** this.failures);
      throw new WalletRpcError("wallet_rpc_unavailable", "wallet-core RPC endpoint is unavailable");
    }
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.attach(socket);
    if (this.everConnected) this.emitConnection("reconnected");
    this.everConnected = true;
    return socket;
  }

  private attach(socket: Socket): void {
    this.socket = socket;
    // Do not keep the process alive only for an idle wallet connection.
    socket.unref();
    const decoder = new NdjsonDecoder(this.options.maxLineBytes ?? 1_048_576);
    socket.on("data", (chunk: Buffer) => {
      let lines: string[];
      try {
        lines = decoder.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const line of lines) this.dispatch(line);
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      if (this.socket === socket) this.socket = undefined;
      for (const [id, pending] of this.pending) {
        if (pending.socket !== socket) continue;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(
          new WalletRpcError("wallet_rpc_disconnected", "wallet-core RPC connection closed"),
        );
      }
      if (!this.closed) this.emitConnection("disconnected");
    });
  }

  private dispatch(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      walletRpcMalformedMessages.inc();
      return;
    }
    if (typeof message !== "object" || message === null) {
      walletRpcMalformedMessages.inc();
      return;
    }
    const envelope = message as Record<string, unknown>;
    if (envelope.type === "notification") {
      for (const listener of this.notificationListeners) {
        try {
          listener(envelope.payload);
        } catch {
          // A failing listener must not break the connection for other callers.
        }
      }
      return;
    }
    if ((envelope.type !== "response" && envelope.type !== "error") || typeof envelope.id !== "string") {
      walletRpcMalformedMessages.inc();
      return;
    }
    const pending = this.pending.get(envelope.id);
    if (!pending) return;
    this.pending.delete(envelope.id);
    clearTimeout(pending.timer);
    if (envelope.type === "response") {
      if ("result" in envelope) pending.resolve(envelope.result);
      else
        pending.reject(
          new WalletRpcError("wallet_rpc_protocol", "wallet-core response has no result"),
        );
      return;
    }
    const detail =
      typeof envelope.error === "object" && envelope.error !== null
        ? (envelope.error as Record<string, unknown>)
        : {};
    const code = typeof detail.code === "number" ? detail.code : detail.talerErrorCode;
    pending.reject(
      new WalletCoreError(
        typeof code === "number" ? code : undefined,
        typeof detail.hint === "string" ? detail.hint : "wallet-core error",
      ),
    );
  }

  private emitConnection(change: ConnectionChange): void {
    for (const listener of this.connectionListeners) {
      try {
        listener(change);
      } catch {
        // Listener failures are isolated, as for notifications.
      }
    }
  }
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/wallet-rpc-client.test.ts`
Expected: PASS (9 tests). If the reconnect test reports `["disconnected"]` only, check that `emitConnection("reconnected")` runs after `attach` in `open`.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npm run typecheck && npx biome check src tests` → clean.

```bash
git add src/metrics.ts src/providers/wallet-rpc/client.ts tests/fixtures/fake-wallet-rpc-server.ts tests/unit/wallet-rpc-client.test.ts
git commit -F - <<'EOF'
Add persistent wallet-core RPC client

One socket connection to `taler-wallet-cli advanced serve`, request/response
correlation, per-request timeouts, notification fan-out, connection-change
signals and bounded reconnect backoff.

GenAI-use: Anthropic Claude (Opus 5.5) implemented this change from the approved design docs/superpowers/specs/2026-10-02-wallet-rpc-transport-design.md. Verification: npx vitest run tests/unit/wallet-rpc-client.test.ts and npm run typecheck passed. Owner review: pending.
EOF
```

---

### Task 4: Migration 003

**Files:**
- Create: `migrations/003_wallet_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
BEGIN;

ALTER TABLE provider_operations
  ADD COLUMN amount_effective_value bigint,
  ADD COLUMN amount_effective_fraction integer
    CHECK (amount_effective_fraction IS NULL OR (amount_effective_fraction >= 0 AND amount_effective_fraction < 100000000)),
  ADD COLUMN wallet_tx_major varchar(32),
  ADD COLUMN wallet_tx_minor varchar(64),
  ADD COLUMN initiated_at timestamptz;

CREATE INDEX provider_operations_external_idx ON provider_operations(external_operation_id)
  WHERE external_operation_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES ('003_wallet_rpc');
COMMIT;
```

All columns are nullable, so version 0.1.0-alpha.1 code keeps working against the migrated schema (rollback = redeploy old code; dropping columns is optional).

- [ ] **Step 2: Verify locally what can be verified**

Run: `npm run check:artifacts` → passes. Migration execution is covered by CI's integration job (`migrate()` in `beforeAll`).

- [ ] **Step 3: Commit**

```bash
git add migrations/003_wallet_rpc.sql
git commit -F - <<'EOF'
Add migration 003 for wallet RPC operation tracking

GenAI-use: Anthropic Claude (Opus 5.5) implemented this change from the approved design docs/superpowers/specs/2026-10-02-wallet-rpc-transport-design.md. Verification: npm run check:artifacts passed; migration runs in CI integration job. Owner review: pending.
EOF
```

---

### Task 5: Split the provider interface; adapt mock, CLI provider and worker

**Files:**
- Modify: `src/providers/provider.ts`, `src/providers/wallet-core.ts`, `src/providers/mock-provider.ts`, `src/providers/taler-wallet-cli-provider.ts`, `src/services/operation-worker.ts`
- Modify: `tests/fixtures/fake-taler-wallet-cli.mjs`, `tests/unit/provider-contract.test.ts`, `tests/unit/taler-wallet-cli-provider.test.ts`, `tests/unit/wallet-core.test.ts`, `tests/integration/reward-flow.test.ts`

- [ ] **Step 1: Replace the interface in `src/providers/provider.ts`**

Replace the `RewardPaymentProvider` interface with the following and add `PreflightResult` above it:

```ts
export type PreflightResult = Readonly<{
  amountEffective: string;
  exchangeBaseUrl?: string;
  quote?: string;
}>;

export interface RewardPaymentProvider {
  readonly key: string;
  verifyConfiguration(): Promise<void>;
  getBalances(): Promise<ProviderBalances>;
  /** Read-only feasibility check; must not create any external effect. */
  preflight(input: CreateOperation): Promise<PreflightResult>;
  /** Creates the external payout and returns its ID. Never retried automatically. */
  initiate(input: CreateOperation, preflight: PreflightResult): Promise<string>;
  /** Read-only wait until the operation is shareable or terminal. */
  waitUntilShareable(externalOperationId: string): Promise<ProviderResult>;
  getOperationStatus(externalOperationId: string): Promise<ProviderResult>;
  cancelOperation(externalOperationId: string): Promise<ProviderResult>;
  /** Optional push signal that an external operation may have changed state. */
  onOperationUpdate?(listener: (externalOperationId: string) => void): () => void;
  close?(): void;
}
```

- [ ] **Step 2: Add check/initiate helpers to `src/providers/wallet-core.ts`**

Change the imports at the top to:

```ts
import { amountAtoms, type Money, parseBalanceAmount, serializeAmount } from "../domain/money.js";
import {
  type CreateOperation,
  type PreflightResult,
  ProviderError,
  type ProviderBalances,
  type ProviderResult,
} from "./provider.js";
```

Append:

```ts
export function peerPushCheckRequest(
  input: CreateOperation,
  exchangeBaseUrl?: string,
): Record<string, unknown> {
  return { amount: serializeAmount(input.amount), ...(exchangeBaseUrl ? { exchangeBaseUrl } : {}) };
}

/** Interprets `checkPeerPushDebit` (wallet API 7:0:0; `peerPushDebitQuote` from 10:0:0). */
export function parsePeerPushCheck(response: unknown, input: CreateOperation): PreflightResult {
  if (!isObject(response)) throw malformedResponse("wallet check response is malformed");
  if (response.type === "insufficient-balance")
    // Nothing was created, so a later retry is safe.
    throw new ProviderError(
      "transient",
      "wallet_insufficient_balance",
      "wallet balance is insufficient for the reward",
    );
  const { amountRaw, amountEffective, exchangeBaseUrl, maxExpirationDate, peerPushDebitQuote } =
    response;
  if (
    response.type !== "ok" ||
    typeof amountRaw !== "string" ||
    typeof amountEffective !== "string" ||
    typeof exchangeBaseUrl !== "string" ||
    !isObject(maxExpirationDate)
  )
    throw malformedResponse("wallet check response is malformed");
  const currencies = new Set([input.amount.currency]);
  let raw: Money;
  let effective: Money;
  try {
    raw = parseBalanceAmount(amountRaw, currencies);
    effective = parseBalanceAmount(amountEffective, currencies);
  } catch {
    throw malformedResponse("wallet check amounts are malformed");
  }
  if (amountAtoms(raw) !== amountAtoms(input.amount))
    throw new ProviderError(
      "permanent",
      "provider_amount_mismatch",
      "wallet check amount did not match reward",
    );
  if (amountAtoms(effective) < amountAtoms(raw))
    throw malformedResponse("wallet effective amount is below the raw amount");
  const maxSeconds = maxExpirationDate.t_s;
  if (typeof maxSeconds !== "number" && maxSeconds !== "never")
    throw malformedResponse("wallet maximum expiration is malformed");
  if (typeof maxSeconds === "number" && maxSeconds < Math.floor(input.expiresAt.getTime() / 1000))
    throw new ProviderError(
      "permanent",
      "wallet_expiration_too_late",
      "reward expiry exceeds the wallet's maximum purse expiration",
    );
  return {
    amountEffective: serializeAmount(effective),
    exchangeBaseUrl,
    ...(typeof peerPushDebitQuote === "string" ? { quote: peerPushDebitQuote } : {}),
  };
}

export function peerPushInitiateRequest(
  input: CreateOperation,
  preflight: PreflightResult,
  exchangeBaseUrl?: string,
): Record<string, unknown> {
  // Pin the exchange the check selected; forward the quote so newer wallets reject drift.
  const exchange = preflight.exchangeBaseUrl ?? exchangeBaseUrl;
  return {
    ...(exchange ? { exchangeBaseUrl: exchange } : {}),
    ...(preflight.quote ? { peerPushDebitQuote: preflight.quote } : {}),
    partialContractTerms: {
      amount: serializeAmount(input.amount),
      summary: input.summary,
      purse_expiration: { t_s: Math.floor(input.expiresAt.getTime() / 1000) },
    },
  };
}

export function parseInitiation(result: unknown): string {
  if (
    !isObject(result) ||
    typeof result.transactionId !== "string" ||
    !result.transactionId.startsWith("txn:peer-push-debit:")
  )
    throw malformedResponse("wallet initiation response is malformed");
  return result.transactionId;
}
```

- [ ] **Step 3: Add helper tests to `tests/unit/wallet-core.test.ts`**

Extend the import list with `parseInitiation, parsePeerPushCheck, peerPushInitiateRequest` and append:

```ts
const input = {
  operationId: "op-1",
  amount: { currency: "KUDOS", value: 1n, fraction: 0 },
  summary: "Reward",
  expiresAt: new Date("2030-01-01T00:00:00Z"),
};
const ok = {
  type: "ok",
  amountRaw: "KUDOS:1",
  amountEffective: "KUDOS:1.01",
  exchangeBaseUrl: "https://exchange.example/",
  maxExpirationDate: { t_s: 1_956_528_000 },
};

describe("wallet-core peer-push check and initiation", () => {
  it("returns the effective amount, exchange and optional quote", () => {
    expect(parsePeerPushCheck(ok, input)).toEqual({
      amountEffective: "KUDOS:1.01",
      exchangeBaseUrl: "https://exchange.example/",
    });
    expect(parsePeerPushCheck({ ...ok, peerPushDebitQuote: "q1" }, input)).toMatchObject({
      quote: "q1",
    });
  });

  it("classifies insufficient balance as transient and unsafe terms as permanent", () => {
    expect(() =>
      parsePeerPushCheck({ type: "insufficient-balance", insufficientBalanceDetails: {} }, input),
    ).toThrow(expect.objectContaining({ classification: "transient", code: "wallet_insufficient_balance" }));
    expect(() => parsePeerPushCheck({ ...ok, amountRaw: "KUDOS:2" }, input)).toThrow(
      expect.objectContaining({ classification: "permanent", code: "provider_amount_mismatch" }),
    );
    expect(() =>
      parsePeerPushCheck({ ...ok, maxExpirationDate: { t_s: 1_800_000_000 } }, input),
    ).toThrow(expect.objectContaining({ code: "wallet_expiration_too_late" }));
    expect(() => parsePeerPushCheck({ ...ok, amountEffective: "KUDOS:0.5" }, input)).toThrow(
      expect.objectContaining({ code: "wallet_malformed_response" }),
    );
  });

  it("builds initiation requests pinned to the checked exchange and quote", () => {
    expect(
      peerPushInitiateRequest(
        input,
        { amountEffective: "KUDOS:1.01", exchangeBaseUrl: "https://checked.example/", quote: "q1" },
        "https://configured.example/",
      ),
    ).toEqual({
      exchangeBaseUrl: "https://checked.example/",
      peerPushDebitQuote: "q1",
      partialContractTerms: {
        amount: "KUDOS:1",
        summary: "Reward",
        purse_expiration: { t_s: 1_893_456_000 },
      },
    });
  });

  it("accepts only peer-push-debit transaction IDs", () => {
    expect(parseInitiation({ transactionId: "txn:peer-push-debit:x" })).toBe("txn:peer-push-debit:x");
    expect(() => parseInitiation({ transactionId: "txn:withdrawal:x" })).toThrow(
      expect.objectContaining({ code: "wallet_malformed_response" }),
    );
  });
});
```

Run: `npx vitest run tests/unit/wallet-core.test.ts` → PASS.

- [ ] **Step 4: Replace `src/providers/mock-provider.ts`**

```ts
import { serializeAmount } from "../domain/money.js";
import type {
  CreateOperation,
  PreflightResult,
  ProviderResult,
  RewardPaymentProvider,
} from "./provider.js";

export class MockProvider implements RewardPaymentProvider {
  readonly key = "mock";
  readonly effects = new Map<string, ProviderResult>();

  async verifyConfiguration(): Promise<void> {}

  async getBalances() {
    return {
      balances: [
        {
          currency: "KUDOS",
          available: "KUDOS:1000000",
          pendingIncoming: "KUDOS:0",
          pendingOutgoing: "KUDOS:0",
          peerPaymentsAllowed: true,
        },
      ],
      haveProductionBalance: false,
    };
  }

  async preflight(input: CreateOperation): Promise<PreflightResult> {
    return { amountEffective: serializeAmount(input.amount) };
  }

  async initiate(input: CreateOperation): Promise<string> {
    const existing = this.effects.get(input.operationId)?.externalOperationId;
    if (existing) return existing;
    const externalOperationId = `mock:${input.operationId}`;
    this.effects.set(input.operationId, {
      state: "ready",
      externalOperationId,
      claimUri: `taler://pay-push/mock/${input.operationId}`,
    });
    return externalOperationId;
  }

  async waitUntilShareable(externalOperationId: string): Promise<ProviderResult> {
    return this.getOperationStatus(externalOperationId);
  }

  async getOperationStatus(externalOperationId: string): Promise<ProviderResult> {
    const result = [...this.effects.values()].find(
      (item) => item.externalOperationId === externalOperationId,
    );
    return result ?? { state: "failed", errorCode: "mock_not_found" };
  }

  async cancelOperation(externalOperationId: string): Promise<ProviderResult> {
    return { state: "cancelled", externalOperationId };
  }

  complete(externalOperationId: string): void {
    for (const [key, result] of this.effects) {
      if (result.externalOperationId === externalOperationId)
        this.effects.set(key, { ...result, state: "succeeded" });
    }
  }
}
```

Update `tests/unit/provider-contract.test.ts`: in the first test replace `provider.createRewardOperation(input)` with `provider.initiate(input)` and the assertion with `expect(new Set(results).size).toBe(1);`. In the second test replace the creation with:

```ts
    const externalId = await provider.initiate({
      operationId: "op-2",
      amount: { currency: "KUDOS", value: 1n, fraction: 0 },
      summary: "Reward",
      expiresAt: new Date(Date.now() + 60_000),
    });
    provider.complete(externalId);
    expect((await provider.getOperationStatus(externalId)).state).toBe("succeeded");
```

- [ ] **Step 5: Add `checkPeerPushDebit` to the CLI fixture**

In `tests/fixtures/fake-taler-wallet-cli.mjs`, add this case in the `switch (operation)` before `case "initiatePeerPushDebit":`:

```js
    case "checkPeerPushDebit":
      process.stdout.write(
        JSON.stringify(
          response({
            type: "ok",
            amountRaw: "KUDOS:1",
            amountEffective: "KUDOS:1.01",
            exchangeBaseUrl: "https://exchange.example/",
            maxExpirationDate: { t_s: 1_956_528_000 },
            defaultExpiration: { d_us: 604_800_000_000 },
          }),
        ),
      );
      break;
```

- [ ] **Step 6: Rewrite `src/providers/taler-wallet-cli-provider.ts`**

Replace the file content above `private async api<T>` (imports, local types, constants, class header and public methods) with the following; keep `api` and `run` unchanged except that `api` now uses the imported `isObject`/`malformedResponse`; delete the file-local `isObject` and `malformedResponse` functions at the bottom.

```ts
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { Config } from "../config.js";
import {
  type CreateOperation,
  type PreflightResult,
  ProviderError,
  type ProviderResult,
  type RewardPaymentProvider,
} from "./provider.js";
import {
  assertSupportedWalletVersion,
  isObject,
  malformedResponse,
  mapPeerPushDebitTransaction,
  parseInitiation,
  parsePeerPushCheck,
  parseWalletBalances,
  peerPushCheckRequest,
  peerPushInitiateRequest,
} from "./wallet-core.js";

type CliOptions = Pick<
  Config,
  | "TALER_WALLET_CLI"
  | "TALER_WALLET_CLI_NODE_SCRIPT"
  | "TALER_WALLET_CRYPTO_WORKER"
  | "TALER_WALLET_COMMAND_TIMEOUT_MS"
  | "TALER_WALLET_DB"
  | "TALER_EXCHANGE_BASE_URL"
> &
  Partial<Pick<Config, "TALER_WALLET_CONNECTION" | "TALER_WALLET_ALLOW_TESTING_API">>;

export class TalerWalletCliProvider implements RewardPaymentProvider {
  readonly key = "taler-wallet-cli";
  constructor(private readonly options: CliOptions) {}

  async verifyConfiguration(): Promise<void> {
    await this.run(["--version"], 10_000);
    assertSupportedWalletVersion(await this.api("getVersion", {}));
    if (!this.options.TALER_WALLET_CONNECTION && !this.options.TALER_WALLET_ALLOW_TESTING_API)
      throw new ProviderError(
        "permanent",
        "wallet_connection_required",
        "a persistent wallet RPC connection is required",
      );
  }

  async getBalances() {
    return parseWalletBalances(await this.api("getBalances", {}));
  }

  async preflight(input: CreateOperation): Promise<PreflightResult> {
    try {
      return parsePeerPushCheck(
        await this.api("checkPeerPushDebit", peerPushCheckRequest(input, this.exchangeBaseUrl())),
        input,
      );
    } catch (error) {
      // checkPeerPushDebit is read-only: an unknown CLI outcome cannot have created a payout.
      if (error instanceof ProviderError && error.classification === "ambiguous")
        throw new ProviderError("transient", error.code, error.message);
      throw error;
    }
  }

  async initiate(input: CreateOperation, preflight: PreflightResult): Promise<string> {
    try {
      return parseInitiation(
        await this.api(
          "initiatePeerPushDebit",
          peerPushInitiateRequest(input, preflight, this.exchangeBaseUrl()),
        ),
      );
    } catch (error) {
      if (
        error instanceof ProviderError &&
        (error.classification === "ambiguous" || error.code.startsWith("taler_"))
      )
        throw error;
      throw new ProviderError(
        "ambiguous",
        "wallet_cli_initiate_unknown",
        "wallet-core initiation outcome is unknown",
      );
    }
  }

  async waitUntilShareable(externalOperationId: string): Promise<ProviderResult> {
    if (!this.options.TALER_WALLET_CONNECTION) {
      // Compatibility path for the verified 1.6.10 sandbox evidence only. The operation name is
      // deliberately isolated here: it is a GNU Taler testing API and is never allowed by the
      // production configuration. Upstream confirmed on 2026-07-14 that it is not deprecated.
      await this.api("testingWaitTransactionState", {
        transactionId: externalOperationId,
        txState: [
          { major: "pending", minor: "ready" },
          { major: "done" },
          { major: "failed", minor: "*" },
          { major: "aborted", minor: "*" },
        ],
      });
      return this.getOperationStatus(externalOperationId);
    }

    const deadline = Date.now() + this.options.TALER_WALLET_COMMAND_TIMEOUT_MS;
    for (;;) {
      const result = await this.getOperationStatus(externalOperationId);
      if (result.state !== "pending") return result;
      if (Date.now() >= deadline)
        throw new ProviderError(
          "ambiguous",
          "wallet_readiness_timeout",
          "wallet transaction did not become shareable before the readiness timeout",
          externalOperationId,
        );
      await delay(100);
    }
  }

  async getOperationStatus(externalOperationId: string): Promise<ProviderResult> {
    return mapPeerPushDebitTransaction(
      await this.api("getTransactionById", { transactionId: externalOperationId }),
      externalOperationId,
    );
  }

  async cancelOperation(externalOperationId: string): Promise<ProviderResult> {
    await this.api("abortTransaction", { transactionId: externalOperationId });
    return { state: "cancelled", externalOperationId };
  }

  private exchangeBaseUrl(): string | undefined {
    return this.options.TALER_EXCHANGE_BASE_URL || undefined;
  }
```

- [ ] **Step 7: Update `tests/unit/taler-wallet-cli-provider.test.ts`**

Add near the top:

```ts
const preflight = {
  amountEffective: "KUDOS:1.01",
  exchangeBaseUrl: "https://exchange.example/",
};
```

Make these replacements:

1. First test — replace the `createRewardOperation` call and its expectation with:

```ts
    await expect(provider.preflight(operation())).resolves.toEqual(preflight);
    const externalId = await provider.initiate(operation(), preflight);
    expect(externalId).toBe("txn:peer-push-debit:fixture");
    await expect(provider.waitUntilShareable(externalId)).resolves.toEqual({
      state: "ready",
      externalOperationId: "txn:peer-push-debit:fixture",
      claimUri: "taler://pay-push/exchange.example/fixture",
      amount: "KUDOS:1",
      walletState: { major: "pending", minor: "ready" },
    });
```

2. "does not retry an unknown initiation timeout": `fixtureProvider("timeout-wallet.sqlite3", 100).initiate(operation(), preflight)`.
3. "maps current wallet errors": `fixtureProvider("error-wallet.sqlite3").initiate(operation(), preflight)`; in the expired expectation add `walletState: { major: "expired" }`.
4. "rejects unverified and malformed wallet versions": change the second expected code to `"wallet_malformed_response"`.
5. "uses stable polling…": `stableFixtureProvider("pending-wallet.sock", 2_000).waitUntilShareable("txn:peer-push-debit:fixture")` (2 s budget so a single Windows process spawn fits).
6. "quarantines a malformed initiation response": `stableFixtureProvider("malformed-init-wallet.sock").initiate(operation(), preflight)`.

- [ ] **Step 8: Rewrite `src/services/operation-worker.ts`**

Replace the imports, the `runOne` method and `applyResult`/`markReward`, add `claimNext`, `input`, `initiate`, `awaitShareable`, and add the `externalOperationId` parameter to `reconcileOne`. Full file:

```ts
import type pg from "pg";
import type { Config } from "../config.js";
import { transaction } from "../db.js";
import { encrypt } from "../domain/crypto.js";
import { publicId, uuid } from "../domain/ids.js";
import { type Money, parseBalanceAmount, serializeAmount } from "../domain/money.js";
import { assertTransition, type RewardStatus } from "../domain/state-machine.js";
import { claimsCompleted, providerDuration, reconciliationBacklog } from "../metrics.js";
import type {
  CreateOperation,
  ProviderResult,
  RewardPaymentProvider,
} from "../providers/provider.js";
import { ProviderError } from "../providers/provider.js";
import { serializedProviderCall } from "./provider-lock.js";
import { type RetentionResult, RetentionService } from "./retention-service.js";

type OperationRow = {
  id: string;
  reward_id: string;
  state: string;
  external_operation_id: string | null;
  retry_count: number;
  amount_value: bigint;
  amount_fraction: number;
  currency: string;
  description: string;
  expires_at: Date;
};

type Initiated = Readonly<{ operation: OperationRow; externalOperationId: string | null }>;

export class OperationWorker {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: Config,
    private readonly provider: RewardPaymentProvider,
  ) {}

  async runOne(): Promise<boolean> {
    // Only wallet writes run under the provider lock (GNU Taler upstream guidance, 2026-07-14).
    const initiated = await serializedProviderCall(
      this.pool,
      async (): Promise<Initiated | null> => {
        const operation = await this.claimNext();
        if (!operation) return null;
        return { operation, externalOperationId: await this.initiate(operation) };
      },
    );
    if (!initiated) return false;
    if (initiated.externalOperationId)
      await this.awaitShareable(initiated.operation, initiated.externalOperationId);
    return true;
  }

  async reconcileOne(rewardPublicId?: string, externalOperationId?: string): Promise<boolean> {
    const result = await this.pool.query<OperationRow>(
      `SELECT po.*,r.description,r.expires_at FROM provider_operations po JOIN rewards r ON r.id=po.reward_id
       WHERE po.external_operation_id IS NOT NULL AND po.state IN ('ready','ambiguous','processing','pending')
       AND ($1::text IS NULL OR r.public_id=$1) AND ($2::text IS NULL OR po.external_operation_id=$2)
       ORDER BY po.updated_at LIMIT 1`,
      [rewardPublicId ?? null, externalOperationId ?? null],
    );
    const operation = result.rows[0];
    if (!operation?.external_operation_id) return false;
    try {
      const providerResult = await serializedProviderCall(this.pool, () =>
        this.provider.getOperationStatus(operation.external_operation_id as string),
      );
      await this.applyResult(operation, providerResult);
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : "provider_reconcile_unknown";
      await this.pool.query(
        "UPDATE provider_operations SET state='ambiguous',last_error_code=$1,updated_at=now() WHERE id=$2",
        [code, operation.id],
      );
      await this.markReward(
        operation.reward_id,
        "reconciliation_required",
        "reward.reconciliation_required",
        {
          code,
        },
      );
    }
    return true;
  }
```

Keep `recoverStale`, `expireDue` and `applyRetention` exactly as they are. Then replace everything from `private async applyResult` to the end of the class with:

```ts
  private async claimNext(): Promise<OperationRow | null> {
    return transaction(this.pool, async (client) => {
      const result = await client.query<OperationRow>(
        `SELECT po.*,r.description,r.expires_at FROM provider_operations po JOIN rewards r ON r.id=po.reward_id
         WHERE po.state IN ('pending','retry') AND po.external_operation_id IS NULL
         AND (po.next_retry_at IS NULL OR po.next_retry_at<=now())
         ORDER BY po.created_at FOR UPDATE OF po SKIP LOCKED LIMIT 1`,
      );
      const row = result.rows[0];
      if (!row) return null;
      await client.query(
        "UPDATE provider_operations SET state='processing',processing_started_at=now(),updated_at=now() WHERE id=$1",
        [row.id],
      );
      return row;
    });
  }

  private input(operation: OperationRow): CreateOperation {
    return {
      operationId: operation.id,
      amount: {
        value: operation.amount_value,
        fraction: operation.amount_fraction,
        currency: operation.currency,
      },
      summary: operation.description,
      expiresAt: operation.expires_at,
    };
  }

  /** Preflight and initiate; returns the external ID, or null when the error was recorded. */
  private async initiate(operation: OperationRow): Promise<string | null> {
    const input = this.input(operation);
    const end = providerDuration.startTimer({ operation: "initiate" });
    let effective: Money;
    let externalOperationId: string;
    try {
      const preflight = await this.provider.preflight(input);
      effective = effectiveAmount(preflight.amountEffective, operation.currency);
      externalOperationId = await this.provider.initiate(input, preflight);
    } catch (error) {
      const providerError = asProviderError(error);
      end({ result: providerError.classification });
      await this.applyError(operation, providerError);
      return null;
    }
    end({ result: "initiated" });
    // Commit the wallet transaction ID before waiting, so a crash cannot lose it.
    await this.pool.query(
      `UPDATE provider_operations SET external_operation_id=$1,initiated_at=now(),
       amount_effective_value=$2,amount_effective_fraction=$3,updated_at=now() WHERE id=$4`,
      [externalOperationId, effective.value, effective.fraction, operation.id],
    );
    return externalOperationId;
  }

  private async awaitShareable(operation: OperationRow, externalOperationId: string): Promise<void> {
    const end = providerDuration.startTimer({ operation: "wait" });
    let result: ProviderResult;
    try {
      result = await this.provider.waitUntilShareable(externalOperationId);
    } catch (error) {
      const providerError = asProviderError(error);
      end({ result: providerError.classification });
      await this.applyError(
        operation,
        new ProviderError("ambiguous", providerError.code, providerError.message, externalOperationId),
      );
      return;
    }
    end({ result: result.state });
    await this.applyResult(operation, { ...result, externalOperationId });
  }

  private async applyResult(operation: OperationRow, result: ProviderResult): Promise<void> {
    const expectedAmount = serializeAmount({
      value: operation.amount_value,
      fraction: operation.amount_fraction,
      currency: operation.currency,
    });
    if (result.amount && result.amount !== expectedAmount) {
      await this.applyError(
        operation,
        new ProviderError(
          "permanent",
          "provider_amount_mismatch",
          "provider amount did not match reward",
        ),
      );
      return;
    }
    await this.pool.query(
      `UPDATE provider_operations SET state=$1::varchar,external_operation_id=COALESCE($2,external_operation_id),
       provider_secret_ciphertext=CASE WHEN $1::varchar='succeeded' THEN NULL ELSE COALESCE($3,provider_secret_ciphertext) END,
       last_error_code=$4,wallet_tx_major=COALESCE($6,wallet_tx_major),
       wallet_tx_minor=CASE WHEN $6::varchar IS NULL THEN wallet_tx_minor ELSE $7 END,
       reconciled_at=now(),updated_at=now()
       WHERE id=$5`,
      [
        result.state,
        result.externalOperationId ?? null,
        result.claimUri ? encrypt(this.config.encryptionKey, result.claimUri) : null,
        result.errorCode ?? null,
        operation.id,
        result.walletState?.major ?? null,
        result.walletState?.minor ?? null,
      ],
    );
    if (result.state === "succeeded") {
      await this.markReward(operation.reward_id, "claimed", "reward.claimed", {
        provider: this.provider.key,
      });
      claimsCompleted.inc();
    } else if (result.state === "ready") {
      // A reconciled operation that is shareable again resumes the claim.
      await this.markReward(
        operation.reward_id,
        "claim_in_progress",
        "reward.claim_resumed",
        {},
        "reconciliation_required",
      );
    } else if (result.state === "failed") {
      await this.markReward(operation.reward_id, "failed", "reward.failed", {
        code: result.errorCode ?? "provider_failed",
      });
    } else if (result.state === "cancelled") {
      // A provider-side cancellation after claim start cannot return to claimable safely.
      // Preserve the provider's cancelled state, but make the reward terminal and observable.
      await this.markReward(operation.reward_id, "failed", "reward.failed", {
        code: result.errorCode ?? "provider_cancelled",
      });
    } else if (result.state === "ambiguous") {
      await this.markReward(
        operation.reward_id,
        "reconciliation_required",
        "reward.reconciliation_required",
        result.errorCode ? { code: result.errorCode } : {},
      );
    }
  }
```

Keep `applyError` unchanged. Replace `markReward` with the version that accepts an optional source-state guard:

```ts
  private async markReward(
    rewardId: string,
    target: RewardStatus,
    eventType: string,
    data: Record<string, unknown>,
    onlyFrom?: RewardStatus,
  ): Promise<void> {
    await transaction(this.pool, async (client) => {
      const result = await client.query<{
        id: string;
        tenant_id: string;
        status: RewardStatus;
        version: number;
      }>("SELECT id,tenant_id,status,version FROM rewards WHERE id=$1 FOR UPDATE", [rewardId]);
      const reward = result.rows[0];
      if (!reward || reward.status === target) return;
      if (onlyFrom && reward.status !== onlyFrom) return;
      assertTransition(reward.status, target);
```

(the remainder of `markReward` is unchanged). After the class add:

```ts
function asProviderError(error: unknown): ProviderError {
  return error instanceof ProviderError
    ? error
    : new ProviderError("ambiguous", "provider_unknown", "unknown provider outcome");
}

function effectiveAmount(amount: string, currency: string): Money {
  try {
    return parseBalanceAmount(amount, new Set([currency]));
  } catch {
    throw new ProviderError(
      "permanent",
      "provider_effective_amount_invalid",
      "provider returned an invalid effective amount",
    );
  }
}
```

- [ ] **Step 9: Update the integration test's inline provider**

In `tests/integration/reward-flow.test.ts`, test "makes provider cancellation after claim start terminal and observable", replace the `cancelledProvider` object with:

```ts
    const cancelledProvider: RewardPaymentProvider = {
      key: "cancelled-fixture",
      verifyConfiguration: async () => undefined,
      getBalances: async () => ({ balances: [], haveProductionBalance: false }),
      preflight: async () => ({ amountEffective: "KUDOS:1" }),
      initiate: async () => "txn:peer-push-debit:cancelled",
      waitUntilShareable: async () => ({ state: "cancelled" }),
      getOperationStatus: async () => ({ state: "cancelled" }),
      cancelOperation: async () => ({ state: "cancelled" }),
    };
```

Add two integration tests before `async function tenant(`:

```ts
  it("persists the wallet transaction ID before waiting and recovers it after a crash", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/rewards",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": "crash-after-initiate" },
      payload: { amount: "KUDOS:1", description: "Crash recovery evidence" },
    });
    const reward = created.json<{ id: string; claim_url: string }>();
    const token = reward.claim_url.split("/").at(-1) as string;
    expect((await app.inject({ method: "POST", url: `/claim/${token}/start` })).statusCode).toBe(202);
    const crashing: RewardPaymentProvider = {
      key: "crash-fixture",
      verifyConfiguration: async () => undefined,
      getBalances: () => provider.getBalances(),
      preflight: (input) => provider.preflight(input),
      initiate: (input) => provider.initiate(input),
      waitUntilShareable: async () => {
        throw new Error("simulated process death");
      },
      getOperationStatus: (id) => provider.getOperationStatus(id),
      cancelOperation: (id) => provider.cancelOperation(id),
    };
    expect(await new OperationWorker(pool, config, crashing).runOne()).toBe(true);
    const row = (
      await pool.query<{ external_operation_id: string; state: string; amount_effective_value: bigint }>(
        `SELECT po.external_operation_id,po.state,po.amount_effective_value FROM provider_operations po
         JOIN rewards r ON r.id=po.reward_id WHERE r.public_id=$1`,
        [reward.id],
      )
    ).rows[0];
    expect(row?.external_operation_id).toMatch(/^mock:/);
    expect(row?.state).toBe("ambiguous");
    expect(row?.amount_effective_value).toBe(1n);
    expect(
      await new OperationWorker(pool, config, provider).reconcileOne(reward.id),
    ).toBe(true);
    const recovered = (
      await pool.query<{ status: string; state: string }>(
        `SELECT r.status,po.state FROM rewards r JOIN provider_operations po ON po.reward_id=r.id
         WHERE r.public_id=$1`,
        [reward.id],
      )
    ).rows[0];
    expect(recovered).toEqual({ status: "claim_in_progress", state: "ready" });
    expect(provider.effects.size).toBeGreaterThan(0);
  });

  it("retries insufficient balance without creating a wallet operation", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/rewards",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": "insufficient-balance" },
      payload: { amount: "KUDOS:1", description: "Insufficient balance evidence" },
    });
    const reward = created.json<{ id: string; claim_url: string }>();
    const token = reward.claim_url.split("/").at(-1) as string;
    expect((await app.inject({ method: "POST", url: `/claim/${token}/start` })).statusCode).toBe(202);
    let initiations = 0;
    const empty: RewardPaymentProvider = {
      key: "empty-fixture",
      verifyConfiguration: async () => undefined,
      getBalances: async () => ({ balances: [], haveProductionBalance: false }),
      preflight: async () => {
        throw new ProviderError("transient", "wallet_insufficient_balance", "insufficient");
      },
      initiate: async () => {
        initiations += 1;
        return "txn:peer-push-debit:never";
      },
      waitUntilShareable: async () => ({ state: "pending" }),
      getOperationStatus: async () => ({ state: "pending" }),
      cancelOperation: async () => ({ state: "cancelled" }),
    };
    expect(await new OperationWorker(pool, config, empty).runOne()).toBe(true);
    expect(initiations).toBe(0);
    const row = (
      await pool.query<{ state: string; external_operation_id: string | null; last_error_code: string }>(
        `SELECT po.state,po.external_operation_id,po.last_error_code FROM provider_operations po
         JOIN rewards r ON r.id=po.reward_id WHERE r.public_id=$1`,
        [reward.id],
      )
    ).rows[0];
    expect(row).toEqual({
      state: "retry",
      external_operation_id: null,
      last_error_code: "wallet_insufficient_balance",
    });
    // Drain so later tests are order-independent.
    await pool.query(
      `UPDATE provider_operations po SET next_retry_at=now() FROM rewards r
       WHERE r.id=po.reward_id AND r.public_id=$1`,
      [reward.id],
    );
    expect(await new OperationWorker(pool, config, provider).runOne()).toBe(true);
  });
```

Add `import { ProviderError } from "../../src/providers/provider.js";` (keep the existing `type RewardPaymentProvider` import, merging into one import statement: `import { ProviderError, type RewardPaymentProvider } from "../../src/providers/provider.js";`).

Note on the crash test: `waitUntilShareable` throwing a plain `Error` is converted by `awaitShareable` to an ambiguous error carrying the known ID — the same state a worker restart produces via `recoverStale`.

- [ ] **Step 9b: Update the funded sandbox script**

In `scripts/run-funded-sandbox.ts`, the insufficient-balance evidence now comes from the preflight, which classifies it as transient. Replace the `try { await providerFor(config).createRewardOperation({…}); … } catch …` block with:

```ts
  let insufficientBalanceCode = "";
  try {
    await providerFor(config).preflight({
      operationId: uuid(),
      amount: { currency, value: 999_999n, fraction: 0 },
      summary: "LibreReward insufficient balance evidence",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    throw new Error("insufficient operator balance unexpectedly passed the wallet preflight");
  } catch (error) {
    if (
      !(error instanceof ProviderError) ||
      error.classification !== "transient" ||
      error.code !== "wallet_insufficient_balance"
    )
      throw error;
    insufficientBalanceCode = error.code;
  }
```

Run: `npm run typecheck` (the script is included via `scripts/**/*.ts`).

- [ ] **Step 10: Run unit tests, typecheck, lint**

Run: `npm run typecheck && npm run test:unit && npx biome check .`
Expected: all PASS (integration tests are skipped locally without `TEST_DATABASE_URL`).

- [ ] **Step 11: Commit**

```bash
git add src/providers src/services/operation-worker.ts tests
git commit -F - <<'EOF'
Split provider creation into preflight, initiate and wait

The worker now runs checkPeerPushDebit before initiatePeerPushDebit,
commits the wallet transaction ID immediately, releases the provider lock
before waiting for readiness, records wallet state, and resumes a reconciled
claim when the operation is shareable again.

GenAI-use: Anthropic Claude (Opus 5.5) implemented this change from the approved design docs/superpowers/specs/2026-10-02-wallet-rpc-transport-design.md. Verification: npm run typecheck, npm run test:unit and biome check passed; PostgreSQL integration tests run in CI. Owner review: pending.
EOF
```

---

### Task 6: `TalerWalletRpcProvider`, configuration and runtime selection

**Files:**
- Modify: `src/providers/wallet-core.ts`
- Create: `src/providers/taler-wallet-rpc-provider.ts`
- Modify: `src/config.ts`, `src/runtime.ts`
- Test: `tests/unit/taler-wallet-rpc-provider.test.ts`, `tests/unit/config.test.ts`

- [ ] **Step 1: Add the notification helper to `src/providers/wallet-core.ts`**

```ts
/** Returns the transaction ID of a `transaction-state-transition` notification, if any. */
export function transitionTransactionId(notification: unknown): string | undefined {
  return isObject(notification) &&
    notification.type === "transaction-state-transition" &&
    typeof notification.transactionId === "string"
    ? notification.transactionId
    : undefined;
}
```

- [ ] **Step 2: Write the failing provider test `tests/unit/taler-wallet-rpc-provider.test.ts`**

```ts
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
    { TALER_WALLET_CONNECTION: server.path, TALER_WALLET_COMMAND_TIMEOUT_MS: timeoutMs, TALER_EXCHANGE_BASE_URL: "" },
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
        ? { result: ready ? tx({ major: "pending", minor: "ready" }, { talerUri: uri }) : tx({ major: "pending", minor: "create-purse" }) }
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
    expect(server.requests.filter((request) => request.operation === "getTransactionById")).toHaveLength(2);
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
    const { server, provider } = await setup(() => ({ result: { balances: [], haveProdBalance: false } }));
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
    const { provider } = await setup(() => ({ result: tx({ major: "suspended", minor: "ready" }) }));
    await expect(provider.getOperationStatus(id)).resolves.toMatchObject({
      state: "ambiguous",
      errorCode: "wallet_suspended",
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/taler-wallet-rpc-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/providers/taler-wallet-rpc-provider.ts`**

```ts
import {
  type CreateOperation,
  type PreflightResult,
  ProviderError,
  type ProviderResult,
  type RewardPaymentProvider,
} from "./provider.js";
import {
  assertSupportedWalletVersion,
  mapPeerPushDebitTransaction,
  parseInitiation,
  parsePeerPushCheck,
  parseWalletBalances,
  peerPushCheckRequest,
  peerPushInitiateRequest,
  transitionTransactionId,
} from "./wallet-core.js";
import { WalletCoreError, WalletRpcClient, WalletRpcError } from "./wallet-rpc/client.js";

type RpcOptions = Readonly<{
  TALER_WALLET_CONNECTION: string;
  TALER_WALLET_COMMAND_TIMEOUT_MS: number;
  TALER_EXCHANGE_BASE_URL?: string | undefined;
}>;

type Tuning = Readonly<{ safetyPollMs?: number; maxBackoffMs?: number }>;

export class TalerWalletRpcProvider implements RewardPaymentProvider {
  readonly key = "taler-wallet-rpc";
  private readonly client: WalletRpcClient;
  private readonly safetyPollMs: number;

  constructor(
    private readonly options: RpcOptions,
    tuning: Tuning = {},
  ) {
    if (!options.TALER_WALLET_CONNECTION)
      throw new ProviderError(
        "permanent",
        "wallet_connection_required",
        "taler-wallet-rpc requires TALER_WALLET_CONNECTION",
      );
    this.client = new WalletRpcClient({
      socketPath: options.TALER_WALLET_CONNECTION,
      requestTimeoutMs: options.TALER_WALLET_COMMAND_TIMEOUT_MS,
      ...(tuning.maxBackoffMs === undefined ? {} : { maxBackoffMs: tuning.maxBackoffMs }),
    });
    this.safetyPollMs = tuning.safetyPollMs ?? 5_000;
  }

  async verifyConfiguration(): Promise<void> {
    assertSupportedWalletVersion(await this.read("getVersion", {}));
  }

  async getBalances() {
    return parseWalletBalances(await this.read("getBalances", {}));
  }

  async preflight(input: CreateOperation): Promise<PreflightResult> {
    return parsePeerPushCheck(
      await this.read("checkPeerPushDebit", peerPushCheckRequest(input, this.exchangeBaseUrl())),
      input,
    );
  }

  async initiate(input: CreateOperation, preflight: PreflightResult): Promise<string> {
    const result = await this.write(
      "initiatePeerPushDebit",
      peerPushInitiateRequest(input, preflight, this.exchangeBaseUrl()),
    );
    try {
      return parseInitiation(result);
    } catch {
      throw new ProviderError(
        "ambiguous",
        "wallet_rpc_initiate_unknown",
        "wallet-core initiation response is malformed",
      );
    }
  }

  async waitUntilShareable(externalOperationId: string): Promise<ProviderResult> {
    let signalled = false;
    let wake: () => void = () => undefined;
    const signal = () => {
      signalled = true;
      wake();
    };
    // Subscribe before the first read so a transition between read and wait is not lost.
    const unsubscribeNotification = this.client.onNotification((notification) => {
      if (transitionTransactionId(notification) === externalOperationId) signal();
    });
    const unsubscribeConnection = this.client.onConnectionChange(signal);
    const deadline = Date.now() + this.options.TALER_WALLET_COMMAND_TIMEOUT_MS;
    try {
      for (;;) {
        signalled = false;
        const result = await this.getOperationStatus(externalOperationId);
        if (result.state !== "pending") return result;
        const remaining = deadline - Date.now();
        if (remaining <= 0)
          throw new ProviderError(
            "ambiguous",
            "wallet_readiness_timeout",
            "wallet transaction did not become shareable before the readiness timeout",
            externalOperationId,
          );
        if (!signalled)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, Math.min(remaining, this.safetyPollMs));
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        wake = () => undefined;
      }
    } finally {
      unsubscribeNotification();
      unsubscribeConnection();
    }
  }

  async getOperationStatus(externalOperationId: string): Promise<ProviderResult> {
    return mapPeerPushDebitTransaction(
      await this.read("getTransactionById", { transactionId: externalOperationId }),
      externalOperationId,
    );
  }

  async cancelOperation(externalOperationId: string): Promise<ProviderResult> {
    await this.write("abortTransaction", { transactionId: externalOperationId });
    return { state: "cancelled", externalOperationId };
  }

  onOperationUpdate(listener: (externalOperationId: string) => void): () => void {
    return this.client.onNotification((notification) => {
      const transactionId = transitionTransactionId(notification);
      if (transactionId?.startsWith("txn:peer-push-debit:")) listener(transactionId);
    });
  }

  close(): void {
    this.client.close();
  }

  private exchangeBaseUrl(): string | undefined {
    return this.options.TALER_EXCHANGE_BASE_URL || undefined;
  }

  private async read(operation: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.client.request(operation, args);
    } catch (error) {
      throw classify(error, "read");
    }
  }

  private async write(operation: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.client.request(operation, args);
    } catch (error) {
      throw classify(error, "write");
    }
  }
}

/**
 * A write whose request may have reached wallet-core is ambiguous and is never retried
 * automatically; `wallet_rpc_unavailable` means nothing was sent. Reads are safe to retry.
 */
function classify(error: unknown, kind: "read" | "write"): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof WalletCoreError)
    return new ProviderError("permanent", `taler_${error.talerCode ?? "unknown"}`, error.hint);
  if (error instanceof WalletRpcError) {
    if (error.code === "wallet_rpc_unavailable")
      return new ProviderError("transient", error.code, error.message);
    if (kind === "write") return new ProviderError("ambiguous", error.code, error.message);
    return new ProviderError(
      error.code === "wallet_rpc_protocol" ? "permanent" : "transient",
      error.code,
      error.message,
    );
  }
  return new ProviderError(
    kind === "write" ? "ambiguous" : "transient",
    "wallet_rpc_unknown",
    "wallet-core outcome is unknown",
  );
}
```

- [ ] **Step 5: Run the provider tests**

Run: `npx vitest run tests/unit/taler-wallet-rpc-provider.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Configuration and runtime**

In `src/config.ts`:

1. Change the enum: `PROVIDER: z.enum(["mock", "taler-wallet-cli", "taler-wallet-rpc"]).default("mock"),`
2. In `loadConfig`, after the existing `taler-wallet-cli` check, add:

```ts
  if (env.PROVIDER === "taler-wallet-rpc" && !env.TALER_WALLET_CONNECTION)
    throw new Error("taler-wallet-rpc requires TALER_WALLET_CONNECTION (the advanced serve socket)");
```

Replace `src/runtime.ts`:

```ts
import type { Config } from "./config.js";
import { MockProvider } from "./providers/mock-provider.js";
import type { RewardPaymentProvider } from "./providers/provider.js";
import { TalerWalletCliProvider } from "./providers/taler-wallet-cli-provider.js";
import { TalerWalletRpcProvider } from "./providers/taler-wallet-rpc-provider.js";

export function providerFor(config: Config): RewardPaymentProvider {
  switch (config.PROVIDER) {
    case "taler-wallet-rpc":
      return new TalerWalletRpcProvider({
        TALER_WALLET_CONNECTION: config.TALER_WALLET_CONNECTION ?? "",
        TALER_WALLET_COMMAND_TIMEOUT_MS: config.TALER_WALLET_COMMAND_TIMEOUT_MS,
        TALER_EXCHANGE_BASE_URL: config.TALER_EXCHANGE_BASE_URL,
      });
    case "taler-wallet-cli":
      return new TalerWalletCliProvider(config);
    default:
      return new MockProvider();
  }
}
```

Add to `tests/unit/config.test.ts` inside the `describe`:

```ts
  it("requires the wallet socket for the RPC provider", () => {
    expect(() => loadConfig({ ...base, PROVIDER: "taler-wallet-rpc" })).toThrow(
      /TALER_WALLET_CONNECTION/,
    );
    expect(
      loadConfig({
        ...base,
        PROVIDER: "taler-wallet-rpc",
        TALER_WALLET_CONNECTION: "/run/taler/wallet.sock",
      }).PROVIDER,
    ).toBe("taler-wallet-rpc");
  });
```

- [ ] **Step 7: Run all unit tests, typecheck, lint**

Run: `npm run typecheck && npm run test:unit && npx biome check .`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -F - <<'EOF'
Add taler-wallet-rpc provider over the persistent wallet-core connection

Readiness is driven by transaction-state-transition notifications, with a
re-read on reconnect and a slow safety poll. Writes that may have reached
wallet-core are ambiguous; reads are retryable.

GenAI-use: Anthropic Claude (Opus 5.5) implemented this change from the approved design docs/superpowers/specs/2026-10-02-wallet-rpc-transport-design.md. Verification: npm run typecheck, npm run test:unit and biome check passed. Owner review: pending.
EOF
```

---

### Task 7: Queue in front of the provider lock

**Files:**
- Modify: `src/services/provider-lock.ts`
- Test: `tests/integration/reward-flow.test.ts`

- [ ] **Step 1: Add a failing integration test for lock release after errors**

Add after the existing "serializes wallet-affecting calls across concurrent workers" test:

```ts
  it("releases the provider lock when the locked work fails", async () => {
    await expect(
      serializedProviderCall(pool, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(serializedProviderCall(pool, async () => "next")).resolves.toBe("next");
    const held = await pool.query<{ count: string }>(
      "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=837650022",
    );
    expect(held.rows[0]?.count).toBe(0n);
  });
```

- [ ] **Step 2: Replace `src/services/provider-lock.ts`**

```ts
import type pg from "pg";

const providerLockId = 837_650_022;
const lockTimeoutMs = 120_000;
const queues = new WeakMap<pg.Pool, Promise<unknown>>();

/**
 * Serializes wallet-affecting calls: an in-process queue ensures each process waits with at
 * most one pooled connection, and a PostgreSQL advisory lock serializes across processes.
 */
export function serializedProviderCall<T>(pool: pg.Pool, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(pool) ?? Promise.resolve();
  const run = previous.then(
    () => lockedCall(pool, work),
    () => lockedCall(pool, work),
  );
  queues.set(
    pool,
    run.catch(() => undefined),
  );
  return run;
}

async function lockedCall<T>(pool: pg.Pool, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('lock_timeout', $1, false)", [`${lockTimeoutMs}ms`]);
    await client.query("SELECT pg_advisory_lock($1)", [providerLockId]);
  } catch (error) {
    client.release(true);
    throw error;
  }
  try {
    return await work();
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [providerLockId]);
      await client.query("RESET lock_timeout");
      client.release();
    } catch {
      // Destroy the session so the lock cannot leak back into the pool.
      client.release(true);
    }
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run test:unit` → PASS. The two lock tests run in CI.

- [ ] **Step 4: Commit**

```bash
git add src/services/provider-lock.ts tests/integration/reward-flow.test.ts
git commit -F - <<'EOF'
Queue provider calls and use a blocking advisory lock with a timeout

GenAI-use: Anthropic Claude (Opus 5.5) implemented this change from the approved design docs/superpowers/specs/2026-10-02-wallet-rpc-transport-design.md. Verification: npm run typecheck and npm run test:unit passed; lock tests run in CI integration job. Owner review: pending.
EOF
```

---

### Task 8: Notification-driven reconciliation and provider shutdown

**Files:**
- Modify: `src/worker-main.ts`, `src/server.ts`
- Test: `tests/integration/reward-flow.test.ts`

- [ ] **Step 1: Add an integration test for reconciliation by external ID**

```ts
  it("reconciles a specific wallet transaction by external ID", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/rewards",
      headers: { authorization: `Bearer ${key}`, "idempotency-key": "reconcile-by-external" },
      payload: { amount: "KUDOS:1", description: "External reconcile evidence" },
    });
    const token = created.json<{ claim_url: string }>().claim_url.split("/").at(-1) as string;
    await app.inject({ method: "POST", url: `/claim/${token}/start` });
    const worker = new OperationWorker(pool, config, provider);
    expect(await worker.runOne()).toBe(true);
    const externalId = (
      await pool.query<{ external_operation_id: string }>(
        "SELECT external_operation_id FROM provider_operations ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0]?.external_operation_id as string;
    provider.complete(externalId);
    expect(await worker.reconcileOne(undefined, "mock:does-not-exist")).toBe(false);
    expect(await worker.reconcileOne(undefined, externalId)).toBe(true);
    expect(
      (
        await pool.query<{ state: string }>(
          "SELECT state FROM provider_operations WHERE external_operation_id=$1",
          [externalId],
        )
      ).rows[0]?.state,
    ).toBe("succeeded");
  });
```

- [ ] **Step 2: Update `src/worker-main.ts`**

After `const liquidity = …` add:

```ts
// Wallet notifications trigger immediate reconciliation; the periodic pass remains the safety net.
const updatedOperations = new Set<string>();
const unsubscribe = provider.onOperationUpdate?.((externalOperationId) =>
  updatedOperations.add(externalOperationId),
);
```

At the top of the `while (!stopping)` body add:

```ts
  for (const externalOperationId of [...updatedOperations]) {
    updatedOperations.delete(externalOperationId);
    await operations.reconcileOne(undefined, externalOperationId);
  }
```

Replace the final `await pool.end();` with:

```ts
unsubscribe?.();
provider.close?.();
await pool.end();
```

- [ ] **Step 3: Update `src/server.ts`**

```ts
const provider = providerFor(config);
const app = buildApp(pool, config, provider);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting_down");
  await app.close();
  provider.close?.();
  await pool.end();
}
```

(replace the existing `const app = …` line and `shutdown` function accordingly).

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck && npm run test:unit && npm run build` → PASS.

```bash
git add src/worker-main.ts src/server.ts tests/integration/reward-flow.test.ts
git commit -F - <<'EOF'
Reconcile on wallet notifications and close the provider on shutdown

GenAI-use: Anthropic Claude (Opus 5.5) implemented this change from the approved design docs/superpowers/specs/2026-10-02-wallet-rpc-transport-design.md. Verification: npm run typecheck, npm run test:unit and npm run build passed; reconcile test runs in CI. Owner review: pending.
EOF
```

---

### Task 9: Documentation and provenance

**Files:**
- Modify: `docs/UPSTREAM_QUESTIONS.md`, `docs/TALER_COMPATIBILITY.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `CHANGELOG.md`, `.env.example`, `deployment/production.env.example`, `docs/GENAI_USAGE.md`, `AI_USAGE.md`
- Create: `docs/adr/ADR-003-wallet-rpc-transport.md`

- [ ] **Step 1: `docs/UPSTREAM_QUESTIONS.md`** — replace the file with:

```markdown
# Questions for GNU Taler upstream

Answers below are quoted from a public reply on the `taler` mailing list (2026-07-14, [msg00007](https://lists.gnu.org/archive/html/taler/2026-07/msg00007.html)). They are guidance, not an approval or support commitment.

## Answered

1. **Operator boundary.** One wallet process owns the database; other CLI processes may connect to the main daemon with `--wallet-connection`. Recommended: serialize writes behind a queue, one daemon, track updates by transaction ID.
2. **Waiting for shareability.** The non-testing way is the `WalletNotification` for the `pending(ready)` state. LibreReward subscribes to `transaction-state-transition` notifications (`taler-wallet-rpc` provider).
3. **Idempotency.** No caller-supplied idempotency key exists or is planned. Call `checkPeerPushDebit` before `initiatePeerPushDebit`; there is no lock between them. Initiation is not idempotent but can be treated as atomic; the transaction ID is the handle.
4. **Testing API.** There is no plan to deprecate `testingWaitTransactionState`.
5. **States.** Peer-push-debit states are those of design document 037.

Upstream also noted that a server-side multi-user API would be a different API and is not a current priority.

## Still open

1. Can `initiatePeerPushDebit` create a transaction yet fail to return its ID, and how should such an unknown outcome be matched without risking a duplicate?
2. Which compatibility dimensions should downstream services gate: implementation version, wallet API version, exchange protocol version, or capabilities?
3. What are the supported abort/expiry semantics before and after a recipient imports the URI?
4. Will the RPC socket protocol (`twrpc`, documented in source as unstable) receive a stability or deprecation signal?
```

- [ ] **Step 2: `docs/TALER_COMPATIBILITY.md`** — replace the second paragraph ("The stable-shaped mode uses …") with:

```markdown
The recommended mode is `PROVIDER=taler-wallet-rpc`: LibreReward keeps one connection to the Unix socket of a long-running `taler-wallet-cli advanced serve --unix-path …` process (`TALER_WALLET_CONNECTION`), speaks its newline-delimited JSON protocol, calls `checkPeerPushDebit` then `initiatePeerPushDebit` (forwarding `peerPushDebitQuote` when a wallet returns one), commits the transaction ID, and waits for `transaction-state-transition` notifications before reading `getTransactionById`. A reconnect triggers a re-read; a slow safety poll covers missed notifications. The worker's queue and PostgreSQL advisory lock serialize wallet writes; readiness waits run outside the lock. `PROVIDER=taler-wallet-cli` with `TALER_WALLET_CONNECTION` remains supported and polls per CLI process.

Upstream source documents the socket protocol as unstable, which is why exact versions are gated. wallet-core 1.6.48 (API `10:0:0`) was source-reviewed on 2026-10-02 but is not enabled until sandbox evidence exists.
```

Change "Current source review used revision …" to: `Source reviewed: tag v1.6.12 and revision 32846ca06070f8a3548a9fac60122eb7ca588864 (v1.6.48, 2026-09-28).`

- [ ] **Step 3: `docs/KNOWN_LIMITATIONS.md`** — replace the second and third bullets with:

```markdown
- Exact wallet-core 1.6.10 and 1.6.12 / API 7:0:0 are gated. The RPC socket protocol is documented upstream as unstable; newer versions need source review and sandbox evidence first. The testing wait API remains only in an explicit non-production compatibility path.
- `initiatePeerPushDebit` has no idempotency key and upstream does not plan one. A `checkPeerPushDebit` preflight runs first, and the transaction ID is committed immediately after initiation, but an initiation whose reply is lost remains an unknown outcome that requires manual reconciliation and is never retried automatically.
- A wallet refusal at initiation after a successful preflight (for example a balance change in between) fails the reward permanently instead of retrying.
```

- [ ] **Step 4: `docs/adr/ADR-003-wallet-rpc-transport.md`**

```markdown
# ADR-003: Persistent wallet-core RPC transport

Status: accepted (2026-10-02)

## Context

The bridge spawned one `taler-wallet-cli` process per wallet call and polled for readiness while holding the provider lock. GNU Taler upstream (taler mailing list, 2026-07-14) recommended notifications for `pending(ready)`, `checkPeerPushDebit` before initiation, one daemon, serialized writes and tracking by transaction ID.

## Decision

Add `PROVIDER=taler-wallet-rpc`, a client for the `advanced serve` Unix socket (newline-delimited JSON, `{operation,id,args}` requests, `response`/`error`/`notification` messages). Split provider creation into `preflight`, `initiate` and `waitUntilShareable`; commit the transaction ID before waiting and release the lock for the wait. Map DD037 states explicitly and fail closed on unknown states.

## Consequences

- No process spawn per call; readiness latency follows wallet notifications.
- The socket protocol is unstable upstream; exact version gating and fake-server contract tests are mandatory.
- Ambiguity rules are explicit: a write that may have reached wallet-core is ambiguous; `wallet_rpc_unavailable` means nothing was sent.
- The CLI provider remains for compatibility and valueless sandbox evidence.
```

- [ ] **Step 5: `docs/ARCHITECTURE.md`** — add a reference: under the provider section (search for "provider") append the sentence `The wallet transport and readiness model are described in [ADR-003](adr/ADR-003-wallet-rpc-transport.md).`

- [ ] **Step 6: `docs/API.md`** — where reward event types are listed (search for `reward.reconciliation_required`), add `reward.claim_resumed` with the description "A reconciled wallet operation became shareable again; the claim continues."

- [ ] **Step 7: `.env.example` and `deployment/production.env.example`** — document the provider:

```dotenv
# mock | taler-wallet-cli | taler-wallet-rpc (recommended; requires TALER_WALLET_CONNECTION)
PROVIDER=taler-wallet-rpc
# Unix socket of `taler-wallet-cli advanced serve --unix-path …`
TALER_WALLET_CONNECTION=/run/taler-wallet/wallet.sock
```

Edit the existing `PROVIDER=` / `TALER_WALLET_CONNECTION=` lines in place rather than duplicating them; in `.env.example` keep the current default value for `PROVIDER` and only add the comment.

- [ ] **Step 8: `CHANGELOG.md`** — add at the top (under any "Unreleased" heading, creating it if absent):

```markdown
## Unreleased

### Added
- `PROVIDER=taler-wallet-rpc`: persistent wallet-core RPC connection with notification-driven readiness (ADR-003).
- `checkPeerPushDebit` preflight before every initiation; `peerPushDebitQuote` forwarded when present.
- Migration `003_wallet_rpc`: effective amount, wallet state and initiation time on provider operations.
- `reward.claim_resumed` event; metric `libreward_wallet_rpc_malformed_messages_total`.

### Changed
- The wallet transaction ID is committed immediately after initiation; readiness waits run outside the provider lock.
- Explicit DD037 state mapping: `suspended`, `dialog` and unknown states are ambiguous.
- Insufficient balance at preflight is retried as transient instead of failing.
- Error code `wallet_cli_malformed_response` is now `wallet_malformed_response`.
- Provider duration metric label `operation="create"` is split into `initiate` and `wait`.

### Upgrade notes
- Run migrations before deploying. Switch `PROVIDER` from `taler-wallet-cli` to `taler-wallet-rpc` when `TALER_WALLET_CONNECTION` is configured.
```

- [ ] **Step 9: Provenance** — add a row to the table in `docs/GENAI_USAGE.md`:

```markdown
| 2026-10-02 | Anthropic Claude Opus 5.5 | Reviewed upstream wallet-core source (v1.6.12, v1.6.48) and the 2026-07-14 upstream mailing-list answers; drafted the design and plan under `docs/superpowers/` and implemented the wallet RPC transport, preflight, state mapping, worker flow, migration 003, tests and documentation. | Commits on branch `wallet-rpc-transport` carrying `GenAI-use:` trailers. |
```

In `AI_USAGE.md` no change is needed (it already names Claude); confirm with `grep -n Claude AI_USAGE.md`.

- [ ] **Step 10: Verify docs**

Run: `npm run docs:links && npm run format:check`
Expected: PASS. Also `grep -rn "wallet_cli_malformed_response" docs src tests` → no matches.

- [ ] **Step 11: Commit**

```bash
git add docs CHANGELOG.md .env.example deployment/production.env.example
git commit -F - <<'EOF'
Document wallet RPC transport and record upstream answers

GenAI-use: Anthropic Claude (Opus 5.5) drafted these documentation changes from the approved design and the public taler mailing-list reply of 2026-07-14. Verification: npm run docs:links and npm run format:check passed. Owner review: pending.
EOF
```

---

### Task 10: Apply open Dependabot updates as a maintainer commit

**Files:**
- Modify: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`

- [ ] **Step 1: List the open PRs and their target versions**

Run: `gh pr list -R robyroro/libreward-bridge --author app/dependabot --state open --json number,title`
Expected: PRs #4, #6, #7, #8, #9, #10.

- [ ] **Step 2: Apply the npm updates (skip majors that break the build)**

```bash
npm install @fastify/helmet@13.1.0 zod@4.4.3
npm install pg@latest @types/pg@latest
npm update --save-dev
```

Then try `npm install undici@8.8.0` separately; if `npm run validate` fails because of the 7→8 major change, revert that single bump (`git checkout package.json package-lock.json` and redo the others) and leave PR #8 open for later.

- [ ] **Step 3: Apply the GitHub Actions bump from PR #4**

Run: `gh pr diff 4 -R robyroro/libreward-bridge` and apply the same `actions/checkout` version change to `.github/workflows/ci.yml` by hand.

- [ ] **Step 4: Verify**

Run: `npm run validate && npm audit --omit=dev`
Expected: validate PASS; audit reports no high/critical issues.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .github/workflows/ci.yml
git commit -F - <<'EOF'
Update dependencies proposed by Dependabot

Supersedes Dependabot PRs #4, #6, #7, #9 and #10 (and #8 if the undici
major update validated).

GenAI-use: Anthropic Claude (Opus 5.5) applied the dependency updates proposed by Dependabot. Verification: npm run validate and npm audit --omit=dev passed. Owner review: pending.
EOF
```

---

### Task 11: Final verification and hand-off

- [ ] **Step 1: Full local validation**

Run: `npm run validate`
Expected: format, lint, typecheck, examples, unit tests, OpenAPI, links, artifacts and build all PASS.

- [ ] **Step 2: Authorship check**

Run: `git log main..wallet-rpc-transport --format='%h %an <%ae> | %(trailers:key=Co-Authored-By)'`
Expected: every commit authored by `robyroro <41092915+robyroro@users.noreply.github.com>` and no `Co-Authored-By` values.

- [ ] **Step 3: Ask the maintainer before pushing**

Pushing publishes the branch on a public repository and starts CI (which runs the PostgreSQL integration tests). Ask for confirmation, then:

```bash
git push -u origin wallet-rpc-transport
```

After CI passes, open a pull request only if the maintainer asks, and close the superseded Dependabot PRs only with their approval.
