# LibreReward Bridge

[![LibreReward Bridge CI](https://github.com/robyroro/libreward-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/robyroro/libreward-bridge/actions/workflows/ci.yml)

LibreReward Bridge is privacy-preserving middleware that lets a platform create an exact-value monetary reward, issue a single-use bearer claim, fund it from an operator-controlled GNU Taler wallet, observe its lifecycle, and receive signed webhooks. It is independent of any survey, loyalty, affiliate, gaming, or rewards platform.

Maturity: **0.1.0 sandbox prototype**. The generic core, separate operator RBAC/API, payout/liquidity controls, automated retention, current wallet CLI compatibility, and a pre-funded valueless GNU Taler demo-wallet matrix have pre-application evidence. “Pre-funded” here describes test-wallet balance, not grant funding. The standalone CI workflow is active in the repository; its first public run is pending the push of that workflow. Independent security/privacy/legal/treasury approval is still pending; see `docs/SECURITY_PRIVACY_LEGAL_REVIEW.md`. Do not enable real-money production use.

## Architecture

The API and worker share PostgreSQL. Reward creation is tenant-idempotent. A claim token is derived from random non-secret material with a keyed PRF; only its keyed hash and derivation material are stored. Starting a claim transactionally creates one provider operation. The worker invokes wallet-core `initiatePeerPushDebit`, encrypts the resulting `taler://pay-push` URI, and reconciles `getTransactionById` until final. Final events enqueue bounded HMAC-signed webhooks.

No recipient identity, browser fingerprint, advertising ID, integrator user ID, or third-party tracker is required.

## Quick start

```sh
cp .env.example .env
# Generate three independent secrets; DATA_ENCRYPTION_KEY is 32 base64url bytes.
docker compose up --build
docker compose run --rm api node dist/src/cli.js tenant:create --name demo
```

Docker is optional. For a local PostgreSQL:

```sh
npm ci
npm run migrate
npm run cli -- tenant:create --name demo
npm run dev
# separate terminal
npm run build && npm run worker
```

Set `LIBREREWARD_DEMO_API_KEY` to the key printed by `tenant:create` and set `LIBREREWARD_DEMO_IDEMPOTENCY_KEY` to a stable opaque business-event identifier, then create a reward:

```sh
curl -sS http://localhost:8080/v1/rewards \
  -H "Authorization: Bearer ${LIBREREWARD_DEMO_API_KEY}" \
  -H "Idempotency-Key: ${LIBREREWARD_DEMO_IDEMPOTENCY_KEY}" \
  -H 'Content-Type: application/json' \
  --data '{"amount":"KUDOS:5.25","description":"Participation reward","external_reference":"opaque-0001"}'
```

Open the returned `claim_url`. With the mock provider, the flow is deterministic but does not transfer money. For GNU Taler setup, read `docs/TALER_SETUP.md`.

For a guarded pre-funded demo-wallet run, configure three distinct valueless wallet databases and run `npm run sandbox:evidence`. The command requires `LIBREREWARD_ENV=test`, an HTTPS demo exchange, a test currency, and the explicit confirmation `SANDBOX_EVIDENCE_CONFIRM=valueless-demo-only`; it emits only sanitized identifiers and states.

## Safety properties

- tenant-scoped hashed API keys with scopes, rotation, revocation, and generic failures;
- database uniqueness and request fingerprints for create idempotency;
- row locks and a unique provider-operation constraint for concurrent claims;
- exact Taler amounts with eight fractional decimal places and no binary floating point;
- hashed claim tokens and encrypted provider bearer URIs;
- explicit state transitions with append-only events;
- no automatic repeat after an ambiguous wallet-core initiation;
- HTTPS-only, private-network-blocked webhooks by production default;
- signed deterministic webhook payloads with bounded exponential retry;
- CSP, no-store, no-referrer, no cookies, and no analytics on claim pages;
- structured log redaction and low-cardinality metrics;
- separate role-scoped operator keys, append-only operator audit events, and private-network deployment guidance;
- atomic per-currency daily payout caps plus cached fail-closed wallet balance floors;
- configurable daily retention with an admin dry-run and recorded execution counts.

## Development and release

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
TEST_DATABASE_URL=postgres://... npm run test:integration
npm run openapi:validate
npm run build
npm audit --omit=dev
npm run license:check
npm run sbom
```

The OpenAPI 3.1 contract is `openapi.yaml`; `docs/API.md` documents authentication, idempotency, errors, and webhooks. Operations, backups, reconciliation, and incident handling are in `docs/OPERATIONS.md`.

Create restricted operator credentials only after migrations:

```sh
npm run cli -- operator:create --name "On-call" --role operator
npm run cli -- liquidity:check
npm run cli -- retention:run --dry-run
```

See `docs/OPERATOR_API.md`, `docs/PRODUCTION_RUNBOOKS.md`, and `deployment/prometheus-alerts.yml`. These controls remain standalone and are not wired into Recompensated.

## GNU Taler prerequisites

Real operation requires a supported `taler-wallet-cli`, a dedicated funded wallet database, an exchange that permits peer payments, accepted exchange terms, and a serialized worker. The Bridge does not operate an exchange, bank, merchant backend, or recipient wallet.

## License and contributing

The server is licensed under AGPL-3.0-or-later to remain compatible with optional GPLv3+ wallet-core operation and to protect network-service improvements. See `LICENSE`, `COPYRIGHT.md`, `docs/LICENSING.md`, `THIRD_PARTY_NOTICES.md`, `CONTRIBUTING.md`, and `SECURITY.md`. Generative-AI assistance is disclosed in `docs/GENAI_USAGE.md`; human contributors remain responsible for legality, correctness and quality.

## NGI TALER application package

The pre-application baseline and proposed future work are deliberately separated. The form-ready draft, costed milestones, comparison, GenAI prompt log, and final confirmation checklist are under `docs/nlnet/`. Private contact and eligibility facts belong in NLnet's form, not in this public repository.
