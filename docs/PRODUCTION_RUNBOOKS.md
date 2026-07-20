# Production decision and incident runbooks

These procedures are mandatory inputs to a real-money pilot. They do not replace jurisdiction-specific legal advice or the exchange/operator's own procedures.

## Direct wallet break-glass access

1. Disable new claim starts and stop all LibreReward workers sharing the wallet.
2. Verify no worker or second wallet process can reach the wallet RPC/database. PostgreSQL serialization does not cover manual CLI commands.
3. Prefer read-only transaction inspection. Never initiate a replacement merely because an operation is absent from the Bridge database.
4. Record public IDs, exact versions, timestamps, and decisions without claim/Taler URIs, wallet content, keys, or personal data.
5. Restore the single wallet server, run `provider:check` and a fresh liquidity check, reconcile every nonterminal known ID, then re-enable workers and claims deliberately.

## KYC or exchange-terms interruption

1. Stop new claim starts by removing the affected currency from service or setting a zero operational limit outside the Bridge configuration rollout.
2. Do not mark a reward claimed and do not create a replacement purse.
3. Record the Bridge reward ID, public provider transaction ID, wallet error code, exchange URL, wallet/protocol versions, and timestamps. Do not record claim URIs, wallet files, keys, or recipient identity.
4. Use the operator reward and event endpoints, then query the known wallet transaction ID. If no transaction ID exists after an ambiguous initiation, follow the unknown-outcome procedure below.
5. Complete exchange terms or KYC only through the exchange's documented operator process. Never ask a reward recipient to send identity data to LibreReward.
6. Run a fresh liquidity check and reconcile the known operation. Resume only when the exchange permits peer payments and the cached balance is healthy.

## Unknown provider outcome

1. Pause the worker for the affected wallet and keep tenant creation disabled if liability can grow.
2. If an external transaction ID is stored, reconcile it; never call initiation again.
3. If no ID is stored, inspect wallet transactions by exact amount, summary, creation window, and expiry. Treat a plausible match as unresolved until verified.
4. A second purse requires two-person approval and written evidence that the first does not exist. The current Bridge intentionally has no automatic replacement path.
5. Record the decision in the incident system using public IDs only.

## Cancellation, correction, and refund semantics

- Before claim start: cancel the reward; the claim token is revoked and no provider operation is created.
- After the purse is ready but before recipient completion: an operator may attempt provider abort after confirming the transaction ID. Outcome must be reconciled; cancellation is not assumed.
- After `claimed`: the peer payment is final from the Bridge's perspective. The Bridge cannot pull funds back from the recipient.
- A business correction after claim is a separately authorized compensating workflow, not a state rewrite and not reuse of the original idempotency key. Whether to issue another reward or recover funds outside Taler is a legal/accounting decision.

## Low balance or payout-cap alert

1. Prometheus fires when `libreward_liquidity_healthy` is zero/missing, or the worker emits `liquidity_alert` / `liquidity_check_failed`.
2. Confirm the last snapshot time and pending outgoing amount through the operator API.
3. Do not raise `DAILY_PAYOUT_LIMITS` to hide the alert. Replenish the wallet through the approved treasury procedure, then run a fresh check.
4. If the wallet is healthy but the snapshot is stale, diagnose the worker/CLI before reopening claim starts.
5. Reconcile the provider backlog and compare Bridge pending liability with wallet pending outgoing value.

## Security incident

1. Stop API and worker egress, preserve database and wallet evidence, and revoke affected tenant/operator keys.
2. Rotate the relevant hash/encryption/webhook secrets according to the key-rotation plan; do not destroy evidence subject to legal hold.
3. Enumerate every nonterminal reward and known provider transaction, then reconcile in an isolated environment.
4. Determine whether any claim URI or operator key was exposed. Claim URI exposure is treated as bearer-value exposure.
5. Notify tenants using event IDs and time windows, not recipient identity. Resume only after duplicate-payment and unauthorized-operator risk are understood.

## Database or wallet restore

Restore consistent encrypted backups into an isolated network. Disable provider initiation and outbound webhooks, run migrations and integrity queries, compare every nonterminal Bridge operation to the wallet, then re-enable dependencies deliberately. Database-only recovery can disagree with wallet truth and must never trigger automatic re-issuance.
