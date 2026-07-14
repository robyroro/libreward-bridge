# ADR-001: extraction-ready standalone service

Status: accepted for 0.1.0.

## Decision

Implement LibreReward Bridge as a TypeScript/Node.js 22 service with Fastify, PostgreSQL, an API process, and a database-backed worker. Keep it in a self-contained directory that can become its own repository. Do not import Laravel or commercial-platform models.

## Rationale

The existing repository is a commercial Laravel monolith with user-session auth and private fraud logic. A separate dependency graph, schema, API key system, container, and CI make the public boundary testable and prevent accidental proprietary imports. PostgreSQL provides unique constraints, row locks, `SKIP LOCKED`, transactions, and horizontal worker coordination without Redis.

## Consequences

The reference platform integrates over HTTP/webhooks and must operate another deployable service. Database-backed work is simpler but lower-throughput than a dedicated broker. This tradeoff is appropriate for monetary control-plane work.
