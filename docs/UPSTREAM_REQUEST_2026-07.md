# GNU Taler upstream coordination request

Status: submitted to the public GNU Taler mailing list on 2026-07-12. No maintainer response is claimed until a public archive URL or reply is recorded below.

## Suggested subject

`wallet-core: server-side peer-push idempotency and supported operator interface`

## Suggested message

We are building LibreReward Bridge, an AGPL middleware sandbox demonstrator that creates exact-value bearer rewards with wallet-core peer-push debit. A funded valueless demo run used wallet CLI 1.6.10 / wallet protocol 7 / exchange protocol 34 and covered successful claim, recipient race, restart reconciliation, expiry, and insufficient balance.

The implementation currently calls `initiatePeerPushDebit`, waits for a shareable transaction state, stores the returned transaction ID, and reconciles with `getTransactionById`. We never automatically repeat initiation after an unknown timeout.

Could maintainers advise on these points?

1. Is there a supported caller-supplied idempotency key or client reference for `initiatePeerPushDebit`, or a reliable lookup that can prove whether an initiation with a particular application operation ID already occurred?
2. Is `testingWaitTransactionState` acceptable for a server-side operator, or is there a supported non-testing API for waiting until the peer-push URI is ready without waiting for recipient completion?
3. Is spawning `taler-wallet-cli api` serially against one dedicated wallet database an intended operator deployment, or is another long-running authenticated wallet-core boundary recommended?
4. What sender-side transaction states should an external service treat as final for success, expiry, abort, and KYC/terms interruption?
5. Are there production guidance or limits for automated peer-push reward workloads that are not covered by the wallet developer manual?

We can provide a minimal reproducer and sanitized public transaction IDs. We will not publish wallet files, claim URIs, keys, or recipient information.

## Submission record

- Preferred public channel: `taler@gnu.org` or the GNU Taler/GNUnet bug tracker.
- Submitted: email sent to `taler@gnu.org` on 2026-07-12; public archive URL pending.
- Local tracking: [issue #6](https://github.com/robyroro/recompensated/issues/6).
- Maintainer response and resulting action: pending.
