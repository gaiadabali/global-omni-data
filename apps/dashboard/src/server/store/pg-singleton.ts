import { createPostgresStores, type PostgresStores } from "./postgres";

type Holder = { __godPgStores?: PostgresStores };

/**
 * The one set of Postgres stores for this process, or null when GOD_DATABASE_URL is not set (dev, tests, shots).
 * Both getStores() and getAuditLog() read it, so every audit event lands in the same table: an action recorded
 * through the audit seam and a sign-in recorded through the stores can never split between memory and Postgres.
 */
export function getPostgresStores(): PostgresStores | null {
  const url = process.env.GOD_DATABASE_URL;
  if (!url) return null;
  const g = globalThis as Holder;
  g.__godPgStores ??= createPostgresStores(url);
  return g.__godPgStores;
}
