/**
 * THE STORE CONTRACT: where the dashboard keeps its own state (not the data it reports on).
 *
 *   AllowListStore  who may sign in, with what role, and their paper agreement
 *   SessionStore    signed-in sessions (revocable, listed in Admin)
 *   AuditLog        append-only record of sensitive actions (src/server/audit/types.ts)
 *   BreakGlassStore the sealed emergency Owner keys (WebAuthn, local to the dashboard) and their one-time
 *                   enrolment codes (src/server/breakglass/)
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
  /** After a fresh passkey check. Never for an emergency session (amr has "break-glass"): that stays as it is. */
  updateAuth(id: string, authTime: string, amr: readonly string[]): Promise<void>;
  revoke(id: string, by: string, at: string): Promise<void>;
  revokeAllForUser(userId: string, by: string, at: string): Promise<number>;
  /** Not revoked, not past the absolute or idle limit at `at`. */
  listActive(at: string): Promise<SessionRecord[]>;
}

/**
 * A break-glass key: a WebAuthn credential registered with the dashboard itself, for one Owner entry, used only when
 * YourTal is down. Only what verification needs is kept: no name, no device, nothing about the person.
 */
export interface BreakGlassKey {
  /** base64url WebAuthn credential id. */
  credentialId: string;
  /** COSE public key. */
  publicKey: Uint8Array;
  signCount: number;
  /** AllowEntry.id of the Owner. */
  ownerId: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** What an enrolment code is, by its hash, at a given time. */
export type CodeCheck =
  | { state: "ok"; ownerId: string }
  | { state: "expired"; ownerId: string }
  | { state: "used"; ownerId: string }
  | { state: "unknown" };

export interface BreakGlassStore {
  /** Every key, active and revoked, newest first (Admin). */
  list(): Promise<BreakGlassKey[]>;
  /** A key that is not revoked, by credential id; null otherwise. */
  findActive(credentialId: string): Promise<BreakGlassKey | null>;
  /**
   * Stores a new key. Null (refused) when its Owner already has an active key or 2 keys are active. The Postgres
   * store also refuses a key for anyone but an active Owner, in the database.
   */
  create(input: {
    credentialId: string;
    publicKey: Uint8Array;
    signCount: number;
    ownerId: string;
  }): Promise<BreakGlassKey | null>;
  /**
   * After a verified assertion. True only for an active key whose counter moved forward (or stays 0 for an
   * authenticator with no counter). False is a replay, a cloned key or a key revoked meanwhile.
   */
  recordUse(credentialId: string, signCount: number, at: string): Promise<boolean>;
  /** True when the key was active and is now revoked. Revocation is final. */
  revoke(credentialId: string, at: string): Promise<boolean>;
  /** The state of an enrolment code by its hash. The code itself never reaches a store. */
  checkCode(codeHash: string, at: string): Promise<CodeCheck>;
  /** Uses the code, once: true only for this Owner's code, unused and unexpired at `at`. */
  useCode(codeHash: string, ownerId: string, at: string): Promise<boolean>;
}

export interface Stores {
  allowList: AllowListStore;
  sessions: SessionStore;
  audit: AuditLog;
  breakGlass: BreakGlassStore;
  /** "memory" in dev and tests, "postgres" when GOD_DATABASE_URL is set. */
  kind: "memory" | "postgres";
}
