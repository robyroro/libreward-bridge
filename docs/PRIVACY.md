# Privacy model

LibreReward minimizes data; it does not claim that no personal data is processed. A recipient supplies no account, name, email, wallet address, cookie, advertising ID, or identity form. Claim pages use no analytics or third-party assets. A deployment or reverse proxy can still observe IP addresses, timestamps, and bearer paths. Tenant-provided external references and metadata may identify people outside LibreReward.

Integrators should use opaque references and leave metadata empty. Personal, special-category, financial, authentication, and free-form profile data are forbidden unless the operator has a documented lawful purpose and privacy review. Deployments can set `METADATA_ENABLED=false`; otherwise metadata is limited to 32 scalar properties and the 16 KiB request limit. Metadata is included in reward events/webhooks and follows reward/database backup retention.

Operators must establish controller/processor roles, notices, legal basis, access rules, retention, data-subject handling, incident obligations, and subprocessor boundaries. See [Data lifecycle](DATA_LIFECYCLE.md) for the field inventory and [review gates](SECURITY_PRIVACY_LEGAL_REVIEW.md).
