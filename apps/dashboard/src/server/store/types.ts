/**
 * THE STORE CONTRACT: where the dashboard keeps its own state (not the data it reports on).
 *
 *   AllowListStore  who may sign in, with what role, and their paper agreement
 *   SessionStore    signed-in sessions (revocable, listed in Admin)
 *   AuditLog        append-only record of sensitive actions (src/server/audit/types.ts)
 *
 * Two implementations of each: in memory (dev, tests, screenshots) and Postgres (staging, production).
 * getStores() in ./index.ts picks one: Postgres when GOD_DATABASE_URL is set, memory otherwise.
 * Pages and route handlers never import an implementation, only getStores().
 *
 * Identity comes from Sign in with YourTal. Its ID token carries a pairwise `sub` (one per person per app),
 * `email` (always verified), `name`, `age_band`, `amr` ("hwk" = passkey) and `auth_time`
 * (yourtal docs/26-sign-in-with-yourtal.md). An allow-list entry is invited by email and bound to the
 * person's `sub` at their first successful sign-in; after that only the `sub` matches.
 */
import type { AuditLog } from "../audit/types";
import type { BrandId, Role } from "../types";

export type AllowStatus = "invited" | "active" | "suspended" | "removed";

export interface AllowEntry {
  /** Stable id: the viewer id this person signs in as. */
  id: string;
  name: string;
  /** Lower-case email the invite was sent to. Matched once, at first sign-in, then the sub is used. */
  email: string;
  /** YourTal pairwise sub for this dashboard, bound at first sign-in. Null until then. */
  yourtalSub: string | null;
  role: Role;
  /** Set for a brand lead only. */
  brand?: BrandId;
  /** Date the paper confidentiality agreement was signed, "YYYY-MM-DD". Required to invite. */
  agreementSigned: string;
  /** Who holds the signed paper original. */
  originalHeldBy: string;
  status: AllowStatus;
  invitedBy: string;
  invitedAt: string;
  /** ISO time of the last successful sign-in, or null for never. */
  lastSignIn: string | null;
}

export interface AllowListStore {
  list(): Promise<AllowEntry[]>;
  find(id: string): Promise<AllowEntry | null>;
  findBySub(sub: string): Promise<AllowEntry | null>;
  /** Matches an entry that is not yet bound to a sub. */
  findUnboundByEmail(email: string): Promise<AllowEntry | null>;
  /** Refuses (returns null) when the email is already listed and not removed. */
  invite(input: Omit<AllowEntry, "id" | "yourtalSub" | "status" | "invitedAt" | "lastSignIn">): Promise<AllowEntry | null>;
  /** Binds the sub and makes the entry active. Refuses if the entry is already bound to another sub. */
  bindSub(id: string, sub: string): Promise<boolean>;
  setStatus(id: string, status: AllowStatus): Promise<void>;
  recordSignIn(id: string, at: string): Promise<void>;
}

export interface SessionRecord {
  /** Public id, shown in Admin. Never the cookie token. */
  id: string;
  /** AllowEntry.id */
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  /** createdAt + 8 hours. The idle limit (30 minutes) is checked against lastSeenAt. */
  absoluteExpiresAt: string;
  /** YourTal auth_time of the last passkey sign-in (fresh checks compare against it). */
  authTime: string;
  amr: readonly string[];
  userAgent: string | null;
  /** Coarse network hint for Admin, for example "203.0.113.x". Never the full address. */
  ipPrefix: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

export interface SessionStore {
  /** Stores a session under the SHA-256 hex of its token. The token itself is never stored. */
  create(input: {
    tokenHash: string;
    userId: string;
    createdAt: string;
    absoluteExpiresAt: string;
    authTime: string;
    amr: readonly string[];
    userAgent: string | null;
    ipPrefix: string | null;
  }): Promise<SessionRecord>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  touch(id: string, at: string): Promise<void>;
  /** After a fresh passkey check. */
  updateAuth(id: string, authTime: string, amr: readonly string[]): Promise<void>;
  revoke(id: string, by: string, at: string): Promise<void>;
  revokeAllForUser(userId: string, by: string, at: string): Promise<number>;
  /** Not revoked, not past the absolute or idle limit at `at`. */
  listActive(at: string): Promise<SessionRecord[]>;
}

export interface Stores {
  allowList: AllowListStore;
  sessions: SessionStore;
  audit: AuditLog;
  /** "memory" in dev and tests, "postgres" when GOD_DATABASE_URL is set. */
  kind: "memory" | "postgres";
}
