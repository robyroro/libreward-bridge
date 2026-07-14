# Data retention

Suggested defaults, subject to deployment law and accounting obligations:

- raw claim capability: never stored;
- claim derivation material/hash: delete or irreversibly pseudonymize 30 days after a terminal state;
- encrypted Taler claim URI: erase immediately after `claimed`, or after 30 days for failed operator investigation;
- reward/provider financial record and lifecycle events: 7 years where accounting rules require it, otherwise 24 months;
- successful webhook delivery detail: 90 days; failed delivery detail: 180 days;
- revoked API-key metadata: 12 months; secret never stored;
- application logs: 30 days; infrastructure IP logs: 7 days or less;
- low-cardinality metrics: 13 months.

The worker applies the claim/provider/webhook/revoked-key rules on the configured interval using `CLAIM_TOKEN_RETENTION_DAYS`, `PROVIDER_SECRET_RETENTION_DAYS`, `WEBHOOK_DELIVERED_RETENTION_DAYS`, `WEBHOOK_FAILED_RETENTION_DAYS`, and `REVOKED_KEY_RETENTION_DAYS`. Admins can preview exact counts before deletion, and every run is recorded. Financial reward, provider-reference, reward-event, and operator-audit rows are not automatically deleted because their lawful accounting/audit period must be approved per deployment. Preserve legal holds and review the policy against local law before executing production retention.
