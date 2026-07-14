# NGI TALER baseline and proposed deliverables

## Pre-application baseline — not requested from NLnet

The following work existed before the proposed grant and must not be used as a payable milestone:

- standalone TypeScript/Fastify service, PostgreSQL schema and reward state machine;
- tenant/operator credentials, RBAC, audit events, liquidity gates and retention controls;
- exact money, hashed claims, encrypted provider capabilities and signed webhooks;
- OpenAPI, architecture, threat/privacy/data-flow and operations documentation;
- experimental wallet-core peer-push CLI adapter, mock provider and guarded valueless demo evidence;
- container definition, test suites, dependency/license checks and SBOM generation.

The baseline demonstrates feasibility but remains a sandbox prototype. It is not an upstream-supported or production-approved operator interface.

## Proposed post-MoU deliverables

1. **Upstream peer-push idempotency and operator protocol — €9,000.** Publish the failure model, public upstream design discussion, reviewable implementation/patch, tests and authoritative state mapping.
2. **Hardened provider boundary — €13,200.** Implement capability/version negotiation and a supportable operator boundary; publish crash, ambiguity, reconciliation, expiry, balance, terms and KYC-state evidence.
3. **FOSS integration and adoption kit — €9,000.** Expand the SDK, publish stable examples, deliver a Formbricks Community reference adapter and collect feedback from at least three prospective integrators/operators.
4. **Accessibility, localisation, packaging and documentation — €6,000.** Add i18n and two reviewed European-language translations, publish WCAG 2.2 AA evidence/remediation, produce reproducible release artifacts and complete user/operator/integrator documentation.
5. **Independent security review, remediation and 1.0 release — €9,600.** Publish a review or disclosure-safe summary, disposition every finding, resolve all critical/high findings, and publish version 1.0 plus the final report.

Total requested support: **€46,800**. See `docs/nlnet/PROPOSAL_DRAFT.txt` and `docs/nlnet/BUDGET.md` for tasks, effort, rate and acceptance evidence.

Upstream merge, third-party adoption and production regulatory approval are desirable outcomes but are not milestone acceptance conditions because the applicant cannot unilaterally guarantee them. The deliverables are the public design, implementation, tests, submissions, review evidence and documented dispositions.
