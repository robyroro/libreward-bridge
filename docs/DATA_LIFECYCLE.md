# Data lifecycle

| Data | Source and purpose | Storage / secret | Personal-data risk | Retention, deletion, exposure |
| --- | --- | --- | --- | --- |
| Tenant public ID | Bridge; routing | PostgreSQL; public | Low | Durable; visible in webhooks/operator API/backups |
| Tenant/operator API keys | CLI; authentication | Prefix plus keyed hash; raw shown once | Credential | Revoked hashes deleted after configured days; never webhook/log |
| Claim material/hash | Bridge; bearer claim | Random derivation material plus keyed hash; secret capability | Linkability/value | Revoked/consumed; terminal tokens deleted after configured days; backups may retain |
| Reward ID, amount, description, status | Tenant/Bridge; ledger state | PostgreSQL | Description can identify | Durable operational record; minimized webhook/operator visibility |
| External reference | Tenant; correlation | PostgreSQL | High if not opaque | Same as reward; webhook event data may expose it |
| Metadata | Tenant; optional context | PostgreSQL JSON scalar values | High / uncontrolled | Disable with `METADATA_ENABLED=false`; included in backups and relevant events |
| Provider transaction ID | wallet-core; reconciliation | PostgreSQL; not secret but sensitive | Transaction correlation | Retained with operation; operator-visible; avoid public logs |
| Taler claim URI | wallet-core; recipient handoff | AES-GCM ciphertext | Bearer value | Ciphertext erased after terminal retention; may exist in backups; never webhook/operator/log |
| Webhook URL/secret | Tenant; delivery | URL plus AES-GCM secret | URL may identify organization | Secret rotates immediately; endpoint deletion cascades delivery relation per schema |
| Delivery/event records | Bridge; retry/audit | PostgreSQL | Payload may contain tenant data | Delivered/failed records deleted on separate schedules; event IDs are duplicate keys |
| Operator audit events | Bridge; accountability | Append-only PostgreSQL | Operator activity | Retention is an owner/legal decision; no secrets in detail |
| Logs/metrics | Infrastructure; reliability/security | stdout/monitoring | IP/timing can be personal | Application redacts paths and capabilities; proxy policy and deletion are deployment duties |
| Wallet database | wallet-core; funds and transaction truth | Wallet host; highly sensitive | Financial correlation | Encrypted restricted backup; lifecycle governed by GNU Taler/operator policy |
| PostgreSQL backup | Operator; recovery | Backup store; sensitive | Contains all retained fields/ciphertexts | Encrypt, restrict, test deletion expiry, and account for lagging backup copies |

Retention previews are non-mutating and recorded. Execution deletes terminal claim tokens, terminal provider ciphertext, old webhook deliveries, and revoked key rows according to configuration. Legal holds and backup expiry must be handled outside the application. Encryption-key rotation in alpha requires a planned offline migration; blind replacement makes ciphertext unreadable.
