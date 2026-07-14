# ADR-002: GNU Taler peer-push reward flow

Status: accepted experimentally for 0.1.0 on 2026-07-12.

## Decision

Use an operator-controlled GNU Taler wallet and wallet-core's peer push debit flow. The adapter invokes the official `initiatePeerPushDebit` operation with `PartialPeerContractTerms` (`amount`, `summary`, and `purse_expiration`), obtains the `taler://pay-push` URI from the resulting `TransactionPeerPushDebit`, and reconciles with `getTransactionById`. The recipient opens or scans the URI and accepts it in their own wallet.

Official sources consulted:

- [Wallet-core API: peer payment operations and types](https://docs.taler.net/wallet/wallet-core.html)
- [Wallet developer manual: CLI API and P2P push example](https://docs.taler.net/developer/taler-wallet-developer.html)
- [Exchange API: implemented wallet-to-wallet purse endpoints](https://docs.taler.net/core/api-exchange.html)
- [DD 37: wallet transaction lifecycle](https://docs.taler.net/design-documents/037-wallet-transactions-lifecycle.html)
- [Current Merchant Backend API](https://docs.taler.net/core/api-merchant.html)

At the date above, the current merchant API protocol is v32 and contains no reward/tipping resource. The separately published “Backoffice Rewards Management” document is a design document, not evidence of a current production API. Historical tip/reward endpoint names are therefore not implemented.

## Why selected

Peer push is implemented, produces a transferable wallet URI/QR payload, has wallet-core transaction IDs and explicit pending/done/failed states, and does not require recipient identity. It most closely matches “operator offers value; recipient accepts into a wallet.”

## Alternatives

- Merchant payment: money moves from recipient to merchant, the opposite direction.
- Merchant refund: requires an earlier paid order and cannot create an independent reward.
- Direct exchange purse calls: require implementing wallet cryptography, denomination selection, key custody, and protocol evolution; wallet-core already owns those responsibilities.
- Withdrawal: moves bank funds into a specific wallet workflow and is not a one-time funded bearer reward.
- Peer pull: recipient creates an invoice, which does not fit a sender-created claim link.
- Historical merchant tips/rewards: absent from the current normative merchant API.

## Privacy and security

The bridge needs no recipient identity. Wallet-core and the exchange observe protocol data inherent to the peer transfer. The claim page receives the operator-created `taler://pay-push` bearer URI; it is encrypted in PostgreSQL and redacted from logs. Whoever obtains an unused claim URL can obtain the payout URI, so distribution-channel security remains essential.

## Failure and reconciliation

The local operation is committed before wallet-core is invoked. A successful response persists the transaction ID and encrypted URI. `getTransactionById` maps major state `done` to claimed; `failed`/`expired`/`deleted` to failed; `aborted` to cancelled; all other states remain pending/ready.

Wallet-core's initiation request has no caller-supplied idempotency key. If the CLI times out before returning a transaction ID, blindly repeating it could create a second purse. LibreReward records an ambiguous operation, moves the reward to `reconciliation_required`, and requires operator investigation; it does not fake success or retry the effect automatically.

## Operational limitations

The CLI is documented as a developer/operator interface and does not run as a daemon by default. A dedicated wallet database and single logical worker are required. The NPM package named in older documentation is currently unavailable from the public registry. Real sandbox tests therefore require an externally installed upstream CLI. These constraints make the adapter experimental, not a claim of unattended production readiness.
