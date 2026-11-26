import { randomBytes } from "node:crypto";
import { sessionEndedReason } from "./limits";
import type { AllowEntry, AllowListStore, AllowStatus, SessionRecord, SessionStore } from "./types";

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
      if (r && r.revokedAt === null) {
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
