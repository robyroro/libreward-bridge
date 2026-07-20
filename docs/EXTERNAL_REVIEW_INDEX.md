# External review index

Automated checks, AI review (including Codex or Claude), maintainer review, and repository-owner review are not independent review. No production approval is represented.

## Reproducible target

- Target commit: run `git rev-parse HEAD` and replace `[OWNER INPUT REQUIRED]` in the review copy.
- Source status: `git status --short` must be empty.
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Threat/privacy: [THREAT_MODEL.md](THREAT_MODEL.md), [PRIVACY.md](PRIVACY.md), [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md)
- Contract/migrations: [OpenAPI](../openapi.yaml), [`migrations/`](../migrations/)
- Commands: `npm ci`, `npm run validate`, PostgreSQL integration, coverage, audit, license, SBOM, secret scan, container build/smoke.
- Evidence: [local verification](LOCAL_VERIFICATION_2026-07-14.md), [sanitized valueless sandbox evidence](SANDBOX_EVIDENCE_2026-07-12.md); reviewers must reproduce current results.
- Dependencies/container: generated `sbom.cdx.json`, `npm audit --omit=dev`, Dockerfile digest and runtime user/profile.
- Outstanding risk: [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md), [Taler compatibility](TALER_COMPATIBILITY.md), [review gates](SECURITY_PRIVACY_LEGAL_REVIEW.md).

Review scope covers authentication/tenant isolation, capability and encryption handling, state/concurrency/idempotency, unknown wallet effects, SSRF/webhooks, proxy/logging, liquidity/retention, database/migrations/backups, containers/supply chain, accessibility, and data lifecycle. Findings use the issue templates, name an owner, preserve sanitized reproduction, add regression tests, and require reviewer confirmation before closure.

| Gate | Reviewer | Commit | Evidence | Decision |
| --- | --- | --- | --- | --- |
| Independent security | Pending | — | — | Not approved |
| Independent privacy | Pending | — | — | Not approved |
| Qualified legal/regulatory | Pending | — | — | Not approved |
| Accounting/treasury | Pending | — | — | Not approved |
| Independent accessibility | Pending | — | — | Not approved |
