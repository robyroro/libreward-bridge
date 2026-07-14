# Local verification — 2026-07-14

This record describes the checks run against the working tree while preparing the NLnet NGI TALER application package. Public CI evidence obtained after the initial push is recorded separately below. Neither local nor CI verification is a substitute for an independent security review.

## Environment

- Windows, PowerShell
- Node.js 22.18.0
- npm 11.12.0
- PostgreSQL 17.10, using a fresh isolated local cluster
- Gitleaks 8.30.1
- actionlint 1.7.12

## Results

| Check | Result |
| --- | --- |
| Clean dependency install (`npm ci --ignore-scripts`) | Pass |
| Formatting | Pass |
| Lint | Pass |
| Type checking | Pass |
| Unit tests | Pass: 25 tests |
| PostgreSQL integration tests | Pass: 11 tests |
| OpenAPI validation | Pass |
| Production build | Pass |
| npm production dependency audit, high severity threshold | Pass: 0 vulnerabilities |
| Production dependency license allowlist | Pass |
| CycloneDX SBOM generation | Pass |
| GitHub Actions workflow validation | Pass |
| Gitleaks committed-history scan | Pass: no leaks found |
| Gitleaks working-directory scan | Pass: no leaks found |
| Git whitespace validation (`git diff --check`) | Pass |

The integration suite exercised concurrent creation and claiming, idempotency conflicts, cancellation paths, provider cancellation, tenant isolation, signed webhooks, operator authorization and audit logging, atomic daily caps, fail-closed liquidity checks, retention, and cross-worker serialization.

## Post-push evidence

- The [first public GitHub Actions run](https://github.com/robyroro/libreward-bridge/actions/runs/29366192289) passed its test, PostgreSQL integration, Docker Compose and secret-scan jobs on 2026-07-14.
- No local container runtime was available during this review; Compose evidence therefore comes from the public workflow.
- The proposed independent security review is a future funded milestone and has not yet happened.

The generated SBOM is intentionally treated as an ephemeral CI artifact and is not committed to the repository.
