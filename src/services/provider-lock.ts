import { setTimeout as delay } from "node:timers/promises";
import type pg from "pg";

const providerLockId = 837_650_022;

export async function serializedProviderCall<T>(pool: pg.Pool, work: () => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  for (;;) {
    client = await pool.connect();
    const locked = (
      await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [
        providerLockId,
      ])
    ).rows[0]?.locked;
    if (locked) break;
    client.release();
    await delay(25);
  }
  try {
    return await work();
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [providerLockId]);
    } finally {
      client.release();
    }
  }
}
