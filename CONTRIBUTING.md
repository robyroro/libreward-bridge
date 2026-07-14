# Contributing

Use Node.js 22 and PostgreSQL 17. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run openapi:validate`, and `npm run build` before opening a change. Security-sensitive changes need tests for tenant isolation, concurrency, state transitions, and redaction. Do not commit credentials, wallet databases, real claim links, or personal data. Contributions are accepted under AGPL-3.0-or-later.
