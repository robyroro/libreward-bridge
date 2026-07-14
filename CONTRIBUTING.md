# Contributing

Use Node.js 22 and PostgreSQL 17. Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run openapi:validate`, and `npm run build` before opening a change. Security-sensitive changes need tests for tenant isolation, concurrency, state transitions, and redaction. Do not commit credentials, wallet databases, real claim links, or personal data. Contributions are accepted under AGPL-3.0-or-later; by submitting, contributors certify that they have the right to offer their work under that license.

Generative-AI assistance must follow `docs/GENAI_USAGE.md`. For substantive use, record the tool/model, purpose, prompt log or equivalent summary, generated-output location, and human verification. Never present purely generated material as human-authored grant work.
