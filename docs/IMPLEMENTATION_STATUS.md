# Implementation status

## Repository audit and architecture

- Completed: repository/payout/ledger/auth/jobs/deployment audit; extraction boundary; standalone and Taler-flow ADRs; domain/state/data model; OpenAPI 3.1.
- Partially completed: the public upstream request was sent to `taler@gnu.org` on 2026-07-12; an archive URL and maintainer response are pending.
- Blocked: none.
- Not started: upstream protocol contribution.
- Reason: requires maintainer coordination and should not be inferred from local implementation authority.
- Next action: monitor the public list, record the archive/reply, and implement or explicitly accept the resulting interface guidance.
- Relevant files: `docs/adr/*`, `openapi.yaml`, `docs/ARCHITECTURE.md`.
- Test coverage: OpenAPI validator and state/money unit tests.

## Core service

- Completed: PostgreSQL 17.10 migrations, tenant API keys, separate operator accounts/keys and viewer/operator/admin scopes, audited operator HTTP API, exact money, reward CRUD/cancel/regeneration/events, hashed claims, accessibility-oriented claim interface, concurrent idempotency, atomic daily payout caps, and deterministic provider.
- Partially completed: core financial/event/audit retention remains deployment-controlled pending approved accounting and legal-hold periods.
- Blocked: none for the PostgreSQL-backed core.
- Not started: production financial-record deletion, which intentionally awaits legal/accounting approval.
- Reason: deleting accounting/audit evidence without an approved jurisdiction-specific period would be unsafe.
- Next action: obtain the external decisions in `SECURITY_PRIVACY_LEGAL_REVIEW.md` and configure the approved periods.
- Relevant files: `src/`, `migrations/001_initial.sql`, `migrations/002_operator_hardening.sql`, `tests/`.
- Test coverage: on 2026-07-14 all 11 PostgreSQL 17.10 integration tests passed both in the standalone checkout and in the [first public standalone workflow](https://github.com/robyroro/libreward-bridge/actions/runs/29366192289), covering 50-way create/claim concurrency, conflicting idempotency reuse, tenant isolation, operator RBAC/audit, atomic daily caps, retention, signed webhooks and cross-worker serialization.

## GNU Taler provider

- Completed: provider contract, peer-push wallet-core CLI adapter, response/state validation, encrypted URI storage, mock/CLI contract tests, known-ID reconciliation, manual reconcile CLI, current official wallet CLI 1.6.10 `getVersion` verification, and pre-funded valueless demo-wallet success/race/restart/expiry/insufficient-balance evidence.
- Partially completed: KYC thresholds were not deliberately triggered; initiation still lacks an upstream idempotency key; production certification is not claimed.
- Blocked: none for the sandbox demonstrator. The current official CLI was built from upstream source because the registry package is stale.
- Not started: upstream idempotency extension and production certification.
- Reason: upstream changes and production compliance require external coordination.
- Next action: discuss initiation idempotency with GNU Taler maintainers and define production KYC/liquidity controls before any real-money pilot.
- Relevant files: `src/providers/`, `src/services/operation-worker.ts`, `docs/TALER_SETUP.md`.
- Test coverage: deterministic 50-way provider idempotency test, direct API envelope/peer-push mapping, current error-envelope and timeout tests, real current CLI configuration check, and the pre-funded demo-wallet evidence matrix in `docs/SANDBOX_EVIDENCE_2026-07-12.md`.

## Webhooks and operations

- Completed: generated encrypted endpoint secrets, deterministic HMAC signatures, event IDs, bounded retries, stale-worker recovery, URL scheme/port/DNS/public-IP checks, no redirects, timeouts/response cap, health/readiness/version/Prometheus metrics, authenticated delivery history/retry, wallet balance snapshots, fail-closed liquidity readiness, and alert rules.
- Partially completed: production alert routing and private operator ingress are deployment responsibilities.
- Blocked: none for development.
- Not started: deployment-specific paging destinations and identity-aware proxy policy.
- Reason: these depend on the operator's infrastructure.
- Next action: deploy `prometheus-alerts.yml`, private operator ingress, and an on-call route during the production pilot setup.
- Relevant files: `src/services/webhook-service.ts`, `src/domain/webhook-signing.ts`, `docs/API.md`, `docs/THREAT_MODEL.md`.
- Test coverage: signature/timestamp/tamper unit tests plus PostgreSQL-backed local HTTP delivery and persistence integration test.

## Commercial-platform reference adapter

- Completed: isolation, state/accounting mapping, two false-by-default sandbox flags, example client boundary, and raw-body webhook verifier boundary.
- Partially completed: reference code is not wired into the commercial application.
- Blocked: production/business approval for currency, liability, refunds, and user exposure.
- Not started: migration/UI/webhook route in the commercial application.
- Reason: the request forbids production enablement and requires the generic core first; owner decisions remain.
- Next action: none in this workstream; Recompensated integration is explicitly excluded.
- Relevant files: `docs/RECOMPENSATED_REFERENCE_INTEGRATION.md`, `examples/recompensated-adapter/`.
- Test coverage: example translation tests remain to add when integrated with Laravel.

## Hardening and public release

- Completed: strict TypeScript, Biome, Vitest, an active standalone CI definition, non-root/read-only containers, Compose/PostgreSQL definitions, AGPL, SBOM and license checks, audit and secret-scan jobs, operator access controls, liquidity gates, retention automation, production runbooks, threat/privacy documentation, and an external-review package.
- Partially completed: local and public unit/static/PostgreSQL/container/secret-scan gates and the prior pre-funded demo-wallet evidence pass; external reviews, upstream response, alert routing, and deployment-specific treasury/legal configuration remain.
- Blocked: real-money production approval is blocked on named independent reviewers and owner/legal/accounting sign-off. Sandbox development and grant submission preparation are not blocked by those production decisions.
- Not started: independent penetration/privacy and qualified legal/accounting review.
- Reason: external tooling/reviewer and owner/legal approval are required.
- Next action: commission the reviews in `SECURITY_PRIVACY_LEGAL_REVIEW.md`, record evidence URLs/decisions, and close high/critical findings before merge or production.
- Relevant files: `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `deployment/standalone-ci.yml`, `SECURITY.md`, `docs/LICENSING.md`.
- Test coverage: on 2026-07-14 the standalone checkout passed formatter/lint/type/unit/provider/OpenAPI/build/audit/license checks and all 11 PostgreSQL 17.10 integration tests. This host lacks a container runtime, but the [public GitHub workflow](https://github.com/robyroro/libreward-bridge/actions/runs/29366192289) independently passed the Compose and secret-scan jobs.
