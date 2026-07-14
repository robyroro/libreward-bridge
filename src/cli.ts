import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { keyedHash } from "./domain/crypto.js";
import { publicId, randomSecret, uuid } from "./domain/ids.js";
import { providerFor } from "./runtime.js";
import { LiquidityService } from "./services/liquidity-service.js";
import { OperationWorker } from "./services/operation-worker.js";
import { serializedProviderCall } from "./services/provider-lock.js";
import { RetentionService } from "./services/retention-service.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "migrate":
      await migrate(pool);
      process.stdout.write("Migrations applied.\n");
      break;
    case "tenant:create": {
      const name = value(args, "--name");
      const tenantId = uuid();
      const tenantPublicId = publicId("tn");
      const prefix = publicId("lrk");
      const rawKey = `${prefix}.${randomSecret()}`;
      await pool.query("BEGIN");
      try {
        await pool.query(
          "INSERT INTO tenants(id,public_id,display_name,status) VALUES($1,$2,$3,'active')",
          [tenantId, tenantPublicId, name],
        );
        await pool.query(
          "INSERT INTO api_keys(id,tenant_id,key_prefix,secret_hash,scopes) VALUES($1,$2,$3,$4,$5)",
          [
            uuid(),
            tenantId,
            prefix,
            keyedHash(config.API_KEY_HASH_SECRET, rawKey),
            ["rewards:read", "rewards:write", "webhooks:read", "webhooks:write"],
          ],
        );
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
      process.stdout.write(`Tenant: ${tenantPublicId}\nAPI key (shown once): ${rawKey}\n`);
      break;
    }
    case "key:rotate": {
      const tenantPublicId = value(args, "--tenant");
      const tenant = (
        await pool.query<{ id: string }>("SELECT id FROM tenants WHERE public_id=$1", [
          tenantPublicId,
        ])
      ).rows[0];
      if (!tenant) throw new Error("tenant not found");
      const prefix = publicId("lrk");
      const rawKey = `${prefix}.${randomSecret()}`;
      await pool.query(
        "INSERT INTO api_keys(id,tenant_id,key_prefix,secret_hash,scopes) VALUES($1,$2,$3,$4,$5)",
        [
          uuid(),
          tenant.id,
          prefix,
          keyedHash(config.API_KEY_HASH_SECRET, rawKey),
          ["rewards:read", "rewards:write", "webhooks:read", "webhooks:write"],
        ],
      );
      process.stdout.write(
        `API key (shown once): ${rawKey}\nRevoke the old key after clients switch.\n`,
      );
      break;
    }
    case "key:revoke": {
      const prefix = value(args, "--prefix");
      const result = await pool.query(
        "UPDATE api_keys SET revoked_at=now() WHERE key_prefix=$1 AND revoked_at IS NULL",
        [prefix],
      );
      if (result.rowCount !== 1) throw new Error("active key not found");
      process.stdout.write("Key revoked.\n");
      break;
    }
    case "operator:create": {
      const name = value(args, "--name");
      const role = operatorRole(value(args, "--role"));
      const operatorId = uuid();
      const operatorPublicId = publicId("op");
      const { prefix, rawKey } = operatorKey();
      await pool.query("BEGIN");
      try {
        await pool.query(
          `INSERT INTO operator_accounts(id,public_id,display_name,role,status)
           VALUES($1,$2,$3,$4,'active')`,
          [operatorId, operatorPublicId, name, role],
        );
        await pool.query(
          `INSERT INTO operator_api_keys(id,operator_id,key_prefix,secret_hash,scopes)
           VALUES($1,$2,$3,$4,$5)`,
          [
            uuid(),
            operatorId,
            prefix,
            keyedHash(config.OPERATOR_API_KEY_HASH_SECRET, rawKey),
            scopesForRole(role),
          ],
        );
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
      process.stdout.write(`Operator: ${operatorPublicId}\nAPI key (shown once): ${rawKey}\n`);
      break;
    }
    case "operator:key-rotate": {
      const operatorPublicId = value(args, "--operator");
      const operator = (
        await pool.query<{ id: string; role: "viewer" | "operator" | "admin" }>(
          "SELECT id,role FROM operator_accounts WHERE public_id=$1 AND status='active'",
          [operatorPublicId],
        )
      ).rows[0];
      if (!operator) throw new Error("active operator not found");
      const { prefix, rawKey } = operatorKey();
      await pool.query(
        `INSERT INTO operator_api_keys(id,operator_id,key_prefix,secret_hash,scopes)
         VALUES($1,$2,$3,$4,$5)`,
        [
          uuid(),
          operator.id,
          prefix,
          keyedHash(config.OPERATOR_API_KEY_HASH_SECRET, rawKey),
          scopesForRole(operator.role),
        ],
      );
      process.stdout.write(
        `API key (shown once): ${rawKey}\nRevoke the old operator key after clients switch.\n`,
      );
      break;
    }
    case "operator:key-revoke": {
      const prefix = value(args, "--prefix");
      const result = await pool.query(
        "UPDATE operator_api_keys SET revoked_at=now() WHERE key_prefix=$1 AND revoked_at IS NULL",
        [prefix],
      );
      if (result.rowCount !== 1) throw new Error("active operator key not found");
      process.stdout.write("Operator key revoked.\n");
      break;
    }
    case "reconcile": {
      const reward = value(args, "--reward");
      const found = await new OperationWorker(pool, config, providerFor(config)).reconcileOne(
        reward,
      );
      if (!found) throw new Error("reconcilable provider operation not found");
      process.stdout.write("Reconciliation completed.\n");
      break;
    }
    case "provider:check":
      await serializedProviderCall(pool, () => providerFor(config).verifyConfiguration());
      process.stdout.write("Provider configuration is usable.\n");
      break;
    case "liquidity:check": {
      const result = await new LiquidityService(pool, config, providerFor(config)).check();
      process.stdout.write(`${JSON.stringify(result, bigintJson, 2)}\n`);
      break;
    }
    case "retention:run": {
      const dryRun = args.includes("--dry-run");
      const result = await new RetentionService(pool, config).run("operator", dryRun);
      process.stdout.write(`${JSON.stringify({ dry_run: dryRun, result }, bigintJson, 2)}\n`);
      break;
    }
    case "reward:show": {
      const reference = value(args, "--reference");
      const reward = (
        await pool.query(
          `SELECT r.public_id,r.external_reference,r.status,r.currency,r.amount_value,r.amount_fraction,
            r.expires_at,r.claimed_at,r.cancelled_at,r.failure_code,po.provider,po.state AS provider_state,
            po.external_operation_id,po.last_error_code
           FROM rewards r LEFT JOIN provider_operations po ON po.reward_id=r.id
           WHERE r.public_id=$1 OR r.external_reference=$1 ORDER BY r.created_at DESC LIMIT 1`,
          [reference],
        )
      ).rows[0];
      if (!reward) throw new Error("reward not found");
      process.stdout.write(`${JSON.stringify(reward, bigintJson, 2)}\n`);
      break;
    }
    case "reward:events": {
      const reference = value(args, "--reference");
      const events = await pool.query(
        `SELECT e.event_id,e.event_type,e.data,e.created_at FROM reward_events e JOIN rewards r ON r.id=e.reward_id
         WHERE r.public_id=$1 OR r.external_reference=$1 ORDER BY e.created_at`,
        [reference],
      );
      process.stdout.write(`${JSON.stringify(events.rows, bigintJson, 2)}\n`);
      break;
    }
    case "webhook:deliveries": {
      const reference = value(args, "--reference");
      const deliveries = await pool.query(
        `SELECT d.id,e.event_id,e.event_type,we.public_id AS endpoint_id,d.status,d.attempt_count,d.next_attempt_at,
          d.last_http_status,d.last_error_code,d.delivered_at FROM webhook_deliveries d
         JOIN reward_events e ON e.id=d.event_id JOIN rewards r ON r.id=e.reward_id
         JOIN webhook_endpoints we ON we.id=d.endpoint_id
         WHERE r.public_id=$1 OR r.external_reference=$1 ORDER BY d.created_at`,
        [reference],
      );
      process.stdout.write(`${JSON.stringify(deliveries.rows, bigintJson, 2)}\n`);
      break;
    }
    case "webhook:retry": {
      const deliveryId = value(args, "--delivery");
      const result = await pool.query(
        "UPDATE webhook_deliveries SET status='retry',next_attempt_at=now(),last_error_code=NULL,updated_at=now() WHERE id=$1 AND status='failed'",
        [deliveryId],
      );
      if (result.rowCount !== 1) throw new Error("failed delivery not found");
      process.stdout.write("Webhook delivery queued for retry.\n");
      break;
    }
    default:
      process.stderr.write(
        "Usage: libreward <migrate|tenant:create --name NAME|key:rotate --tenant ID|key:revoke --prefix PREFIX|operator:create --name NAME --role viewer|operator|admin|operator:key-rotate --operator ID|operator:key-revoke --prefix PREFIX|reconcile --reward ID|provider:check|liquidity:check|retention:run [--dry-run]|reward:show --reference ID|reward:events --reference ID|webhook:deliveries --reference ID|webhook:retry --delivery UUID>\n",
      );
      process.exitCode = 2;
  }
} finally {
  await pool.end();
}

function value(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const result = index >= 0 ? args[index + 1] : undefined;
  if (!result) throw new Error(`${flag} is required`);
  return result;
}

function bigintJson(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function operatorRole(value: string): "viewer" | "operator" | "admin" {
  if (value === "viewer" || value === "operator" || value === "admin") return value;
  throw new Error("--role must be viewer, operator, or admin");
}

function scopesForRole(role: "viewer" | "operator" | "admin"): string[] {
  const viewer = ["operator:read"];
  const operator = [
    ...viewer,
    "operator:reconcile",
    "operator:webhook-retry",
    "operator:liquidity-check",
  ];
  return role === "viewer"
    ? viewer
    : role === "operator"
      ? operator
      : [...operator, "operator:audit-read", "operator:retention-run"];
}

function operatorKey(): { prefix: string; rawKey: string } {
  const prefix = publicId("lro");
  return { prefix, rawKey: `${prefix}.${randomSecret()}` };
}
