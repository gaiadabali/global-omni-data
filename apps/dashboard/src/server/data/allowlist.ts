/**
 * The allow-list itself lives in the store seam (src/server/store: getStores().allowList), memory in dev and tests,
 * Postgres on staging and production. This file keeps only the closed list the invite form offers.
 */

/** Who may hold the signed paper original. Listed so the invite form offers a closed set. */
export const ORIGINAL_HOLDERS = [
  "Alex Morgan",
  "Priya Nair",
  "GOD registered office, safe",
  "YourTal office, Brisbane",
] as const;
