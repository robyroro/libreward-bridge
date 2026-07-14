# Known limitations

- The GNU Taler adapter is experimental. Current upstream wallet CLI 1.6.10 compatibility and a funded valueless demo matrix were verified, but the adapter still depends on wallet CLI development/testing interfaces and is not a hardened production wallet service.
- `initiatePeerPushDebit` has no bridge-controlled idempotency key. Unknown timeouts require manual reconciliation and are not retried.
- Operator HTTP access covers inspection, reconciliation, delivery retry, liquidity, retention, and audit history; account/key bootstrap and suspension remain CLI/database administration tasks.
- Automated cleanup covers terminal claim tokens, provider bearer ciphertext, webhook attempts, and revoked-key metadata. Core financial/event/audit retention remains an approved deployment policy because accounting and legal-hold requirements vary.
- The claim URI is encrypted at rest but remains a bearer secret in the recipient browser and wallet handoff.
- API/claim encryption keys have no online key ring; rotation requires a planned migration.
- PostgreSQL 17.10 migrations and integration/concurrency tests ran locally. This host has no container runtime, but GitHub Actions successfully builds the images, starts Compose, completes migration, validates worker liveness, and probes `/healthz` and `/readyz`.
- The dependency audit is clean at implementation time, but must be rerun for every release because registry advisories change.
- The root GitHub workflow passes; its action-version deprecation warnings are maintenance notices rather than test failures and should be addressed in a later dependency refresh.
- No automatic cancellation of an already-created Taler purse is exposed to integrators; cancellation after claim start requires operator/provider review.
- No liability funding/reserve accounting module is implemented; the operator must monitor the funding wallet and integrator credit risk.
- Wallet liquidity monitoring is operational rather than treasury accounting: it does not replenish funds, segregate tenant reserves, forecast liabilities, or prove safeguarding compliance.
- Independent security/privacy review and qualified legal/accounting approval remain pending; the local review package is not a substitute.
