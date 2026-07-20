# GNU Taler compatibility

The provider is checked against official GNU Taler documentation and source. Verified exact wallet-core versions are `1.6.10` and `1.6.12`, with wallet API `7:0:0`. Other versions fail `provider:check`; support must be added only after source review and sandbox evidence.

The stable-shaped mode uses one long-running `taler-wallet-cli advanced serve` process and `TALER_WALLET_CONNECTION`, then calls stable `initiatePeerPushDebit`, polls `getTransactionById` until the peer-push URI is shareable or terminal, uses `abortTransaction` for cancellation, and reconciles the known transaction after restart. The worker/provider advisory lock serializes calls, but the wallet server remains the only process allowed to control its wallet database.

GNU Taler 1.6.12 source still exposes `testingWaitTransactionState` as a testing API. LibreReward keeps it only behind `TALER_WALLET_ALLOW_TESTING_API=true` for verified valueless sandbox evidence when no RPC connection is configured. Production configuration rejects this flag. No upstream approval is claimed.

If initiation times out before returning an ID, the outcome is ambiguous and no automatic initiation occurs. If an ID is known but readiness polling times out, the ID is persisted and reconciled. Raw CLI stderr is not propagated because it may contain sensitive wallet detail.

Primary references: [wallet-core API](https://docs.taler.net/wallet/wallet-core.html), [wallet developer manual](https://docs.taler.net/developer/taler-wallet-developer.html), [transaction lifecycle](https://docs.taler.net/design-documents/037-wallet-transactions-lifecycle.html), and [official TypeScript source](https://git.taler.net/taler/taler-typescript-core/). Current source review used revision `f05453936da5f2132757812eafb7ce66d9882f89` (2026-07-20). Upstream questions remain in [UPSTREAM_QUESTIONS.md](UPSTREAM_QUESTIONS.md).
