# Operator API and RBAC

Operator access is separate from tenant access. Tenant keys use the `lrk_` prefix and can never authenticate to `/v1/operator/*`; operator keys use `lro_`, a separate hash secret, and role-derived scopes. Put operator routes behind a private network, mTLS or an identity-aware proxy in addition to application authentication.

## Roles

| Role | Scopes |
| --- | --- |
| `viewer` | Inspect rewards, events, webhook delivery state, and cached liquidity. |
| `operator` | Viewer access plus known-ID reconciliation, failed-webhook retry, and a fresh liquidity check. |
| `admin` | Operator access plus audit-event reads and retention preview/execution. |

Create a key from a restricted shell. The secret is printed once and only its keyed hash is stored:

```sh
npm run cli -- operator:create --name "On-call operator" --role operator
npm run cli -- operator:key-rotate --operator op_...
npm run cli -- operator:key-revoke --prefix lro_...
```

Set `OPERATOR_API_KEY_HASH_SECRET` independently from `API_KEY_HASH_SECRET`. Rotate by creating a replacement, changing the client, verifying use through `last_used_at`, and revoking the old prefix. Never put operator keys in browser storage or a tenant application.

## Endpoints

- `GET /v1/operator/rewards/{reference}`: sanitized reward/provider state; never returns a claim token, provider URI, or encryption material.
- `GET /v1/operator/rewards/{reference}/events`: lifecycle events.
- `GET /v1/operator/rewards/{reference}/webhook-deliveries`: sanitized delivery history.
- `POST /v1/operator/rewards/{reference}/reconcile`: query a known provider transaction; it never initiates a replacement purse.
- `POST /v1/operator/webhook-deliveries/{id}/retry`: retry only a terminal failed delivery.
- `GET /v1/operator/liquidity`: cached balance state.
- `POST /v1/operator/liquidity/check`: queue an explicit balance check for the serialized wallet worker; inspect the cached result afterward.
- `POST /v1/operator/retention/run`: defaults to `dry_run: true`; deletion requires `dry_run: false` and the admin role.
- `GET /v1/operator/audit-events`: admin-only append-only audit history.

Every successful operator read or mutation appends an audit event containing the operator public ID, action, target, request ID, and a bounded non-secret detail object. Source IPs and authorization values are not stored in the audit table.

## Deployment controls

Use a dedicated operator DNS name or private listener where possible. Restrict ingress to the operations network, cap requests with `OPERATOR_RATE_LIMIT_MAX`, alert on repeated 401/403 responses at the reverse proxy, and back up the audit table. A database administrator can still bypass application RBAC; database access therefore remains a separately audited privileged role.
