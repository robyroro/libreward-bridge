# Technical narrative

## Problem and approach

Small rewards are often implemented by collecting recipient accounts or routing identity-rich processor payments. Integrators then inherit unnecessary identity, custody, reconciliation, and platform-coupling risk. GNU Taler is necessary here because its wallet protocol can hand a recipient a one-time peer-push claim without LibreReward creating or custodying that recipient's wallet. Ordinary card or bank processors generally expose account-centric payout identifiers and do not provide the same GNU Taler bearer-wallet protocol; this is a protocol distinction, not a claim that such processors have no privacy controls.

LibreReward separates tenant API, public capability, PostgreSQL state, serialized worker, operator wallet-core, recipient wallet, exchange, and signed webhook boundaries. Tenant-scoped idempotency and database locks create one local provider operation. Known wallet transaction IDs are reconciled after restart. An unknown external effect is quarantined rather than retried.

## Existing evidence

Before funding, the repository demonstrates reward creation, token regeneration/revocation, concurrent claim start, provider operation uniqueness, mock completion, signed webhook delivery, operator RBAC/audit, liquidity/retention controls, and a sanitized valueless wallet compatibility run. The adapter now gates exact verified wallet versions and prefers persistent RPC plus stable status polling. This evidence establishes feasibility only; it is not independent review or upstream approval.

## Future research and development

Funded work will establish the supported upstream wallet boundary and ambiguous-effect semantics; build deterministic sandbox orchestration and failure injection; commission independent security/privacy work and remediate findings; mature SDK/contract/reference integration; and test accessibility, deployment, recovery, and community onboarding. Outputs will remain reusable, documented, reproducible, and AGPL-3.0-or-later.

Applicant capability and relevant prior work: **[OWNER INPUT REQUIRED]**.
