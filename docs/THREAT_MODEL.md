# Threat model

Method: STRIDE review of integrator API, claim channel, database, worker, wallet boundary, and outbound webhook network. Assumptions: PostgreSQL and deployment secrets are access-controlled; TLS terminates at a trusted proxy; the operator wallet is funded intentionally; GNU Taler components may fail but do not intentionally forge local database records.

| Threat | Control | Residual risk |
|---|---|---|
| Stolen claim link / referrer leakage | 256-bit PRF token, no-store, `Referrer-Policy: no-referrer`, CSP, no cookies/trackers, short expiry, regeneration/revocation | The distribution channel or recipient device can leak a bearer URL. |
| Brute force / timing | 256-bit space, keyed hash, constant-time comparison API, per-IP claim rate limit, generic 404 | Distributed denial-of-service remains possible. |
| Forwarded-IP spoofing | Forwarded headers ignored by default; explicit bounded hop or IP/CIDR proxy trust | A wrong topology can let clients evade rate limits or make all users share one limit. |
| Token/secret logs | structured redaction of URL, authorization, location, secret fields; no provider bodies | Reverse proxies must apply equivalent query/path redaction. |
| Duplicate/concurrent claim | row locks, consumed timestamp, unique provider operation | Unknown wallet-core initiation outcome cannot be safely replayed. |
| API replay/idempotency abuse | scoped key, unique per-tenant key, canonical request fingerprint | A stolen API key can create valid rewards until revoked. |
| Forged/replayed webhook | HMAC-SHA256 over timestamp plus canonical body; event ID; receiver tolerance guidance | Receivers must persist event IDs and enforce the timestamp window. |
| Tenant isolation failure | tenant ID comes only from authenticated key and is present in every resource query; isolation test | Operator/database access is inherently cross-tenant. |
| Operator credential abuse | separate `lro_` key domain, role-derived scopes, private-network guidance, rate limit, rotation/revocation, append-only audit events | A compromised admin key can inspect all tenants, force reconciliation checks, retry deliveries, and execute retention. Database administrators remain outside application RBAC. |
| Wallet depletion / liability spike | exact per-currency daily cap under a PostgreSQL transaction lock; cached balance floor; stale/low/blocked fail-closed gate; alerts | Balance is a point-in-time operational signal, not reserve segregation or treasury accounting. |
| SQL injection | parameterized `pg` queries; strict Zod schemas | Migration/operator SQL remains privileged. |
| XSS/malicious metadata | metadata is scalar-only/size-bounded; claim HTML encodes dynamic data; CSP | Integrators must encode metadata in their own interfaces. |
| CSRF | tenant API is bearer-auth JSON; claim start has no cookie authority and cannot choose a destination | A cross-site form could start preparation, but cannot redirect funds without the bearer URI. |
| SSRF/DNS rebinding | HTTPS in production, forbidden credentials/ports, DNS resolution and public-unicast check, connection pinned to validated addresses while preserving TLS SNI, no redirects, short timeout, response cap | Proxy/network policy should still deny metadata and internal networks as defense in depth. |
| Unsafe redirects | provider URI is accepted only from wallet-core and rendered as an encoded `taler:` link; webhook redirects disabled | A compromised wallet-core can return a malicious URI; schema validation rejects non-peer transactions but URI scheme hardening remains recommended. |
| Oversized input/DoS | 16 KiB body limit, field/metadata limits, rate limits, bounded lists and responses | Network-layer volumetric attacks need a reverse proxy/WAF. |
| State bypass/races | centralized transition table, transactions, version compare, unique constraints, concurrent tests | SQLite is not accepted for concurrency assurance. |
| Compromised exchange/wallet | reconcile wallet state through official wallet-core; dedicated wallet, least privilege, PostgreSQL advisory serialization across workers, queued API balance checks, and balance monitoring | Bridge cannot prove exchange solvency or prevent wallet host compromise. Direct break-glass CLI use requires workers to be stopped. |
| Secret/database compromise | API/claim hashes; AES-256-GCM for recoverable URI/webhook secrets; independent rotation keys | Database plus application secrets reveals active bearer capabilities. Use a secret manager/HSM boundary where warranted. |
| Dependency/supply chain | lockfile, pinned runtime image, CI audit/license/SBOM/secret scan, non-root read-only container | NPM and base-image compromise remain ecosystem risks. Review audit findings before release. |
| Sandbox in production | startup rejects mock provider, HTTP public URL, development secrets, private-webhook exception | Exchange URL provenance is operator-configured; add an explicit allowlist for production estates. |

## Security invariants

No direct reward status update occurs outside domain/worker transition code. No automatic repeat occurs after an ambiguous externally effectful wallet operation, whether the transaction ID is unknown or known but readiness is uncertain. Claim token, API key, webhook secret, decrypted Taler URI, authorization header, raw provider stderr, connection string, and wallet database content never belong in logs or audit events. No recipient identity is required; tenant metadata and infrastructure IP logs can still be personal data.

## Residual-risk priorities

Before production: replace or formally approve the wallet CLI/testing interface; obtain independent security/privacy and qualified legal/accounting reviews; use managed secrets; validate reverse-proxy/operator-network controls; exercise the production runbooks; and close every applicable sign-off row in `SECURITY_PRIVACY_LEGAL_REVIEW.md`.
