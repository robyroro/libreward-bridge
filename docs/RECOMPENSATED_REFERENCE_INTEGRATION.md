# Recompensated reference integration

The reference adapter belongs outside the generic core. It is not enabled or wired into the current application by this release.

The boundary requires two feature flags that both default false: `LIBREREWARD_PAYOUT_ENABLED=false` and `LIBREREWARD_SANDBOX_ENABLED=false`. Add “GNU Taler Sandbox” to processor choices only after both flags, configuration validation, sandbox evidence, and operator approval pass.

On existing admin approval, keep the current fraud re-check and locked withdrawal state. The existing withdrawal request already reserves points atomically. Translate the approved decimal fiat amount to an exact configured Taler amount using decimal-string arithmetic, not PHP float. Send an opaque `external_reference=withdraw:<id>` and `Idempotency-Key=recompensated-withdraw:<id>:v1`. Persist the LibreReward reward public ID and claim URL ciphertext in dedicated columns/table; never put user email, wallet address, IP, fraud score, or profile data in metadata.

Map `claimable`/`claim_in_progress` to a non-final processing state; map `claimed` to processed; map pre-funding `cancelled`/`failed` to operator review before any points credit. Verify the raw webhook body, timestamp, signature, and event ID; persist the event ID idempotently; lock the withdrawal row; then apply the state mapping. A webhook must not bypass the current accounting or admin audit logger.

Do not replace PayPal, crypto, gift-card, Visa, bank, or manual rails. Do not call LibreReward during withdrawal creation, because approval/fraud review has not happened. Do not enable production until ambiguous outcomes, refund policy, currency conversion, liability funding, and legal/accounting treatment have owner approval.

`examples/recompensated-adapter/` shows the outbound client, raw-body webhook verifier, configuration, and integration sequence without importing Recompensated code into the core. It deliberately does not add Laravel routes, migrations, UI, or production payout behavior.
