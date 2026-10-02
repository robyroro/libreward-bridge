# Wallet RPC transport and upstream alignment — design

Date: 2026-10-02. Status: approved by the maintainer for planning.

## Context

On 2026-07-14 GNU Taler upstream answered the questions in `docs/UPSTREAM_QUESTIONS.md` on the `taler` mailing list ([msg00007](https://lists.gnu.org/archive/html/taler/2026-07/msg00007.html)). Summary of the answers:

1. There is no caller-supplied idempotency key and none is planned. Callers use `checkPeerPushDebit` before `initiatePeerPushDebit`; there is no lock between the two. `initiatePeerPushDebit` is not idempotent but can be treated as atomic; the transaction ID is the tracking handle.
2. The non-testing way to wait is the `WalletNotification` for the `pending(ready)` state. `testingWaitTransactionState` is not planned for deprecation.
3. One wallet process owns the database. Additional CLI processes may connect to the main daemon with `--wallet-connection`.
4. Peer-push-debit states are those in design document 037.
5. Serialize writes (queue in front), run one daemon, track updates by transaction ID, optionally use read-only remote CLIs.

Upstream also said a multi-user/server API would be a different API and is not a current priority.

Today the bridge spawns one `taler-wallet-cli` process per wallet call, polls `getTransactionById` every 100 ms, never calls `checkPeerPushDebit`, holds the provider lock while waiting for readiness, and persists the wallet transaction ID only after readiness wait completes.

## Verified upstream facts (source review)

Reviewed `taler-typescript-core` at tag `v1.6.12` and at `HEAD` `32846ca0` (v1.6.48, 2026-09-28):

- `taler-wallet-cli advanced serve --unix-path <path>` serves wallet-core over a Unix domain socket using newline-delimited JSON. Request: `{"operation", "id", "args"}`. Reply: `{"type": "response" | "error", "id", ...}` with `result` or `error`. Every connected client also receives `{"type": "notification", "payload": WalletNotification}`. Framing is identical in both revisions.
- `twrpc.ts` states the protocol is "completely unstable and only used internally". Exact-version gating therefore stays mandatory.
- `transaction-state-transition` notifications carry `transactionId`, `oldTxState`, `newTxState`, optional `errorInfo`; `newStId` is test-only and must not be used.
- `checkPeerPushDebit` (API 7:0:0) returns `{type: "ok", amountRaw, amountEffective, exchangeBaseUrl, maxExpirationDate}` or `{type: "insufficient-balance", insufficientBalanceDetails}`.
- From API 10:0:0 the ok response may include an opaque `peerPushDebitQuote`; passing it to `initiatePeerPushDebit` makes wallet-core reject the initiation when coin selection, fees or exchange changed since the check. API 10 is **not** added to the allow-list in this change (no sandbox evidence yet); the code forwards the quote whenever one is returned.

## Goals

- Talk to the wallet daemon over one persistent RPC connection instead of a process per call.
- Wait for shareability via notifications, with polling only as a safety net.
- Preflight every payout with `checkPeerPushDebit`.
- Persist the wallet transaction ID in its own committed transaction immediately after initiation.
- Hold the provider lock only around wallet writes.
- Map every DD037 peer-push-debit state explicitly; fail closed on anything unknown.
- Record upstream answers in the documentation.

## Non-goals

- No new wallet versions in the allow-list (1.6.10 and 1.6.12 / API 7:0:0 only).
- No removal of the CLI provider or the testing-API sandbox path.
- No real-money support, no change to tenant API semantics, no fee caps.

## Design

### 1. `WalletRpcClient` (`src/providers/wallet-rpc/client.ts`)

- Connects with `node:net` to `TALER_WALLET_CONNECTION` (Unix socket path; on Windows, Node named pipes for tests only).
- NDJSON framing: buffer partial lines across chunks, handle several messages per chunk, reject any line over 1 MiB by closing the connection.
- Request IDs: `lr-<random>`; pending map with a per-request timeout (`TALER_WALLET_COMMAND_TIMEOUT_MS`).
- Notifications are emitted to subscribers; malformed messages are counted in a metric and dropped, never logged with content.
- Disconnect: every in-flight request is rejected with `wallet_rpc_disconnected`. The provider classifies it: write operations (`initiatePeerPushDebit`, `abortTransaction`) → `ambiguous`; reads → `transient`.
- Reconnect lazily on the next request with exponential backoff (cap 30 s). Notification subscribers are told about reconnects so waiters re-read state.

### 2. `TalerWalletRpcProvider` (`src/providers/taler-wallet-rpc-provider.ts`)

New `PROVIDER=taler-wallet-rpc`, requiring `TALER_WALLET_CONNECTION`. `taler-wallet-cli` keeps its current behavior; operators are told in the changelog to switch.

The `RewardPaymentProvider` interface splits creation:

- `preflight(input)` → `checkPeerPushDebit`. `insufficient-balance` → `ProviderError("transient", "wallet_insufficient_balance")` (nothing was created, so retrying is safe). `maxExpirationDate` earlier than the reward expiry → permanent `wallet_expiration_too_late`. `amountRaw` differing from the requested amount → permanent `provider_amount_mismatch`. Returns `{ amountEffective, exchangeBaseUrl, quote? }`.
- `initiate(input, preflight)` → `initiatePeerPushDebit` with the same exchange and, if present, the quote. Returns the transaction ID. Any failure after the request was written → `ambiguous`.
- `waitUntilShareable(txId)` → subscribe to notifications for that ID first, then read `getTransactionById`; resolve on a shareable or terminal state; on reconnect or every 5 s re-read state; on timeout throw `ambiguous` `wallet_readiness_timeout` carrying the ID.
- `getOperationStatus`, `cancelOperation`, `getBalances`, `verifyConfiguration` keep their contracts over RPC.

The mock and CLI providers implement the split interface (CLI: `preflight` calls `checkPeerPushDebit` too; `waitUntilShareable` keeps today's polling/testing logic).

### 3. State mapping (DD037, peer-push-debit)

| Wallet `major` (`minor`) | Provider state | Notes |
| --- | --- | --- |
| `pending` (`create-purse`, any non-`ready`) | `pending` | |
| `pending` (`ready`) | `ready` | URI must match `taler://pay-push/` |
| `finalizing` | `pending` | |
| `aborting` (any) | `pending` | recorded as aborting; not cancelled until `aborted` |
| `suspended` (any) | `ambiguous` | code `wallet_suspended`; operator must resume or abort |
| `done` | `succeeded` | |
| `aborted` | `cancelled` | |
| `expired`, `failed`, `deleted` | `failed` | code `wallet_<major>` |
| `dialog` or any unknown major | `ambiguous` | code `wallet_state_unexpected`; fail closed |

The raw `major`/`minor` is stored for operators. DD037 lists no KYC state for peer-push-debit; KYC applies on the receiving side and is documented as such.

### 4. Worker flow

1. Under the provider lock: claim the operation (`processing`), `preflight`, `initiate`, then commit `external_operation_id`, `initiated_at`, `amount_effective` in its own transaction. Release the lock.
2. Outside the lock: `waitUntilShareable`, then `applyResult`.
3. A crash after step 1 leaves a known ID: `recoverStale` marks it `ambiguous`, and `reconcileOne` can now resolve it from wallet state. A reconciled `ready` operation moves its reward from `reconciliation_required` back to `claim_in_progress` (allowed transition).
4. `serializedProviderCall` uses blocking `pg_advisory_lock` with a session `lock_timeout` instead of a 25 ms try-lock loop.
5. With the RPC provider, the worker listens to state-transition notifications and reconciles the matching operation immediately; periodic reconciliation stays as the safety net.

The invariant is unchanged: if an external payout may exist, never initiate a replacement automatically.

### 5. Database

Migration `003_wallet_rpc.sql` adds to `provider_operations`: `amount_effective_value bigint`, `amount_effective_fraction integer`, `wallet_tx_major varchar(32)`, `wallet_tx_minor varchar(64)`, `initiated_at timestamptz`, and an index on `external_operation_id`. Existing migrations are not edited. Rollback: columns are nullable and unused by older code.

### 6. Documentation

- `docs/UPSTREAM_QUESTIONS.md`: record answers with the mailing-list link; keep open questions 4–6 (unknown-outcome matching, abort semantics after import, compatibility dimensions).
- `docs/TALER_COMPATIBILITY.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`, `.env.example`, `docs/API.md` if operator-visible fields change.
- New `docs/adr/ADR-003-wallet-rpc-transport.md`.
- `docs/GENAI_USAGE.md` and `AI_USAGE.md`: provenance row for this work.

### 7. Testing

- `tests/fixtures/fake-wallet-rpc-server.ts`: socket server speaking the NDJSON protocol, scriptable per test.
- Unit: framing (split lines, batched lines, oversize line), request timeout, disconnect mid-request (write → ambiguous, read → transient), notification before response, ready-before-subscribe race, malformed envelopes, every state-table row, insufficient balance, expiration too late, quote forwarding.
- Integration (PostgreSQL, `TEST_DATABASE_URL`): transaction ID persisted when the worker dies after initiation; concurrent workers create exactly one wallet operation; insufficient balance creates none and retries; lock released while waiting (a second operation initiates during the first's wait).
- `npm run validate` must pass.

## Commits and authorship

Commits are authored by the maintainer's git identity only, without `Co-Authored-By` trailers. As required by `AGENTS.md` and `docs/GENAI_USAGE.md`, each commit carries a `GenAI-use:` trailer describing the assistance, and provenance docs are updated. Dependency updates from the open Dependabot PRs are applied in a separate maintainer commit.

## Risks

- The RPC protocol is declared unstable upstream; mitigated by exact version gating and the fake-server contract tests.
- Notifications can be missed during reconnects; mitigated by re-reading state on reconnect and periodic reconciliation.
- Lock release before readiness means several initiated operations may wait concurrently; acceptable because waits are reads.
