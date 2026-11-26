import { randomBytes } from "node:crypto";
import { sessionEndedReason } from "./limits";
import { CODE_TTL_MS, codeHash, newEnrolmentCode, normaliseCode } from "../breakglass/codes";
import type {
  AllowEntry,
  AllowListStore,
  AllowStatus,
  BreakGlassKey,
  BreakGlassStore,
  CodeCheck,
  Enquiry,
  EnquiryFilter,
  EnquiryStatus,
  EnquiryStore,
  SessionRecord,
  SessionStore,
} from "./types";

/**
 * In-memory stores for dev, tests and screenshots (the contract is ./types.ts). Every read hands out a copy, so a
 * caller cannot change the store by editing a result. `now` is injectable for tests.
 */

const SHA256_HEX = /^[0-9a-f]{64}$/;

type Clock = () => number;

export function createMemoryAllowList(
  opts: { seed?: readonly AllowEntry[]; now?: Clock } = {},
): AllowListStore {
  const now = opts.now ?? Date.now;
  const rows: AllowEntry[] = (opts.seed ?? []).map((e) => ({ ...e, email: e.email.toLowerCase() }));
  const copy = (e: AllowEntry | undefined): AllowEntry | null => (e ? { ...e } : null);
  const byId = (id: string) => rows.find((r) => r.id === id);

  return {
    async list() {
      return rows.map((e) => ({ ...e }));
    },
    async find(id) {
      return copy(byId(id));
    },
    async findBySub(sub) {
      if (!sub) return null;
      return copy(rows.find((r) => r.yourtalSub === sub));
    },
    async findUnboundByEmail(email) {
      const want = email.trim().toLowerCase();
      if (!want) return null;
      // A removed entry is history: it never matches again. A re-invite makes a new entry.
      return copy(
        rows.find((r) => r.yourtalSub === null && r.status !== "removed" && r.email === want),
      );
    },
    async invite(input) {
      const email = input.email.trim().toLowerCase();
      if (rows.some((r) => r.email === email && r.status !== "removed")) return null;
      const entry: AllowEntry = {
        ...input,
        id: `u-${randomBytes(6).toString("hex")}`,
        email,
        yourtalSub: null,
        status: "invited",
        invitedAt: new Date(now()).toISOString(),
        lastSignIn: null,
      };
      rows.push(entry);
      return { ...entry };
    },
    async bindSub(id, sub) {
      const e = byId(id);
      if (!e || !sub) return false;
      if (e.status === "removed" || e.status === "suspended") return false;
      if (e.yourtalSub !== null) return e.yourtalSub === sub;
      // One sub, one entry: a sub already bound elsewhere is never bound twice.
      if (rows.some((r) => r.yourtalSub === sub)) return false;
      e.yourtalSub = sub;
      e.status = "active";
      return true;
    },
    async setStatus(id, status: AllowStatus) {
      const e = byId(id);
      if (e) e.status = status;
    },
    async recordSignIn(id, at) {
      const e = byId(id);
      if (e) e.lastSignIn = at;
    },
  };
}

export function createMemorySessionStore(
  opts: { seed?: readonly (SessionRecord & { tokenHash: string })[] } = {},
): SessionStore {
  // Keyed by the token's SHA-256. The token itself never reaches this store.
  const rows = new Map<string, SessionRecord>();
  for (const s of opts.seed ?? []) {
    const { tokenHash, ...rec } = s;
    rows.set(tokenHash, { ...rec, amr: [...rec.amr] });
  }
  const copy = (r: SessionRecord): SessionRecord => ({ ...r, amr: [...r.amr] });
  const byId = (id: string) => [...rows.values()].find((r) => r.id === id);

  return {
    async create(input) {
      if (!SHA256_HEX.test(input.tokenHash))
        throw new RangeError("sessions: tokenHash must be a SHA-256 hex digest");
      if (rows.has(input.tokenHash)) throw new RangeError("sessions: duplicate token");
      const rec: SessionRecord = {
        id: `s-${randomBytes(8).toString("hex")}`,
        userId: input.userId,
        createdAt: input.createdAt,
        lastSeenAt: input.createdAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
        authTime: input.authTime,
        amr: [...input.amr],
        userAgent: input.userAgent,
        ipPrefix: input.ipPrefix,
        revokedAt: null,
        revokedBy: null,
      };
      rows.set(input.tokenHash, rec);
      return copy(rec);
    },
    async findByTokenHash(tokenHash) {
      const r = rows.get(tokenHash);
      return r ? copy(r) : null;
    },
    async touch(id, at) {
      const r = byId(id);
      if (r && Date.parse(at) > Date.parse(r.lastSeenAt)) r.lastSeenAt = at;
    },
    async updateAuth(id, authTime, amr) {
      const r = byId(id);
      if (r && r.revokedAt === null && !r.amr.includes("break-glass")) {
        r.authTime = authTime;
        r.amr = [...amr];
      }
    },
    async revoke(id, by, at) {
      const r = byId(id);
      if (r && r.revokedAt === null) {
        r.revokedAt = at;
        r.revokedBy = by;
      }
    },
    async revokeAllForUser(userId, by, at) {
      let n = 0;
      for (const r of rows.values()) {
        if (r.userId === userId && r.revokedAt === null) {
          r.revokedAt = at;
          r.revokedBy = by;
          n += 1;
        }
      }
      return n;
    },
    async listActive(at) {
      const t = Date.parse(at);
      return [...rows.values()]
        .filter((r) => sessionEndedReason(r, t) === null)
        .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
        .map(copy);
    },
  };
}

