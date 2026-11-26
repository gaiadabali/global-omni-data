import { createMemoryAuditLog } from "./memory";
import { seedAuditEvents } from "./seed";
import type { AuditLog } from "./types";

export * from "./types";
export { createMemoryAuditLog, type SeedEvent } from "./memory";

type Holder = { __godAudit?: AuditLog };

/**
 * THE AUDIT SEAM, server side. Everything that must be recorded goes through `getAuditLog().append`. In dev the
 * log is in memory and seeded with synthetic history; it lives on globalThis so every route bundle and server
 * action sees the same one. Real storage replaces `createMemoryAuditLog` here, and nothing else changes.
 */
export function getAuditLog(): AuditLog {
  const g = globalThis as Holder;
  g.__godAudit ??= createMemoryAuditLog({ seed: seedAuditEvents(Date.now()) });
  return g.__godAudit;
}
