# Changelog

## Unreleased

### Added

- `PROVIDER=taler-wallet-rpc`: persistent wallet-core RPC connection with notification-driven readiness ([ADR-003](docs/adr/ADR-003-wallet-rpc-transport.md)).
- `checkPeerPushDebit` preflight before every initiation; `peerPushDebitQuote` forwarded when present.
- Migration `003_wallet_rpc`: effective amount, wallet state and initiation time on provider operations.
- `reward.claim_resumed` event; metric `libreward_wallet_rpc_malformed_messages_total`.

### Changed

- The wallet transaction ID is committed immediately after initiation; readiness waits run outside the provider lock.
- Explicit DD037 state mapping: `suspended`, `dialog` and unknown states are ambiguous.
- Insufficient balance at preflight is retried as transient instead of failing.
- Error code `wallet_cli_malformed_response` is now `wallet_malformed_response`.
- Provider duration metric label `operation="create"` is split into `initiate` and `wait`.
- Upstream answers from the GNU Taler mailing list are recorded in [Upstream questions](docs/UPSTREAM_QUESTIONS.md).

### Upgrade notes

- Run migrations before deploying. Switch `PROVIDER` from `taler-wallet-cli` to `taler-wallet-rpc` when `TALER_WALLET_CONNECTION` is configured.

## 0.1.0-alpha.1 - Unreleased

- Standardized LibreReward Bridge positioning and research-prototype warnings.
- Added safe proxy trust parsing, optional metadata disablement, bounded metadata, and stricter expiry/value validation.
- Added persistent GNU Taler wallet RPC polling, exact version/API gates, sandbox-only isolation of the testing wait API, malformed response checks, and known-ID preservation.
- Hardened migration locking, authentication comparisons, encryption-envelope parsing, amount aggregation, operator reference ambiguity, logging, and expired-state transaction handling.
- Expanded the TypeScript SDK, webhook secret rotation, OpenAPI route drift checks, tests, CI, external review material, and grant draft.

No release has been published. See [Upgrade policy](docs/UPGRADE_POLICY.md) for behavior changes and [Known limitations](docs/KNOWN_LIMITATIONS.md) for blockers.
