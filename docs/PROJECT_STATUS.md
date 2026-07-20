# Public project status

Last updated: 2026-07-20.

LibreReward Bridge v0.1.0-alpha.1 is a public research prototype for exact-value, single-use GNU Taler reward claims. Existing feasibility work includes the generic API/worker/PostgreSQL model, tenant/operator controls, mock end-to-end flow, preliminary wallet provider, signed webhooks, liquidity/retention, OpenAPI/SDK, claim UX, tests, deployment material, and sanitized valueless sandbox evidence.

The current adapter prefers persistent wallet RPC and stable status polling; its exact wallet versions are gated. Upstream confirmation, reproducible current interoperability evidence, independent reviews, online key rotation, and operator legal/treasury decisions remain future work. No real-money approval is claimed.

The proposed NGI work and €42,000 budget are in [`grant/`](../grant/). They fund future upstream alignment, testbed, independent review/remediation, reusable integration outputs, accessibility, and operations—not completed prototype work. Owner identity/eligibility/dates and other private facts remain `[OWNER INPUT REQUIRED]`.

Current commands and evidence locations are enumerated in [EXTERNAL_REVIEW_INDEX.md](EXTERNAL_REVIEW_INDEX.md). Historical 2026-07 evidence is retained with its date; it must not be represented as a current release run without reproduction.
