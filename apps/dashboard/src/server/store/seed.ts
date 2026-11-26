import { createHash, randomBytes } from "node:crypto";
import { SESSION_ABSOLUTE_MS } from "./limits";
import type { AllowEntry, BreakGlassKey, SessionRecord } from "./types";

/**
 * Seeds for the in-memory stores. Fictional people on example.com (a reserved domain no mailbox exists on, so no
 * one can verify one of these addresses at YourTal). Nothing here is real. The ids match the dev roles' viewer ids
 * (src/server/viewer.ts), so the dev role switch and the allow-list agree. Active entries carry a made-up sub.
 */
export const ALLOW_LIST_SEED: readonly AllowEntry[] = [
  entry(
    "dev-owner",
    "Alex Morgan",
    "alex.morgan",
    "owner",
    undefined,
    "2026-11-02",
    "GOD registered office, safe",
    "active",
    "2026-11-26T09:12:00+11:00",
  ),
  entry(
    "dev-executive",
    "Priya Nair",
    "priya.nair",
    "executive",
    undefined,
    "2026-11-09",
    "Alex Morgan",
    "active",
    "2026-11-25T16:40:00+11:00",
  ),
  entry(
    "dev-data",
    "Jordan Lee",
    "jordan.lee",
    "data",
    undefined,
    "2026-11-09",
    "Alex Morgan",
    "active",
    "2026-11-26T08:41:00+11:00",
  ),
  entry(
    "u-chen-wei",
    "Chen Wei",
    "chen.wei",
    "data",
    undefined,
    "2026-11-16",
    "Priya Nair",
    "invited",
    null,
  ),
  entry(
    "dev-bl-yourtal",
    "Sam Ortega",
    "sam.ortega",
    "brand_lead",
    "yourtal",
    "2026-11-18",
    "YourTal office, Brisbane",
    "active",
    "2026-11-24T11:03:00+11:00",
  ),
  entry(
    "dev-bl-snapapp",
    "Taylor Reid",
    "taylor.reid",
    "brand_lead",
    "snapapp",
    "2026-11-19",
    "Alex Morgan",
    "active",
    "2026-11-25T10:20:00+11:00",
  ),
  entry(
    "dev-bl-ftr",
    "Morgan Blake",
    "morgan.blake",
    "brand_lead",
    "ftr",
    "2026-11-19",
    "Alex Morgan",
    "active",
    "2026-11-23T14:55:00+11:00",
  ),
];

function entry(
  id: string,
  name: string,
  local: string,
  role: AllowEntry["role"],
  brand: AllowEntry["brand"],
  agreementSigned: string,
  originalHeldBy: string,
  status: AllowEntry["status"],
  lastSignIn: string | null,
): AllowEntry {
  return {
    id,
    name,
    email: `${local}@example.com`,
    yourtalSub: status === "active" ? `seed-sub-${id}` : null,
    role,
    ...(brand ? { brand } : {}),
    agreementSigned,
    originalHeldBy,
    status,
    invitedBy: "dev-owner",
    invitedAt: `${agreementSigned}T10:00:00+11:00`,
    lastSignIn,
  };
}

/**
 * Dev-only sessions so Admin has something to list. Times are relative to the clock so they are always active.
 * Each token hash is the hash of random bytes that are thrown away: no cookie can ever match one.
 */
export function devSessionSeed(nowMs: number): (SessionRecord & { tokenHash: string })[] {
  const at = (minutesAgo: number) => new Date(nowMs - minutesAgo * 60_000).toISOString();
  const make = (
    id: string,
    userId: string,
    startedMin: number,
    seenMin: number,
    userAgent: string,
    ipPrefix: string,
  ) => ({
    tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
    id,
    userId,
    createdAt: at(startedMin),
    lastSeenAt: at(seenMin),
    absoluteExpiresAt: new Date(nowMs - startedMin * 60_000 + SESSION_ABSOLUTE_MS).toISOString(),
    authTime: at(startedMin),
    amr: ["hwk"],
    userAgent,
    ipPrefix,
    revokedAt: null,
    revokedBy: null,
  });
  return [
    make(
      "s-dev-1",
      "dev-owner",
      40,
      0,
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0",
      "203.0.113.x",
    ),
    make(
      "s-dev-2",
      "dev-data",
      120,
      12,
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/142.0",
      "198.51.100.x",
    ),
    make(
      "s-dev-3",
      "dev-executive",
      300,
      20,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) Safari/605.1",
      "192.0.2.x",
    ),
    make(
      "s-dev-4",
      "dev-bl-yourtal",
      420,
      25,
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) Chrome/142.0",
      "203.0.113.x",
    ),
  ];
}

/**
 * Dev only: one revoked emergency key for the dev Owner, so Admin's Emergency access panel has a row to show and
 * still offers to add a key. Random bytes for the key: nothing can sign in with it, and it is revoked anyway.
 */
export function devBreakGlassSeed(nowMs: number): BreakGlassKey[] {
  const day = 86_400_000;
  return [
    {
      credentialId: randomBytes(32).toString("base64url"),
      publicKey: new Uint8Array(randomBytes(77)),
      signCount: 3,
      ownerId: "dev-owner",
      createdAt: new Date(nowMs - 95 * day).toISOString(),
      lastUsedAt: new Date(nowMs - 6 * day).toISOString(),
      revokedAt: new Date(nowMs - 6 * day + 3_600_000).toISOString(),
    },
  ];
}