/** The memory break-glass store also makes codes, which in Postgres only the server CLI can (god_app cannot). */
export interface MemoryBreakGlassStore extends BreakGlassStore {
  /** A new enrolment code for an Owner entry; any older unused code for them stops working. Returns the code. */
  issueCode(ownerId: string): string;
}

const MAX_ACTIVE_KEYS = 2;

export function createMemoryBreakGlassStore(
  opts: { seed?: readonly BreakGlassKey[]; now?: Clock } = {},
): MemoryBreakGlassStore {
  const now = opts.now ?? Date.now;
  const keys: BreakGlassKey[] = (opts.seed ?? []).map((k) => ({ ...k, publicKey: new Uint8Array(k.publicKey) }));
  const codes = new Map<string, { ownerId: string; createdAt: number; expiresAt: number; usedAt: number | null }>();
  const copy = (k: BreakGlassKey): BreakGlassKey => ({ ...k, publicKey: new Uint8Array(k.publicKey) });
  const active = () => keys.filter((k) => k.revokedAt === null);

  return {
    async list() {
      return [...keys].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(copy);
    },
    async findActive(credentialId) {
      const k = keys.find((x) => x.credentialId === credentialId && x.revokedAt === null);
      return k ? copy(k) : null;
    },
    async create(input) {
      if (keys.some((k) => k.credentialId === input.credentialId)) return null;
      const live = active();
      if (live.length >= MAX_ACTIVE_KEYS || live.some((k) => k.ownerId === input.ownerId)) return null;
      const k: BreakGlassKey = {
        credentialId: input.credentialId,
        publicKey: new Uint8Array(input.publicKey),
        signCount: input.signCount,
        ownerId: input.ownerId,
        createdAt: new Date(now()).toISOString(),
        lastUsedAt: null,
        revokedAt: null,
      };
      keys.push(k);
      return copy(k);
    },
    async recordUse(credentialId, signCount, at) {
      const k = keys.find((x) => x.credentialId === credentialId && x.revokedAt === null);
      if (!k) return false;
      if (!(k.signCount < signCount || (signCount === 0 && k.signCount === 0))) return false;
      k.signCount = signCount;
      k.lastUsedAt = at;
      return true;
    },
    async revoke(credentialId, at) {
      const k = keys.find((x) => x.credentialId === credentialId && x.revokedAt === null);
      if (!k) return false;
      k.revokedAt = at;
      return true;
    },
    async checkCode(hash, at): Promise<CodeCheck> {
      const c = codes.get(hash);
      if (!c) return { state: "unknown" };
      if (c.usedAt !== null) return { state: "used", ownerId: c.ownerId };
      if (Date.parse(at) >= c.expiresAt) return { state: "expired", ownerId: c.ownerId };
      return { state: "ok", ownerId: c.ownerId };
    },
    async useCode(hash, ownerId, at) {
      const c = codes.get(hash);
      const t = Date.parse(at);
      if (!c || c.ownerId !== ownerId || c.usedAt !== null || t >= c.expiresAt) return false;
      c.usedAt = t;
      return true;
    },
    issueCode(ownerId) {
      const t = now();
      for (const c of codes.values()) {
        if (c.ownerId === ownerId && c.usedAt === null && c.expiresAt > t) c.expiresAt = t;
      }
      const code = newEnrolmentCode();
      codes.set(codeHash(normaliseCode(code)!), { ownerId, createdAt: t, expiresAt: t + CODE_TTL_MS, usedAt: null });
      return code;
    },
  };
}

/** Whether an enquiry passes a filter (status and text). Shared with the tests; the Postgres store does the same in SQL. */
export function enquiryMatches(e: Enquiry, f: Omit<EnquiryFilter, "limit">): boolean {
  const status = f.status ?? "all";
  if (status === "open" ? e.status === "archived" : status !== "all" && e.status !== status) return false;
  const q = (f.q ?? "").trim().toLowerCase();
  if (!q) return true;
  return [e.name, e.company, e.email, e.want].join("\n").toLowerCase().includes(q);
}

export function createMemoryEnquiryStore(
  opts: { seed?: readonly Enquiry[]; now?: Clock } = {},
): EnquiryStore {
  const now = opts.now ?? Date.now;
  const rows: Enquiry[] = (opts.seed ?? []).map((e) => ({ ...e }));
  // Newest first; a later row wins a tie on the time.
  const newestFirst = (a: Enquiry, b: Enquiry) =>
    Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || rows.indexOf(b) - rows.indexOf(a);
  const byId = (id: string) => rows.find((r) => r.id === id);

  return {
    async create(input) {
      const e: Enquiry = {
        ...input,
        id: `enq_${randomBytes(12).toString("hex")}`,
        receivedAt: new Date(now()).toISOString(),
        status: "new",
        handledBy: null,
        handledAt: null,
      };
      rows.push(e);
      return { ...e };
    },
    async list(filter = {}) {
      const out = rows.filter((e) => enquiryMatches(e, filter)).sort(newestFirst);
      return (filter.limit && filter.limit > 0 ? out.slice(0, Math.floor(filter.limit)) : out).map((e) => ({ ...e }));
    },
    async count(filter = {}) {
      return rows.filter((e) => enquiryMatches(e, filter)).length;
    },
    async find(id) {
      const e = byId(id);
      return e ? { ...e } : null;
    },
    async setStatus(id, status: EnquiryStatus, by, at) {
      const e = byId(id);
      if (!e) return null;
      e.status = status;
      e.handledBy = status === "new" ? null : by;
      e.handledAt = status === "new" ? null : at;
      return { ...e };
    },
  };
}
