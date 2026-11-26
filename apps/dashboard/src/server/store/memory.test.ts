import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, sessionEndedReason } from "./limits";
import { createMemoryAllowList, createMemorySessionStore } from "./memory";
import { ALLOW_LIST_SEED } from "./seed";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const T0 = Date.parse("2026-11-26T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const invite = {
  name: "Riley Tran",
  email: "Riley.Tran@Example.com",
  role: "executive" as const,
  agreementSigned: "2026-11-24",
  originalHeldBy: "Alex Morgan",
  invitedBy: "dev-owner",
};

describe("memory allow-list", () => {
  it("seeds fictional people on example.com only", async () => {
    const list = await createMemoryAllowList({ seed: ALLOW_LIST_SEED }).list();
    expect(list.length).toBe(7);
    for (const e of list) expect(e.email).toMatch(/^[a-z.]+@example\.com$/);
  });

  it("invites by lower-case email, once, and refuses the same email while it is listed", async () => {
    const store = createMemoryAllowList({ now: () => T0 });
    const a = await store.invite(invite);
    expect(a).toMatchObject({ email: "riley.tran@example.com", status: "invited", yourtalSub: null, lastSignIn: null });
    expect(a?.invitedAt).toBe(iso(T0));
    expect(await store.invite({ ...invite, email: "RILEY.TRAN@example.com" })).toBeNull();
    await store.setStatus(a!.id, "removed");
    expect(await store.invite(invite)).not.toBeNull();
  });

  it("binds a sub once: by email while unbound, then only by sub", async () => {
    const store = createMemoryAllowList();
    const a = (await store.invite(invite))!;
    expect((await store.findUnboundByEmail("riley.tran@example.com"))?.id).toBe(a.id);
    expect(await store.bindSub(a.id, "sub-1")).toBe(true);
    expect((await store.find(a.id))?.status).toBe("active");
    // Bound: the email no longer matches, and another sub is refused.
    expect(await store.findUnboundByEmail("riley.tran@example.com")).toBeNull();
    expect(await store.bindSub(a.id, "sub-2")).toBe(false);
    expect(await store.bindSub(a.id, "sub-1")).toBe(true);
    expect((await store.findBySub("sub-1"))?.id).toBe(a.id);
    expect(await store.findBySub("sub-2")).toBeNull();
  });

  it("never binds one sub to two entries, nor a suspended or removed entry", async () => {
    const store = createMemoryAllowList();
    const a = (await store.invite(invite))!;
    const b = (await store.invite({ ...invite, email: "other@example.com" }))!;
    expect(await store.bindSub(a.id, "sub-1")).toBe(true);
    expect(await store.bindSub(b.id, "sub-1")).toBe(false);
    await store.setStatus(b.id, "suspended");
    expect(await store.bindSub(b.id, "sub-9")).toBe(false);
  });

  it("hands out copies", async () => {
    const store = createMemoryAllowList({ seed: ALLOW_LIST_SEED });
    const [first] = await store.list();
    first!.role = "owner";
    first!.name = "changed";
    expect((await store.find(first!.id))?.name).not.toBe("changed");
  });
});

describe("memory sessions", () => {
  const base = {
    userId: "dev-owner",
    createdAt: iso(T0),
    absoluteExpiresAt: iso(T0 + SESSION_ABSOLUTE_MS),
    authTime: iso(T0),
    amr: ["hwk"],
    userAgent: null,
    ipPrefix: null,
  };

  it("stores only a SHA-256 hex digest, never a token", async () => {
    const store = createMemorySessionStore();
    await expect(store.create({ ...base, tokenHash: "raw-token-value" })).rejects.toThrow(/SHA-256/);
    const rec = await store.create({ ...base, tokenHash: hash("t1") });
    expect(JSON.stringify(rec)).not.toContain(hash("t1"));
    expect(await store.findByTokenHash(hash("t1"))).toMatchObject({ id: rec.id });
    expect(await store.findByTokenHash("t1")).toBeNull();
  });

  it("lists only active sessions: idle and absolute limits, and revocation", async () => {
    const store = createMemorySessionStore();
    const a = await store.create({ ...base, tokenHash: hash("a") });
    const b = await store.create({ ...base, tokenHash: hash("b") });
    const c = await store.create({ ...base, tokenHash: hash("c") });
    await store.revoke(c.id, "dev-owner", iso(T0 + 1000));
    expect((await store.listActive(iso(T0 + SESSION_IDLE_MS - 1))).map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(await store.listActive(iso(T0 + SESSION_IDLE_MS))).toEqual([]);
    await store.touch(a.id, iso(T0 + 20 * 60_000));
    expect((await store.listActive(iso(T0 + SESSION_IDLE_MS + 1))).map((s) => s.id)).toEqual([a.id]);
  });

  it("revokes all of one person's sessions and counts them", async () => {
    const store = createMemorySessionStore();
    await store.create({ ...base, tokenHash: hash("a") });
    await store.create({ ...base, tokenHash: hash("b") });
    await store.create({ ...base, userId: "dev-data", tokenHash: hash("c") });
    expect(await store.revokeAllForUser("dev-owner", "dev-owner", iso(T0 + 1))).toBe(2);
    expect(await store.revokeAllForUser("dev-owner", "dev-owner", iso(T0 + 2))).toBe(0);
    expect((await store.listActive(iso(T0 + 3))).map((s) => s.userId)).toEqual(["dev-data"]);
  });

  it("updates the auth time after a fresh check, but not on a revoked session", async () => {
    const store = createMemorySessionStore();
    const a = await store.create({ ...base, tokenHash: hash("a") });
    await store.updateAuth(a.id, iso(T0 + 60_000), ["hwk", "mfa"]);
    expect(await store.findByTokenHash(hash("a"))).toMatchObject({ authTime: iso(T0 + 60_000), amr: ["hwk", "mfa"] });
    await store.revoke(a.id, "x", iso(T0 + 70_000));
    await store.updateAuth(a.id, iso(T0 + 90_000), ["hwk"]);
    expect((await store.findByTokenHash(hash("a")))?.authTime).toBe(iso(T0 + 60_000));
  });
});

describe("session limits", () => {
  const s = (over: Partial<{ lastSeenAt: string; absoluteExpiresAt: string; revokedAt: string | null }> = {}) => ({
    lastSeenAt: iso(T0),
    absoluteExpiresAt: iso(T0 + SESSION_ABSOLUTE_MS),
    revokedAt: null,
    ...over,
  });

  it("ends at exactly 30 minutes idle, not a millisecond before", () => {
    expect(sessionEndedReason(s(), T0 + SESSION_IDLE_MS - 1)).toBeNull();
    expect(sessionEndedReason(s(), T0 + SESSION_IDLE_MS)).toBe("idle");
  });

  it("ends at exactly 8 hours however active it is", () => {
    const busy = s({ lastSeenAt: iso(T0 + SESSION_ABSOLUTE_MS - 1000) });
    expect(sessionEndedReason(busy, T0 + SESSION_ABSOLUTE_MS - 1)).toBeNull();
    expect(sessionEndedReason(busy, T0 + SESSION_ABSOLUTE_MS)).toBe("absolute");
  });

  it("a revoked session has ended, and a malformed one fails closed", () => {
    expect(sessionEndedReason(s({ revokedAt: iso(T0) }), T0)).toBe("revoked");
    expect(sessionEndedReason(s({ absoluteExpiresAt: "nonsense" }), T0)).toBe("absolute");
  });
});
