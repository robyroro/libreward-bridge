# Generative AI usage and provenance

LibreReward Bridge permits responsible use of generative AI as an assistive tool. Human contributors remain responsible for originality, licensing, security, correctness, reproducibility, and being able to explain every delivered result. Purely generated output is not treated as grant-eligible human work.

## Disclosed use

| Date | Tool/model | Scope | Public evidence |
| --- | --- | --- | --- |
| 2026-07-14 | Anthropic Claude Opus 4.8 | Assisted the standalone extraction represented by the initial commit. The exact historical prompt transcript is not present in this repository and must be supplied by the maintainer if the initial materials are submitted for evaluation. The original public root briefly used a `Co-Authored-By` trailer; history was rewritten on 2026-07-14 to avoid representing a software tool as a human contributor while retaining this disclosure. | Commit `5fb35ac6faea00da81877e5c78df7d385096b29f` records the neutral sentence “AI assistance was provided by Claude Opus 4.8.” |
| 2026-07-14 | OpenAI Codex, GPT-5 | Audited NLnet eligibility/readiness, drafted the NGI TALER application package, activated standalone CI, corrected evidence claims, and ran local verification. | `docs/nlnet/GENAI_PROPOSAL_LOG.md` and the repository diff. |
| 2026-10-02 | Anthropic Claude Opus 5.5 | Reviewed upstream wallet-core source (v1.6.12, v1.6.48) and the 2026-07-14 upstream mailing-list answers; drafted the design and plan under `docs/superpowers/` and implemented the wallet RPC transport, preflight, state mapping, worker flow, migration 003, tests and documentation. | Commits on branch `wallet-rpc-transport` carrying `GenAI-use:` trailers. |

## Required contribution practice

For substantive GenAI-assisted work, commits should record:

- tool and model, including a version when exposed;
- what the tool was used for;
- a prompt/interactions log or an intelligible summary and location of the generated output;
- the human verification performed, including tests and license/provenance review.

Proposal-writing logs must retain the model, date and time, exact prompts, and unedited outputs. Generated code must be distinguishable through commit provenance or an equivalent public record. Documentation-only or testing-only use may be recorded as a general description, but more precise logging is preferred.

Secrets, personal data, private claim links, wallet contents, credentials, unpublished vulnerabilities, and third-party confidential material must never be submitted to a model. A contributor must not introduce output that they cannot lawfully publish under the project license.
