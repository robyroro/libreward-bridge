# Proposed NGI TALER milestone mapping

- M1 Research/specification — completed: repository audit, current API research, flow/standalone ADRs, OpenAPI, architecture, threat/privacy/data models.
- M2 Core reward service — completed for pre-release: schema, tenant/operator keys, RBAC/audit, exact money, idempotent rewards, hashed claims, state machine, claim UI, deterministic provider, and unit/PostgreSQL integration suites.
- M3 GNU Taler integration — completed for the sandbox demonstrator: the official wallet-core peer-push CLI adapter, balance checks, reconciliation, and funded valueless success/race/restart/expiry/insufficient-balance matrix pass; upstream initiation idempotency and production interface approval remain.
- M4 Reference integration — partially completed: boundary and example client documented; the commercial production application is deliberately unchanged and the feature remains unavailable.
- M5 Quality/security/release — partially completed: container/Compose/CI, PostgreSQL, SBOM, canonical license, dependency audit, operator RBAC/audit, retention automation, liquidity caps/alerts, runbooks, and funded sandbox checks pass; independent audit and production legal/accounting approval remain.

An honest milestone demonstration can use Compose with the deterministic provider for end-to-end behavior, then the guarded evidence harness with separately prepared valueless GNU Taler demo wallets for the peer-push handoff. Production approval is tracked separately and is not implied by the demonstrator.
