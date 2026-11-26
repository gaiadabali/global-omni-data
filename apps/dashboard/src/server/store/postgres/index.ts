import pg from "pg";
import type { Stores } from "../types";
import { createPostgresAuditLog } from "./audit";
import { createAllowListStore } from "./allow-list";
import { createSessionStore } from "./sessions";

export { IDLE_MINUTES, ABSOLUTE_HOURS } from "./sessions";

export interface PostgresStores extends Stores {
  kind: "postgres";
  /** Ends the pool. Tests and graceful shutdown only. */
  close(): Promise<void>;
}

/**
 * THE POSTGRES STORES (store/types.ts). `url` is the GOD_DATABASE_URL of the runtime role god_app (never the
 * migrator). A small pool: the dashboard has a handful of staff and every query is a primary-key or small-table
 * lookup. getStores() calls this once and keeps the result on globalThis.
 */
export function createPostgresStores(url: string): PostgresStores {
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: "god-dashboard",
  });
  // An idle client that drops (Postgres restarts) must not crash the process; the next query reconnects.
  pool.on("error", (e) => console.error(`postgres pool: idle client error: ${e.message}`));

  return {
    kind: "postgres",
    allowList: createAllowListStore(pool),
    sessions: createSessionStore(pool),
    audit: createPostgresAuditLog(pool),
    close: () => pool.end(),
  };
}
