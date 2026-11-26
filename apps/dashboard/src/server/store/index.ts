import { getAuditLog } from "../audit";
import { isDevAuthEnabled } from "../dev-auth";
import { createMemoryAllowList, createMemorySessionStore } from "./memory";
import { getPostgresStores } from "./pg-singleton";
import { ALLOW_LIST_SEED, devSessionSeed } from "./seed";
import type { Stores } from "./types";

export type * from "./types";

type Holder = { __godStores?: Stores };

/**
 * THE STORE SEAM. Pages, route handlers and server actions call getStores() and never import an implementation.
 * Postgres when GOD_DATABASE_URL is set (staging, production): the allow-list starts empty and the audit log has no
 * synthetic history. Memory otherwise (dev, tests, shots), on globalThis so every route bundle sees the same stores,
 * with the fictional seed. The dev sessions are seeded only while dev sign-in is on.
 */
export function getStores(): Stores {
  const pg = getPostgresStores();
  if (pg) return pg;
  const g = globalThis as Holder;
  g.__godStores ??= {
    allowList: createMemoryAllowList({ seed: ALLOW_LIST_SEED }),
    sessions: createMemorySessionStore(
      isDevAuthEnabled() ? { seed: devSessionSeed(Date.now()) } : {},
    ),
    audit: getAuditLog(),
    kind: "memory",
  };
  return g.__godStores;
}
