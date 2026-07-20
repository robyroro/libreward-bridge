# NGI TALER / NLnet application draft

## Applicant

Legal name, address/country, email, eligibility, organization status, and payment details: **[OWNER INPUT REQUIRED]**.

## Project

**LibreReward Bridge — upstream-aligned private exact-value reward infrastructure**

LibreReward Bridge is a privacy-preserving open-source bridge for distributing exact-value rewards through GNU Taler. An integrator creates an idempotent reward, sends a single-use bearer claim to a recipient, and receives a signed final-state webhook. An operator wallet funds the GNU Taler peer-push claim; LibreReward neither creates nor custodies the recipient wallet.

Many small-reward systems collect recipient accounts or depend on identity-rich payout processors. GNU Taler uniquely fits this research direction because its wallet protocol permits a recipient-controlled wallet to import a peer-push capability. The bridge turns that protocol into reusable, tenant-scoped infrastructure while keeping recipient identity outside the application. It does not operate an exchange, bank, or merchant backend and does not resolve operator legal obligations.

## Starting point and need for funding

The public AGPL prototype already proves feasibility: API/worker/PostgreSQL state, tenant/operator separation, concurrency/idempotency controls, mock end-to-end flow, wallet adapter, signed webhooks, liquidity/retention, tests, OpenAPI, and sanitized valueless sandbox evidence. Funding is not requested for this completed work.

The unresolved R&D is material: replace/formalize a testing-only wallet wait interface; establish an upstream-supported long-running boundary and unknown-effect semantics; automate reproducible valueless interoperability/failure evidence; obtain genuine independent security/privacy review; mature reusable SDK/contract/examples; and validate accessibility, upgrades, and operations.

## Plan, outputs, and budget

Five work packages over an estimated nine months cover upstream integration, interoperability testbed, independent validation/remediation, reusable integration ecosystem, and adoption/accessibility/operations. The request is €42,000: 600 engineering hours at €60 (€36,000) and €6,000 ring-fenced for independent review. Detailed milestones and deliverables are in this directory.

Outputs are measurable public source, version matrices, test scenarios, sanitized evidence, review/remediation records, SDK/conformance tools, accessible claim evidence, operational exercises, upstream engagement, and alpha/beta artifacts. Work remains AGPL-3.0-or-later and generic rather than tied to a commercial platform.

## Risks and sustainability

The largest risks are changing upstream interfaces, ambiguous external wallet effects, public sandbox dependencies, independent-review availability, and jurisdiction-specific obligations. The design fails closed, never automatically repeats an ambiguous payout, keeps internet tests opt-in/valueless, schedules review before beta, and keeps real-money approval outside this R&D claim. Maintenance will use documented releases, issue templates, dependency automation, upstream feedback, and contributor guidance.

Repository URL, requested start/end date, applicant track record, community evidence, reviewer procurement, tax treatment, and any form-specific declarations: **[OWNER INPUT REQUIRED]**.

## AI disclosure

Codex and Claude substantially assisted implementation, documentation, testing support, review, and this draft. The maintainer validates and owns the result; automated output is not independent review. Actual provenance is retained where available, and no fake history is claimed.
