import { getPostgresStores } from "../store/pg-singleton";
import { createMemoryAuditLog } from "./memory";
import { seedAuditEvents } from "./seed";
import type { AuditLog } from "./types";

export * from "./types";
export { createMemoryAuditLog, type SeedEvent } from "./memory";

type Holder = { __godAudit?: AuditLog };

/**
 * THE AUDIT SEAM, server side. Everything that must be recorded goes through `getAuditLog().append`. In dev the
 * log is in memory and seeded with synthetic history; it lives on globalThis so every route bundle and server
 * action sees the same one. With GOD_DATABASE_URL set it is the append-only Postgres table, the same instance
 * getStores().audit returns (store/pg-singleton.ts).
 */
export function getAuditLog(): AuditLog {
  const pg = getPostgresStores();
  if (pg) return pg.audit;
  const g = globalThis as Holder;
  g.__godAudit ??= createMemoryAuditLog({ seed: seedAuditEvents(Date.now()) });
  return g.__godAudit;
}
