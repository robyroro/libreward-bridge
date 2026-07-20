# Maintainer and agent guide

LibreReward Bridge is a privacy-preserving open-source bridge for distributing exact-value rewards through GNU Taler. It is a v0.1.0-alpha.1 research prototype for valueless sandbox use, not a real-money service.

## Repository map and authority

- `src/app.ts`: HTTP routes and public claim HTML.
- `src/services/`: transactional domain, worker, webhook, liquidity, retention, and operator behavior.
- `src/providers/`: mock and GNU Taler provider boundaries.
- `migrations/`: ordered, immutable PostgreSQL migrations.
- `openapi.yaml`: normative HTTP contract; `sdk/` follows it.
- `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, and ADRs: authoritative architecture and security decisions.
- `docs/TALER_COMPATIBILITY.md`: verified wallet compatibility and external blockers.

Install with `npm ci`. Use `npm run validate` for formatting, lint, types, unit tests, contract, links, artifact guard, and build. Run PostgreSQL coverage explicitly with `TEST_DATABASE_URL=postgres://... npm run test:integration:required`; use `npm run test:coverage`, `npm audit --omit=dev`, `npm run license:check`, and `npm run sbom` for release evidence.

## Change rules

Use strict TypeScript, parameterized SQL, Zod boundary validation, exact decimal money helpers, generic authentication errors, and structured redacted logs. Preserve tenant predicates on every tenant-owned query. Make state transitions through the state machine and append events transactionally.

Never edit an applied migration; add the next ordered migration and document rollback/compatibility. Backward-incompatible API behavior needs OpenAPI, SDK, API guide, changelog, and upgrade notes in the same change. Security-sensitive changes need negative tests. Concurrency/idempotency changes need real PostgreSQL races, rollback coverage, and proof that only one provider operation can exist.

Wallet changes must use official GNU Taler documentation/source, update the exact version matrix, exercise restart and malformed-response cases, and preserve this invariant: if an external payout may exist, never initiate a replacement automatically. A wallet database or RPC endpoint has one controlling wallet process; stop the LibreReward worker before direct break-glass wallet commands.

Never log credentials, claim URLs/tokens, Taler bearer URIs, webhook secrets, connection strings, wallet errors/bodies, or wallet database content. Do not commit `.env`, databases, dumps, keys, or unsanitized evidence. Keep claim pages free of cookies, analytics, remote fonts/assets, and recipient identity inputs.

No real-money tests, production credentials, fabricated evidence, invented upstream approval, or weakened controls to satisfy a test. Update `AI_USAGE.md` and provenance records for substantive AI-assisted work; generated or owner review is not independent review.
