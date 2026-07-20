# Questions for GNU Taler upstream

No answer or approval is implied. These should be raised through the official upstream channel with a minimal valueless reproducer.

1. Is `advanced serve` plus `--wallet-connection` a supported long-running operator boundary for wallet-core 1.6.x, including restart and single-writer guarantees?
2. Is polling `getTransactionById` the supported way to wait for a peer-push debit URI to become shareable? Which `txState.major/minor` combinations are stable API?
3. Can `initiatePeerPushDebit` create an external transaction yet fail to return its ID? Is an application-supplied idempotency key planned?
4. What is the supported recovery method for matching an unknown-outcome peer-push debit by contract terms without risking a duplicate?
5. Which wallet/API compatibility dimensions should downstream services gate: implementation semantic version, wallet API version, exchange protocol version, or feature capability?
6. What are the supported abort/expiry semantics before and after a recipient imports the URI?
7. Is a non-testing subscribe/wait API planned, and what deprecation signal will testing operations receive?
