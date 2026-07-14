# Generative AI usage and provenance

LibreReward Bridge permits responsible use of generative AI as an assistive tool. Human contributors remain responsible for originality, licensing, security, correctness, reproducibility, and being able to explain every delivered result. Purely generated output is not treated as grant-eligible human work.

## Disclosed use

| Date | Tool/model | Scope | Public evidence |
| --- | --- | --- | --- |
| 2026-07-14 | Anthropic Claude Opus 4.8 | Assisted the standalone extraction represented by the initial commit. The exact historical prompt transcript is not present in this repository and must be supplied by the maintainer if the initial materials are submitted for evaluation. | Commit `9949c3b47f1d370a953d0d604a77bea602153765` includes a `Co-Authored-By` trailer. |
| 2026-07-14 | OpenAI Codex, GPT-5 | Audited NLnet eligibility/readiness, drafted the NGI TALER application package, activated standalone CI, corrected evidence claims, and ran local verification. | `docs/nlnet/GENAI_PROPOSAL_LOG.md` and the repository diff. |

## Required contribution practice

For substantive GenAI-assisted work, commits should record:

- tool and model, including a version when exposed;
- what the tool was used for;
- a prompt/interactions log or an intelligible summary and location of the generated output;
- the human verification performed, including tests and license/provenance review.

Proposal-writing logs must retain the model, date and time, exact prompts, and unedited outputs. Generated code must be distinguishable through commit provenance or an equivalent public record. Documentation-only or testing-only use may be recorded as a general description, but more precise logging is preferred.

Secrets, personal data, private claim links, wallet contents, credentials, unpublished vulnerabilities, and third-party confidential material must never be submitted to a model. A contributor must not introduce output that they cannot lawfully publish under the project license.
