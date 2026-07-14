# NLnet proposal GenAI provenance log

This log is intended to accompany the NGI TALER application. Times are Europe/Bucharest (EEST, UTC+03:00). The Codex client did not expose the exact send time of the first prompt, so the recorded timestamp is the time the session log was captured; this limitation is stated rather than inventing a timestamp.

## Interaction 1 — readiness audit

- Model: OpenAI Codex, GPT-5 family (the client did not expose a more specific model snapshot)
- Recorded timestamp: 2026-07-14T23:14:10+03:00
- Use: evaluate the public repository against NLnet's live proposal form, NGI TALER guide, eligibility rules and GenAI policy

### Exact prompt

```text
is the project ready and compliant with https://nlnet.nl/propose/ ?
```

### Unedited output

```text
Short answer: **not yet**. The project is likely eligible for NGI TALER and is a promising prototype, but the application package is not submission-ready or fully compliant.

| Area | Assessment |
|---|---|
| NGI TALER relevance | **Pass.** A privacy-preserving, operator-funded reward bridge fits the call’s auxiliary-tool and FOSS-integration scope. |
| Open-source requirement | **Conditional pass.** AGPL-3.0-or-later is suitable, but the repository still says owner/legal approval is pending in docs/LICENSING.md. Confirm ownership and licensing authority unequivocally. |
| R&D objective | **At risk.** The current milestone document marks most substantive work as already completed in docs/NGI_TALER_DELIVERABLES.md. The proposal needs new, grant-funded R&D with verifiable future outcomes. |
| European dimension | **Missing.** This is a stage-one knock-out criterion. State the EU-based applicant/team, European deployment need, or concrete European ecosystem impact. |
| Budget/value for money | **Missing.** There is no requested amount, hours, rates, funding history, or cost allocation. The request must be €5,000–€50,000. |
| Application answers | **Missing.** No application-ready track record, comparison, technical challenges, ecosystem/adoption plan, other funding, or concise future work plan exists. |
| GenAI policy | **Potential blocker.** If GenAI produced substantive proposal text, code, or documentation, NLnet requires disclosure and provenance logging. |
| Production readiness | **No.** The repository itself correctly prohibits real-money use in README.md. Production readiness is not required to apply. |

Technical verification was encouraging: format, lint, typecheck, build, OpenAPI validation, 25 unit tests, dependency audit with zero vulnerabilities, and the license allowlist passed. However:

- All 11 PostgreSQL integration tests were skipped locally.
- The standalone public repository has no active .github/workflows directory or workflow runs. The CI file explicitly says it still needs copying into place: deployment/standalone-ci.yml.
- Therefore, statements that the standalone repository’s root workflow and container checks pass are presently inaccurate.
- The upstream request has no public archive or maintainer response yet: docs/UPSTREAM_REQUEST_2026-07.md.
- The adapter remains experimental, relies on a testing interface, and lacks caller-controlled initiation idempotency: docs/KNOWN_LIMITATIONS.md.

Before submitting, I would:

1. Reframe the existing prototype as prior work and propose a new phase—ideally an upstream-supported peer-push operator interface/idempotency mechanism, public reference integration, independent security/accessibility work, packaging, and release documentation.
2. Prepare every answer requested by the NLnet proposal form, including explicit hours, rates, task amounts, other funding, comparison, challenges, and ecosystem engagement.
3. Explicitly establish the European dimension and confirm applicant eligibility, conflicts, and prior NGI TALER funding against the €60,000 cumulative cap.
4. Activate CI, rerun mandatory PostgreSQL/container checks, and correct claims inherited from the earlier monorepo.
5. Confirm copyright provenance and authority to license everything under AGPL.
6. Explain differentiation from funded efforts such as the Taler Fastify plugin and P2P/payment integrations: LibreReward is an outbound, single-use, operator-funded reward capability—not an inbound merchant checkout or donation plugin.
7. Add the required GenAI disclosure/provenance. If any part of this assessment is reused in the application, preserve this prompt and the unedited response with model and timestamp, as required by NLnet’s GenAI policy.

NLnet scores technical excellence 30%, impact 40%, and value for money 30%, with a 5/7 threshold; the current package cannot be scored because the future plan and budget are absent. Their sample MoU also ties payments to newly published, verifiable milestones, reinforcing the need for a forward-looking plan. See the NGI TALER applicant guide and eligible activities.

The deadline is **August 1, 2026 at 12:00 CEST**. The right verdict is: **eligible concept, strong technical starting point, but do not submit in its current form.**
```

