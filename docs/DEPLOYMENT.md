# Deployment

This alpha is for isolated valueless environments. Use a dedicated PostgreSQL role/database, one wallet-core server per wallet database, one or more API/worker processes, a secret manager, encrypted backups, and network separation for operator routes, metrics, database, and wallet RPC.

The container runs as UID/GID 10001, supports a read-only root filesystem with `/tmp` tmpfs, drops all Linux capabilities, sets no-new-privileges, and has a health check. The wallet process and writable wallet volume are intentionally outside the API image. Pin reviewed image digests in an operator deployment; repository tags alone are mutable.

## Reverse proxy

Default `LIBREREWARD_TRUST_PROXY=false` ignores forwarded client IPs. With one trusted proxy hop use `LIBREREWARD_TRUST_PROXY=1`; with stable proxy addresses use `LIBREREWARD_TRUST_PROXY=10.20.0.0/16,2001:db8:1234::/48`. Never use `true`. Ensure no alternate direct path bypasses the proxy. Too much trust lets clients spoof rate-limit/audit IPs; too little trust makes all clients share the proxy IP and can cause denial of service. Redact `/claim/*`, authorization, `Location`, and query strings in proxy logs.

Terminate TLS, set HSTS at the edge, restrict request size/time, block private egress except required services, deny direct operator/metrics access, and preserve graceful termination long enough for requests to finish. Production-shaped variables are documented in `deployment/production.env.example`, but using that file does not approve real money.

Run migrations as a one-shot before API/worker rollout. Back up first, test restore in an egress-disabled environment, and reconcile every nonterminal operation after database or wallet restore. See [Operations](OPERATIONS.md) and [runbooks](PRODUCTION_RUNBOOKS.md).
