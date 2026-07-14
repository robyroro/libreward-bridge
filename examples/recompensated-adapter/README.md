# Recompensated Laravel adapter boundary

This directory is reference code, not an enabled integration. Copy it into the Laravel application only after sandbox credentials and owner approval exist.

Both `LIBREREWARD_PAYOUT_ENABLED=true` and `LIBREREWARD_SANDBOX_ENABLED=true` are required before the client sends a request. Both default to false. The configured currency must remain a valueless test currency for the demonstrator.

The intended boundary is:

1. Recompensated performs its existing fraud review and locks an approved withdrawal.
2. `LibreRewardClient` sends only an opaque withdrawal reference and exact Taler amount.
3. The returned reward ID is persisted against that withdrawal; the claim URL is treated as a bearer secret.
4. A webhook route passes the unmodified request body and LibreReward headers to `LibreRewardWebhookVerifier`.
5. The receiver stores the event ID idempotently, locks the withdrawal, maps the state, and uses existing accounting/audit services.

Do not credit, reverse, approve, or complete a withdrawal directly from unverified webhook data. This example deliberately does not modify Recompensated routes, migrations, processor settings, or production payout behavior.
