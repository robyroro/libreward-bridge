# API guide

The normative contract is `openapi.yaml`. Tenant calls use `Authorization: Bearer lrk_<prefix>.<secret>`. Keys are scoped to reward read/write and webhook read/write. Authentication failures are generic. Rotate with `npm run cli -- key:rotate --tenant tn_...`, switch clients, then revoke the old prefix.

Operator calls use a distinct `Authorization: Bearer lro_<prefix>.<secret>`, separate hash secret, and viewer/operator/admin role scopes. Tenant keys cannot access operator routes. Operator endpoints expose sanitized reward/provider state, known-ID reconciliation, delivery retry, cached/fresh liquidity, retention dry-run/execution, and append-only audit history. See `OPERATOR_API.md`; deploy these endpoints behind a private access layer.

`POST /v1/rewards` requires `Idempotency-Key`. Keys are tenant-scoped. The server fingerprints the normalized amount, description, opaque reference, metadata, and expiry. An identical replay returns HTTP 200 and the same logical result; a changed body returns `idempotency_conflict`. Keep keys stable for a business event.

Amounts use `CURRENCY:value[.fraction]`, up to eight fractional digits, for example `EUR:2.5` or `KUDOS:0.00000001`. Configured currencies and maximum whole value are enforced.

Errors use:

```json
{"error":{"code":"idempotency_conflict","message":"Idempotency-Key was already used with a different request","request_id":"req-..."}}
```

Claim endpoints use an unguessable bearer token and need no account. `POST /claim/:token/start` returns 202 because provider work is asynchronous. Poll `GET /claim/:token/status`; `taler_uri` appears when wallet-core has prepared the purse.

## Webhook verification

The Bridge sends canonical JSON with `X-LibreReward-Event-Id`, `X-LibreReward-Timestamp`, and `X-LibreReward-Signature: v1=<hex>`. Compute HMAC-SHA256 over `<timestamp>.<raw-body>` using the endpoint secret, compare in constant time, reject timestamps outside five minutes, and persist event IDs before processing.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
const supplied = Buffer.from(signature.replace(/^v1=/, ""), "hex");
if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("bad signature");
```

Delivery is at least once. A 2xx response acknowledges it. Retries are bounded exponential backoff; event IDs make duplicates identifiable.

API `/v1` remains backward compatible within the pre-1.0 line where practical. Breaking semantics require a documented deprecation window or a new versioned path. Database structure is not a public contract.
