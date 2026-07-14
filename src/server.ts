import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { providerFor } from "./runtime.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const app = buildApp(pool, config, providerFor(config));

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting_down");
  await app.close();
  await pool.end();
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
await app.listen({ host: config.LIBREREWARD_HOST, port: config.LIBREREWARD_PORT });
