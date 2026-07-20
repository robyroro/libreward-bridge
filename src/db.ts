import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg, { type PoolClient, type QueryResultRow } from "pg";

pg.types.setTypeParser(20, (value) => BigInt(value));

export type DbClient = Pick<PoolClient, "query">;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export async function transaction<T>(
  pool: pg.Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function one<T extends QueryResultRow>(
  client: DbClient,
  sql: string,
  values: unknown[] = [],
): Promise<T> {
  const result = await client.query<T>(sql, values);
  if (result.rowCount !== 1) throw new Error(`expected one row, got ${result.rowCount ?? 0}`);
  return result.rows[0] as T;
}

export async function migrate(pool: pg.Pool): Promise<void> {
  const directory = join(process.cwd(), "migrations");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [837_650_021]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = new Set(
      (await client.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map(
        (row) => row.version,
      ),
    );
    for (const filename of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const version = filename.replace(/\.sql$/, "");
      if (!applied.has(version))
        await client.query(await readFile(join(directory, filename), "utf8"));
    }
  } catch (error) {
    // Migration files own their transaction. Clear an aborted transaction before releasing the
    // session advisory lock so a failed migration cannot poison a pooled connection.
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original migration failure; releasing discards a broken connection.
    }
    throw error;
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [837_650_021]);
    } finally {
      client.release();
    }
  }
}
