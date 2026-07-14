# Funded sandbox evidence — 2026-07-12

Scope: valueless GNU Taler demo KUDOS only. No production credentials, balances, wallet files, claim URLs, contract keys, webhook secrets, or recipient identity are recorded here.

## Environment

- Official `taler-typescript-core` revision: `20c1818449d024bd36fd7fc146631ecc44858fa3`
- Wallet CLI: `1.6.10`
- Wallet protocol: `7:0:0`
- Exchange protocol: `34:0:9`
- Exchange: `https://exchange.demo.taler.net/`
- Database: PostgreSQL `17.10`
- Operator and recipient wallets reported `haveProdBalance=false`
- Evidence command: `npm run sandbox:evidence`

## Sanitized results

| Case | Evidence | Result |
| --- | --- | --- |
| Successful claim | Reward `rw_LE6EpZYkcU_k09IqpQukhA`; debit `txn:peer-push-debit:DDH6M0AYQN6MANKR65RCEZQP1Y69QT3CD13Z2PM5504SG72EJGXG`; credit `txn:peer-push-credit:D9BSD4Z12C205QH1S875GXG21EN1DH5ZWCG69DQGQ581BP1X9YSG`; event `evt_I9f2u_fqfSHxlskUDS3WKQ` | Reward claimed; exactly one provider operation; final webhook delivered with a valid signature. |
| Two-recipient race | Reward `rw_UPmTBgSLx3jcSrtqh2Vufg`; debit `txn:peer-push-debit:JBCH8RSZMNSHRNXNZ52B5GEGJV52S6E02YAJAB3YYQA8YMVVP1BG` | Exactly one recipient completed; the other failed; exactly one Bridge provider operation existed. |
| Worker restart | Recreated provider and worker instances after transfer and before reconciliation. | The known transaction reconciled without creating another purse. |
| Expired purse | Reward `rw_IwrJ4rlv78QdmgbWmnPkpA`; debit `txn:peer-push-debit:38MHN7CBP4N651WC3P9PCMHD12CXF8G22XAM92N6E65KAW0J6NB0` | Provider became cancelled; reward became failed; one final webhook was delivered; no replacement purse was created. |
| Insufficient balance | Attempt exceeded the operator's demo balance. | Current wallet error `taler_7001` was classified as permanent; no claim URI was returned. |
| Exchange terms | Recipient initially returned wallet error `7037` with terms version `exchange-tos-v0`. | Accepting the demo exchange terms allowed the same controlled flow to continue; no false success occurred. |
| CLI timeout | Controlled fake-wallet command exceeded a 100 ms command limit. | Classified as ambiguous `wallet_cli_timeout`; no automatic retry. |
| Cancellation before claim | PostgreSQL integration test cancelled a reward before claim start. | Claim token revoked and provider-operation count remained zero. |

The final full funded run completed at `2026-07-12T14:26:37.132Z`. KYC thresholds were not deliberately triggered. Production KYC/legal review, liquidity controls, independent security review, and upstream initiation idempotency remain outside this sandbox evidence.
