# Known limitations

- v0.1.0-alpha.1 is a research prototype demonstrated only with mock and valueless GNU Taler currency. It is not approved for real money.
- Exact wallet-core 1.6.10 and 1.6.12 / API 7:0:0 are gated. Persistent RPC plus stable transaction polling is implemented, but the operator service boundary and state semantics still need upstream confirmation. The testing wait API remains only in an explicit non-production compatibility path.
- `initiatePeerPushDebit` has no Bridge-controlled upstream idempotency key. Unknown initiation outcomes require manual reconciliation and are never automatically retried.
- One wallet server owns a wallet database. PostgreSQL serializes Bridge calls, but direct CLI tools are outside that lock and require stopping workers.
- Encryption and claim-PRF keys have no online key ring. Blind rotation can invalidate active claims or encrypted values.
- Claim links and Taler URIs remain bearer capabilities in recipient delivery/browser/wallet paths.
- Tenant metadata can contain personal data; it is bounded and can be disabled but cannot be semantically classified by the service.
- Financial/event/audit retention, legal holds, backup expiry, operator jurisdictions, KYC/AML/sanctions, safeguarding, tax/accounting, and refund duties require external decisions.
- Liquidity checks are operational signals, not reserve segregation, solvency proof, replenishment, or treasury accounting.
- Cancellation after claim start is not a tenant operation; abort/recovery needs operator and provider reconciliation.
- Independent security, privacy, accessibility, legal, and treasury reviews are pending. AI, automated, maintainer, and owner review are not independent.
- Registry advisories, base images, public sandbox services, and upstream APIs change; audit, SBOM, container, and interoperability evidence must be regenerated for each release.

Historical sanitized evidence remains useful but does not replace a current reproduction at the target commit. See [Taler compatibility](TALER_COMPATIBILITY.md) and [external review index](EXTERNAL_REVIEW_INDEX.md).
