# Privacy model

LibreReward is a data-minimizing processor. It accepts an opaque tenant reference, exact amount, generic description, constrained scalar metadata, and expiry. It does not require recipient name, email, phone, address, birth date, identity document, integrator user ID, advertising ID, or browser fingerprint.

Claim pages set no application cookies, load no third-party resource, run no analytics, and retain no IP address in the database. Normal infrastructure access logs may temporarily contain source IPs; operators must configure their retention and redact claim paths.

Tenant and reward IDs are pseudonymous operational identifiers. GNU Taler's own privacy and compliance properties apply after wallet interaction. LibreReward does not claim that exchange, wallet, bank, or network metadata disappears; it minimizes what the bridge itself collects.

Operator accounts contain a work display name, role, public ID, key metadata, and append-only action records. Audit events intentionally omit source IP and credentials and use Bridge public IDs as targets. Access to this cross-tenant operational data is role-scoped and should be further restricted by a private access layer.

Data-subject requests cannot be fulfilled from a recipient identity the bridge never holds. Integrators should retain the mapping from their opaque reference to a person and send deletion/pseudonymization instructions as controller. Append-only financial/audit events may require retention for fraud, accounting, or legal reasons; deployments must document their lawful basis.

There is no hidden telemetry. Prometheus metrics contain no tenant, reward, token, address, or external-reference labels. Liquidity metrics use only the bounded configured currency as a label and expose aggregate wallet amounts/status, so the metrics endpoint remains operations-confidential.
