# Operations

## Processes and migrations

Run one or more API processes and workers against PostgreSQL. Apply `node dist/src/cli.js migrate` before either starts. Migrations are ordered SQL files guarded by a PostgreSQL advisory lock. Back up PostgreSQL before upgrade and test restoration; do not silently skip a failed migration.

Forwarded client IPs are ignored unless `LIBREREWARD_TRUST_PROXY` explicitly names a bounded hop count or trusted IP/CIDR list. Match this to the only reachable reverse-proxy path and test spoofed `X-Forwarded-For`; a wrong value weakens claim/API rate limits and audit context. Apply equivalent bearer-path redaction at the proxy.

The worker recovers provider and webhook rows left `processing` for more than two minutes. It does not retry an ambiguous wallet initiation without an external transaction ID. API readiness checks database connectivity and, when fail-closed controls are enabled, current healthy liquidity; liveness checks only the process.

The worker verifies the selected provider and exact wallet/API version before processing its first operation. An unsupported or malformed wallet response stops worker startup with no payout attempt.

## Secrets and rotation

Keep API-key hash, claim-token PRF, and AES data-encryption keys in a secret manager. They are separate blast-radius domains. API keys rotate online with `key:rotate` and `key:revoke`. Changing claim-token or encryption keys requires a key-ring migration; 0.1 has no multi-key ring, so a blind change invalidates claims or encrypted values. Back up the wallet database separately and encrypt it at rest.

## Reconciliation

Run `node dist/src/cli.js reconcile --reward rw_...`. Known wallet transaction IDs are queried through `getTransactionById`; `done` claims, terminal failure fails, and other states remain pending. For an ambiguous operation without an ID, inspect the dedicated wallet transaction list by amount, summary, creation time, and purse expiry. Never initiate a replacement until an operator has established that no purse exists. Record the decision outside raw secrets.

The role-scoped operator HTTP API supports sanitized inspection, known-ID reconciliation, failed-delivery retry, queued liquidity checks, retention runs, and audit reads. Wallet-affecting operations are serialized across workers with a PostgreSQL advisory lock; the API never opens the wallet directly. The local CLI remains the bootstrap/break-glass boundary and supports the same diagnostics plus tenant/operator key lifecycle. Before any direct wallet command: stop every Bridge worker for that wallet, verify the processes have exited, keep the persistent wallet server as the sole database owner, perform the read/maintenance action, record only sanitized evidence, and restart/reconcile before accepting claims. Neither surface displays claim tokens, decrypted Taler URIs, API secrets, or webhook secrets. Keep `/v1/operator/*`, CLI, wallet, and database access on restricted operations networks.

## Backup and restore

Use consistent PostgreSQL backups plus encrypted wallet database backups. Restore both into an isolated environment, block outbound webhooks/provider calls, run integrity queries, then enable dependencies deliberately. Database-only point-in-time recovery can disagree with the wallet; reconcile every nonterminal operation after restore.

## Monitoring

The worker polls `getBalances`, stores sanitized snapshots, emits `liquidity_alert` / `liquidity_check_failed`, and exports bounded currency-labelled gauges. In production, `LIQUIDITY_FAIL_CLOSED=true` blocks claim start and readiness when a snapshot is missing, stale, below its configured floor, or has peer payments disabled. Atomic `DAILY_PAYOUT_LIMITS` cap new provider liability per UTC database day. Load `deployment/prometheus-alerts.yml`, align its stale threshold with `LIQUIDITY_MAX_AGE_SECONDS`, and also alert on provider errors, webhook dead letters, queue age, database saturation, wallet disk space, and claim latency. Restrict `/metrics` at the reverse proxy.

Retention runs automatically at `RETENTION_INTERVAL_SECONDS`. Preview with `retention:run --dry-run` or the admin operator endpoint, verify the configured day values and legal holds, then execute. Every run records counts in `retention_runs`; operator-triggered runs also produce an audit event.

## Incident handling

For suspected key/token leakage: stop provider workers, preserve evidence without bearer values, revoke tenant keys/endpoints, rotate affected secrets, enumerate nonterminal rewards, reconcile wallet state, notify integrators with event IDs, and resume only after duplicate-payment risk is understood. For provider outage, API creation may continue only if funding liability and queue growth are acceptable.

## Production checklist

Terminate TLS; redact full claim paths in proxy logs; isolate operator routes; restrict database/metrics; disable private webhook destinations; use `PROVIDER=taler-wallet-cli`; configure per-currency payout caps and balance floors; verify wallet/exchange versions and ToS; mount the wallet writable only to its serialized worker; load alerts; test retention and backup restore; run the full PostgreSQL/concurrency and real sandbox suite; and obtain the security/privacy/legal/treasury sign-offs in `SECURITY_PRIVACY_LEGAL_REVIEW.md`.
