import type { FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import type { Config } from "./config.js";
import { keyedHash, safeEqualHex } from "./domain/crypto.js";
import { AppError } from "./errors.js";
import type { Tenant } from "./services/reward-service.js";

declare module "fastify" {
  interface FastifyRequest {
    tenant?: Tenant;
    operator?: OperatorPrincipal;
    scopes?: ReadonlySet<string>;
  }
}

export type OperatorPrincipal = Readonly<{
  id: string;
  publicId: string;
  role: "viewer" | "operator" | "admin";
}>;

export function authenticate(pool: pg.Pool, config: Config, requiredScope: string) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const authorization = request.headers.authorization ?? "";
    const match = /^Bearer (lrk_[A-Za-z0-9_-]{8,24}\.[A-Za-z0-9_-]{32,64})$/.exec(authorization);
    if (!match?.[1]) throw new AppError(401, "unauthorized", "Invalid API credentials");
    const prefix = match[1].split(".")[0];
    const result = await pool.query<{
      secret_hash: string;
      scopes: string[];
      tenant_id: string;
      public_id: string;
      status: string;
      revoked_at: Date | null;
      expires_at: Date | null;
    }>(
      `SELECT k.secret_hash,k.scopes,k.tenant_id,k.revoked_at,k.expires_at,t.public_id,t.status
       FROM api_keys k JOIN tenants t ON t.id=k.tenant_id WHERE k.key_prefix=$1`,
      [prefix],
    );
    const row = result.rows[0];
    const candidate = keyedHash(config.API_KEY_HASH_SECRET, match[1]);
    if (
      !row ||
      !safeEqualHex(row.secret_hash, candidate) ||
      row.revoked_at ||
      (row.expires_at && row.expires_at <= new Date()) ||
      row.status !== "active"
    ) {
      throw new AppError(401, "unauthorized", "Invalid API credentials");
    }
    if (!row.scopes.includes(requiredScope) && !row.scopes.includes("*"))
      throw new AppError(403, "forbidden", "API key lacks required scope");
    request.tenant = { id: row.tenant_id, publicId: row.public_id };
    request.scopes = new Set(row.scopes);
    void pool.query(
      "UPDATE api_keys SET last_used_at=now() WHERE key_prefix=$1 AND (last_used_at IS NULL OR last_used_at<now()-interval '5 minutes')",
      [prefix],
    );
  };
}

export function requireTenant(request: FastifyRequest): Tenant {
  if (!request.tenant) throw new AppError(401, "unauthorized", "Invalid API credentials");
  return request.tenant;
}

export function authenticateOperator(pool: pg.Pool, config: Config, requiredScope: string) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const authorization = request.headers.authorization ?? "";
    const match = /^Bearer (lro_[A-Za-z0-9_-]{8,24}\.[A-Za-z0-9_-]{32,64})$/.exec(authorization);
    if (!match?.[1]) throw new AppError(401, "unauthorized", "Invalid operator credentials");
    const prefix = match[1].split(".")[0];
    const result = await pool.query<{
      secret_hash: string;
      scopes: string[];
      operator_id: string;
      public_id: string;
      role: OperatorPrincipal["role"];
      status: string;
      revoked_at: Date | null;
      expires_at: Date | null;
    }>(
      `SELECT k.secret_hash,k.scopes,k.operator_id,k.revoked_at,k.expires_at,
         o.public_id,o.role,o.status
       FROM operator_api_keys k JOIN operator_accounts o ON o.id=k.operator_id
       WHERE k.key_prefix=$1`,
      [prefix],
    );
    const row = result.rows[0];
    const candidate = keyedHash(config.OPERATOR_API_KEY_HASH_SECRET, match[1]);
    if (
      !row ||
      !safeEqualHex(row.secret_hash, candidate) ||
      row.revoked_at ||
      (row.expires_at && row.expires_at <= new Date()) ||
      row.status !== "active"
    )
      throw new AppError(401, "unauthorized", "Invalid operator credentials");
    if (
      (!row.scopes.includes(requiredScope) && !row.scopes.includes("*")) ||
      !roleAllows(row.role, requiredScope)
    )
      throw new AppError(403, "forbidden", "Operator key lacks required scope");
    request.operator = { id: row.operator_id, publicId: row.public_id, role: row.role };
    request.scopes = new Set(row.scopes);
    void pool.query(
      `UPDATE operator_api_keys SET last_used_at=now() WHERE key_prefix=$1
       AND (last_used_at IS NULL OR last_used_at<now()-interval '5 minutes')`,
      [prefix],
    );
  };
}

export function requireOperator(request: FastifyRequest): OperatorPrincipal {
  if (!request.operator) throw new AppError(401, "unauthorized", "Invalid operator credentials");
  return request.operator;
}

function roleAllows(role: OperatorPrincipal["role"], scope: string): boolean {
  const viewer = new Set(["operator:read"]);
  const operator = new Set([
    ...viewer,
    "operator:reconcile",
    "operator:webhook-retry",
    "operator:liquidity-check",
  ]);
  if (role === "viewer") return viewer.has(scope);
  if (role === "operator") return operator.has(scope);
  return new Set([...operator, "operator:audit-read", "operator:retention-run"]).has(scope);
}
