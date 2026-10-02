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