Markdown links in the rendered conversational output pointed to the local files and official pages named in the text above. The wording is otherwise unedited.

## Interaction 2 — application and remediation work

- Model: OpenAI Codex, GPT-5 family (the client did not expose a more specific model snapshot)
- Timestamp: 2026-07-14T23:14:10+03:00
- Use: draft the application, budget, comparison and checklists; activate standalone CI; correct repository evidence; add licensing and project-level GenAI provenance; run verification

### Exact prompt

```text
do all
```

Context available to the model included Interaction 1, the prior audit output, the repository contents and the live official sources consulted during that audit.

### Unedited proposal output

The primary proposal-writing output is preserved without subsequent edits in `GENAI_OUTPUT_2026-07-14.txt`. Attach that file together with this log. The working copy is `PROPOSAL_DRAFT.txt`; any later human or AI revision must not overwrite the preserved output.

### Other generated outputs

The same interaction generated repository remediation and supporting materials. The exact output is reviewable in the uncommitted repository diff at the time of creation and includes:

- `.github/workflows/ci.yml`
- `COPYRIGHT.md`
- `docs/GENAI_USAGE.md`
- `docs/PROJECT_STATUS.md`
- `docs/nlnet/BUDGET.md`
- `docs/nlnet/COMPARISON.md`
- `docs/nlnet/APPLICANT_CONFIRMATIONS.md`
- `docs/nlnet/SUBMISSION_CHECKLIST.md`
- corrections to existing readiness, licensing and contribution documentation

The proposal must not claim these changes as paid grant work; they are pre-submission preparation.

## Working-draft revision record

During the same Interaction 2, the working proposal was reviewed against public evidence and revised to replace the European-dimension placeholder with a concrete project-based explanation referencing GNU Taler, European research/civic users and Germany-based Formbricks. It was also clarified that the independently deployable component is the proposed project boundary, avoiding confusion between project scope and prior funding. Finally, the suggested files were reduced to the form's three general attachment slots, with the two GenAI files assigned to the separate prompt-file slots. The preserved unedited output was not changed. Further AI-assisted revisions require another dated prompt/output entry.

## Interaction 3 — attribution correction

- Model: OpenAI Codex, GPT-5 family (the client did not expose a more specific model snapshot)
- Timestamp: 2026-07-14T23:56:18+03:00
- Use: replace GitHub's special co-author trailer with neutral AI-assistance disclosure, update the rewritten root commit identifier, and keep the proposal accurate after the history correction

### Exact prompt

```text
do it
```

Context: this directly followed the request “how to remove claude from contributor?” and the explanation that the public root commit contained a `Co-Authored-By` trailer.

### Unedited proposal-text output

```text
The initial public prototype commit records that Claude Opus 4.8 was used as an AI assistant; Claude is not represented as a human or legal co-author/contributor. That assistance concerns pre-existing project materials rather than grant-funded work and is disclosed in docs/GENAI_USAGE.md. Historical prompt transcripts must be supplied if available. All generated material is subject to human review, testing and license/provenance checks; no purely generated output will be presented as grant-eligible human work.
```

The original `GENAI_OUTPUT_2026-07-14.txt` remains byte-for-byte unchanged and therefore describes the pre-rewrite co-author trailer. This dated record explains the later correction rather than altering the preserved output.
