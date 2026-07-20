# Readiness remediation

Original audit date: 2026-07-12 in the source monorepo. Standalone recheck: 2026-07-14. Target: a reproducible PostgreSQL-backed sandbox demonstrator. Real-money production remains explicitly out of scope. Historical monorepo runs are not represented as standalone-repository CI evidence.

| Reported blocker | Confirmed | Remediation | Verification | Final status |
| --- | --- | --- | --- | --- |
| `libreward-bridge/` was untracked in the source monorepo | Yes | Extracted the intended source, migrations, tests, lockfile, deployment, examples and docs into this public standalone repository while keeping secrets/build/database/wallet output ignored. | Standalone initial commit `5fb35ac6faea00da81877e5c78df7d385096b29f`. | Completed. |
| Standalone GitHub could not detect CI | Yes | Added the active workflow at `.github/workflows/ci.yml`. | The [first public standalone run](https://github.com/robyroro/libreward-bridge/actions/runs/29366192289) passed test, container and secret-scan jobs on 2026-07-14. | Completed historically; current changes require a new run. |
| PostgreSQL had never been exercised | Yes | The source-monorepo audit used PostgreSQL 17.10, and the standalone recheck started a fresh isolated PostgreSQL 17.10 cluster from the portable distribution already on this host. | Empty migration and all 11 integration tests passed locally and in the public standalone workflow on 2026-07-14. | Completed. |
| Concurrency/integration tests had been skipped | Yes | Added a required CI script and fixed defects exposed by real PostgreSQL. | The 2026-07-14 local and public standalone runs covered 50 concurrent creates, 50 concurrent claim starts, conflict detection, tenant isolation, operator RBAC, liquidity/daily limits, retention, signed webhook delivery and cross-worker serialization. | Completed. |
| Core idempotency was assumed rather than proven | Yes | Fixed PostgreSQL parameter type ambiguity and excluded server-generated default expiry timestamps from the client request fingerprint. | PostgreSQL integration/concurrency suite passes. | Completed. |
| Docker/Compose was not executed | Yes | CI builds and starts Compose, waits for PostgreSQL/API/worker health, and calls `/healthz` and `/readyz`. The worker uses a process-specific liveness check instead of inheriting the API HTTP probe. | The standalone container job passed publicly on 2026-07-14. | Completed in CI; local execution remains unavailable on this Windows host. |
| No current GNU Taler CLI verification | Yes | Verified current upstream source and direct API names; added an optional Node-script launch path for source builds. | Official wallet source revision `20c1818449d024bd36fd7fc146631ecc44858fa3` built locally; wallet `getVersion` and Bridge `provider:check` passed with wallet 1.6.10/protocol 7. | CLI compatibility completed. |
| No pre-funded GNU Taler sandbox-wallet payout | Yes | Added a guarded evidence harness and executed the valueless demo matrix with three distinct wallet databases. “Pre-funded” refers to test-wallet balance, not a grant. | Success, two-recipient race, restart, expiry, insufficient-balance, terms, timeout, and pre-claim cancellation evidence is recorded in `SANDBOX_EVIDENCE_2026-07-12.md`. | Completed for sandbox; production remains prohibited. |
| Commercial-platform adapter is only an example | Yes | Defined the request and webhook verification boundary and required two false-by-default sandbox flags. | PHP syntax checks and documentation review. | Boundary completed; Laravel routes/migrations/UI deliberately not wired. |
| AGPL license text was incomplete | Yes | Replaced the staging notice with the canonical GNU AGPL-3.0 text and added copyright/GenAI provenance records. | `npm run license:check`; GitHub license detection; manual inspection. | License declaration completed; maintainer ownership/relicensing confirmation remains a factual pre-submission check. |
| Webhook delivery integration test missing | Yes | Added a PostgreSQL-backed local HTTP receiver test covering raw-body signature verification and delivery persistence. | Integration suite. | Completed. |
| Operator functions were CLI-only | Yes | Added separate operator accounts and `lro_` keys, viewer/operator/admin scopes, audited read/reconcile/retry/liquidity/retention endpoints, and key lifecycle CLI commands. | PostgreSQL operator isolation, authorization, audit, and liquidity integration test. | Completed for the standalone service; private ingress remains deployment work. |
| No enforceable liquidity/liability controls | Yes | Added wallet `getBalances` snapshots, stale/low/blocked fail-closed claim/readiness checks, exact atomic daily currency caps, bounded metrics, structured alerts, and Prometheus rules. | Provider unit mapping plus PostgreSQL liquidity and daily-cap integration tests. | Completed as operational controls; treasury reserve/safeguarding approval remains external. |
| Retention values were fixed in code | Yes | Added configurable claim/provider/webhook/revoked-key periods, recorded worker execution, and admin dry-run/execution. Core financial/event/audit deletion remains intentionally policy-gated. | PostgreSQL retention deletion test and run record. | Completed for short-lived secrets/metadata. |
| Production KYC/refund/incident procedures absent | Yes | Added decision runbooks and independent security/privacy/legal/accounting review package. | Documentation and threat-model review. | Package completed; external sign-offs remain pending. |

## Defects found by real PostgreSQL execution

1. Reward/provider transition SQL reused one parameter as both `varchar` and `text`, causing PostgreSQL `42P08` and HTTP 500 responses. Explicit casts now make the intended database type unambiguous.
2. The default expiration timestamp was generated independently for each retry and included in the idempotency fingerprint. Identical concurrent requests therefore conflicted. The fingerprint now includes a normalized expiry only when the client supplied one.
3. Integration assertions expected PostgreSQL `bigint` counts as strings even though the database layer intentionally parses them as `bigint`. Assertions now match the configured parser.
4. The initial unique-violation recovery released its database connection and queued a second lookup behind other concurrent requests. Under combined-suite load this could exhaust the five-second pool acquisition window. Creation now uses one database-native `INSERT ... ON CONFLICT DO NOTHING` transaction and resolves the idempotent result on the same connection. Ten consecutive full 25-test stress runs passed after this change.
5. The wallet adapter called `run-until-done` immediately after initiating a peer-push debit. That waits for recipient completion, but the recipient cannot act until the Bridge returns the URI, creating a deadlock. The adapter now waits only for the pending/ready transaction state and returns the URI before claim.
6. Current wallet failures use `error.code` and `error.hint`, while the adapter only read legacy fields. Both envelope shapes are now normalized and covered by unit tests; CLI execution also has a configurable hard timeout whose ambiguous result is never automatically retried.
7. A purse that expired after claim start became provider `cancelled` but left the reward in `claim_in_progress`. Reconciliation now maps that provider terminal state to a failed reward, records one final webhook, and does not create a replacement purse.

## Verification commands

```sh
npm ci --ignore-scripts
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run migrate
TEST_DATABASE_URL=postgres://... npm run test:integration:required
npm run openapi:validate
npm audit --omit=dev --audit-level=high
npm run license:check
```

The active standalone workflow runs these commands and its first public run passed all jobs on 2026-07-14. Pre-funded valueless demo-wallet evidence is recorded in `SANDBOX_EVIDENCE_2026-07-12.md`; real-money use remains prohibited until upstream risk is accepted and the named independent security/privacy/legal/accounting reviews approve it.
