# Upgrade and version policy

The project uses semantic versioning. Before 1.0, minor/alpha releases may include documented breaking changes; patch releases should remain compatible. `/v1` compatibility is preserved where feasible, but callers must read changelog and migration notes for every alpha.

Migrations are forward-only, ordered, advisory-lock protected, and never edited after release. Back up PostgreSQL and the matching wallet database, stop workers for wallet maintenance, apply migrations once, deploy API/worker, run health/readiness and a valueless smoke test, then reconcile nonterminal operations. Rollback means restoring compatible application plus consistent backups; down migrations are not supplied.

v0.1.0-alpha.1 changes package/version metadata, tightens maximum reward lifetime/value validation, adds `METADATA_ENABLED`, safe explicit proxy trust, webhook secret rotation, exact wallet-version gates, and a required persistent wallet RPC connection unless the sandbox-only compatibility flag is explicit. These may reject configurations or requests previously accepted. Encryption and claim PRF keys have no online key ring; do not rotate them by simple replacement.
