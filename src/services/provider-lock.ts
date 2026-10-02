import type pg from "pg";

const providerLockId = 837_650_022;
const lockTimeoutMs = 120_000;
const queues = new WeakMap<pg.Pool, Promise<unknown>>();

/**
 * Serializes wallet-affecting calls: an in-process queue ensures each process waits with at
 * most one pooled connection, and a PostgreSQL advisory lock serializes across processes.
 */
export function serializedProviderCall<T>(pool: pg.Pool, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(pool) ?? Promise.resolve();
  const run = previous.then(
    () => lockedCall(pool, work),
    () => lockedCall(pool, work),
  );
  queues.set(
    pool,
    run.catch(() => undefined),
  );
  return run;
}

async function lockedCall<T>(pool: pg.Pool, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('lock_timeout', $1, false)", [`${lockTimeoutMs}ms`]);
    await client.query("SELECT pg_advisory_lock($1)", [providerLockId]);
  } catch (error) {
    client.release(true);
    throw error;
  }
  try {
    return await work();
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [providerLockId]);
      await client.query("RESET lock_timeout");
      client.release();
    } catch {
      // Destroy the session so the lock cannot leak back into the pool.
      client.release(true);
    }
  }
}
