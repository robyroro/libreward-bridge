# Questions for GNU Taler upstream

Answers below summarize a public reply on the `taler` mailing list (2026-07-14, [msg00007](https://lists.gnu.org/archive/html/taler/2026-07/msg00007.html)). They are guidance, not an approval or support commitment.

## Answered

1. **Operator boundary.** One wallet process owns the database; other CLI processes may connect to the main daemon with `--wallet-connection`. Recommended: serialize writes behind a queue, run one daemon, and track updates by transaction ID.
2. **Waiting for shareability.** The non-testing way is the `WalletNotification` for the `pending(ready)` state. LibreReward subscribes to `transaction-state-transition` notifications (`taler-wallet-rpc` provider).
3. **Idempotency.** No caller-supplied idempotency key exists or is planned. Call `checkPeerPushDebit` before `initiatePeerPushDebit`; there is no lock between them. Initiation is not idempotent but can be treated as atomic; the transaction ID is the tracking handle.
4. **Testing API.** There is no plan to deprecate `testingWaitTransactionState`.
5. **States.** Peer-push-debit states are those of design document 037.

Upstream also noted that a server-side multi-user API would be a different API and is not a current priority.

## Still open

1. Can `initiatePeerPushDebit` create a transaction yet fail to return its ID, and how should such an unknown outcome be matched without risking a duplicate?
2. Which compatibility dimensions should downstream services gate: implementation version, wallet API version, exchange protocol version, or capabilities?
3. What are the supported abort/expiry semantics before and after a recipient imports the URI?
4. Will the RPC socket protocol (`twrpc`, documented in source as unstable) receive a stability or deprecation signal?
