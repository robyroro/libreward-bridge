# Potential upstream contributions

1. A supported long-running, authenticated wallet-core service interface for server operators would avoid spawning a developer CLI and clarify wallet database serialization.
2. A caller-supplied idempotency key or lookup-by-client-reference for `initiatePeerPushDebit` would close the unknown-timeout duplicate-purse gap.
3. A documented server-side reward/tipping API, if desired by Taler maintainers, could avoid operating a general-purpose wallet.
4. Publish current installable wallet artifacts/package coordinates consistently with the developer manual.
5. Document authoritative mapping from peer-push transaction states to sender-side business finality and cancellation/refund semantics.

No upstream patch is included. Discuss protocol/API changes with GNU Taler maintainers before implementation.
