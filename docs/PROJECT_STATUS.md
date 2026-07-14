# Public project status

Last updated: 2026-07-14.

## Pre-application baseline

LibreReward Bridge 0.1.0 is a public sandbox prototype for exact-value, single-use GNU Taler reward claims. The generic API, worker, PostgreSQL state model, wallet CLI adapter, mock-provider flow, operator controls, data-minimizing claim pages, OpenAPI contract, and deployment documentation exist before any proposed NGI TALER grant.

Local verification on 2026-07-14 passed formatting, linting, type checking, 25 unit tests, all 11 PostgreSQL 17.10 integration tests, OpenAPI validation, build, the production dependency audit, and the production license allowlist. The integration run used a fresh isolated cluster from the portable PostgreSQL distribution already present on this host. The standalone GitHub Actions workflow has now been added but has no public container/secret-scan run until these changes are pushed.

The wallet adapter remains experimental. It uses a development/testing wallet-core operation, lacks a caller-controlled idempotency key for peer-push initiation, and is not approved for real-money production use.

## Proposed next phase

The proposed NGI TALER work is defined in `docs/nlnet/PROPOSAL_DRAFT.txt` and `docs/nlnet/BUDGET.md`. It begins after an MoU and does not request payment for the pre-application baseline.

If funded, this page will be updated at least every two months with milestone status, links to published outputs, tests, upstream discussions, audit findings and dispositions, accessibility evidence, releases, and changes to schedule or scope.
