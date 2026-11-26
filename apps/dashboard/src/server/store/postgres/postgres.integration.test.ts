import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresStores, type PostgresStores } from "./index";

/**
 * The Postgres stores against a real Postgres 18 as the runtime role god_app (scripts/server-f/db-test.sh sets
 * GOD_TEST_DATABASE_URL, after applying the roles and migrations). Without it the file skips.
 * Rows cannot be deleted by god_app, so every test uses its own random names and ids.
 */
const URL_ = process.env.GOD_TEST_DATABASE_URL;
const rand = () => randomBytes(5).toString("hex");
const hash = () => createHash("sha256").update(randomBytes(16)).digest("hex");
const MIN = 60_000;
const at = (base: number, plusMs = 0) => new Date(base + plusMs).toISOString();

describe.skipIf(!URL_)("Postgres stores", () => {
  let s: PostgresStores;
  beforeAll(() => {
    s = createPostgresStores(URL_!);
  });
  afterAll(async () => {
    await s?.close();
  });

  const invite = (over: Partial<Parameters<PostgresStores["allowList"]["invite"]>[0]> = {}) =>
    s.allowList.invite({
      name: "Test Person", email: `${rand()}@Example.test`, role: "data", agreementSigned: "2026-11-02",
      originalHeldBy: "Safe", invitedBy: "dev-owner", ...over,
    });

  async function newUser() {
    const e = await invite();
    expect(e).not.toBeNull();
    return e!;
  }
  const newSession = (userId: string, createdAt: number, extra: { absoluteHours?: number } = {}) =>
    s.sessions.create({
      tokenHash: hash(), userId, createdAt: at(createdAt), absoluteExpiresAt: at(createdAt, (extra.absoluteHours ?? 8) * 60 * MIN),
      authTime: at(createdAt), amr: ["hwk"], userAgent: "vitest", ipPrefix: "203.0.113.x",
    });

  it("reports its kind", () => {
    expect(s.kind).toBe("postgres");
  });

  describe("allow-list", () => {
    it("invites: lower-cases the email, starts invited and unbound, date as YYYY-MM-DD, times as ISO", async () => {
      const e = await newUser();
      expect(e.email).toBe(e.email.toLowerCase());
      expect(e).toMatchObject({ status: "invited", yourtalSub: null, lastSignIn: null, agreementSigned: "2026-11-02", role: "data" });
      expect(e.invitedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
      expect("brand" in e).toBe(false);
      expect(await s.allowList.find(e.id)).toEqual(e);
      expect((await s.allowList.list()).some((x) => x.id === e.id)).toBe(true);
    });

    it("refuses an email that is listed and not removed; allows it again once removed", async () => {
      const email = `${rand()}@example.test`;
      const first = await invite({ email });
      expect(first).not.toBeNull();
      expect(await invite({ email: email.toUpperCase() })).toBeNull();
      await s.allowList.setStatus(first!.id, "suspended");
      expect(await invite({ email })).toBeNull();
      await s.allowList.setStatus(first!.id, "removed");
      const again = await invite({ email });
      expect(again).not.toBeNull();
      expect(again!.id).not.toBe(first!.id);
    });

    it("a brand lead keeps their brand; a brand lead without one is rejected by the database", async () => {
      const lead = await invite({ role: "brand_lead", brand: "snapapp" });
      expect(lead?.brand).toBe("snapapp");
      await expect(invite({ role: "brand_lead" })).rejects.toThrow();
    });

    it("findUnboundByEmail matches until bound, ignoring case and removed entries", async () => {
      const e = await newUser();
      expect((await s.allowList.findUnboundByEmail(` ${e.email.toUpperCase()} `))?.id).toBe(e.id);
      const sub = `sub-${rand()}`;
      expect(await s.allowList.bindSub(e.id, sub)).toBe(true);
      expect(await s.allowList.findUnboundByEmail(e.email)).toBeNull();
      expect((await s.allowList.findBySub(sub))?.id).toBe(e.id);
    });

    it("bindSub binds and activates, is repeatable for the same sub, and refuses another sub or a taken sub", async () => {
      const a = await newUser();
      const b = await newUser();
      const sub = `sub-${rand()}`;
      expect(await s.allowList.bindSub(a.id, sub)).toBe(true);
      expect(await s.allowList.find(a.id)).toMatchObject({ yourtalSub: sub, status: "active" });
      expect(await s.allowList.bindSub(a.id, sub)).toBe(true);
      expect(await s.allowList.bindSub(a.id, `sub-${rand()}`)).toBe(false);
      expect(await s.allowList.bindSub(b.id, sub)).toBe(false);
      expect(await s.allowList.bindSub("no-such-id", `sub-${rand()}`)).toBe(false);
      expect((await s.allowList.find(b.id))?.yourtalSub).toBeNull();
    });

    it("a suspended or removed entry is not reactivated by a bind", async () => {
      const e = await newUser();
      await s.allowList.setStatus(e.id, "suspended");
      expect(await s.allowList.bindSub(e.id, `sub-${rand()}`)).toBe(false);
      expect((await s.allowList.find(e.id))?.status).toBe("suspended");
    });

    it("records a sign-in time and changes status", async () => {
      const e = await newUser();
      const t = new Date().toISOString();
      await s.allowList.recordSignIn(e.id, t);
      await s.allowList.setStatus(e.id, "suspended");
      expect(await s.allowList.find(e.id)).toMatchObject({ lastSignIn: t, status: "suspended" });
      expect(await s.allowList.find("nobody")).toBeNull();
      expect(await s.allowList.findBySub("nobody")).toBeNull();
    });

    it("is safe against SQL in a value", async () => {
      const e = await invite({ name: "Robert'); DROP TABLE god_app.allow_list;--" });
      expect(e?.name).toContain("DROP TABLE");
      expect((await s.allowList.list()).length).toBeGreaterThan(0);
    });
  });

  describe("sessions", () => {
    it("stores a session under the token hash, and finds it by that hash only", async () => {
      const u = await newUser();
      const now = Date.now();
      const rec = await newSession(u.id, now);
      expect(rec).toMatchObject({ userId: u.id, amr: ["hwk"], userAgent: "vitest", ipPrefix: "203.0.113.x", revokedAt: null, revokedBy: null });
      expect(rec.id).toMatch(/^ses_[0-9a-f]{32}$/);
      expect(rec.createdAt).toBe(at(now));
      expect(rec.lastSeenAt).toBe(rec.createdAt);
      expect(rec.absoluteExpiresAt).toBe(at(now, 8 * 60 * MIN));
      expect(await s.sessions.findByTokenHash("f".repeat(64))).toBeNull();
    });

    it("touch moves last-seen forward and never back; updateAuth replaces the passkey proof", async () => {
      const u = await newUser();
      const now = Date.now();
      const rec = await newSession(u.id, now);
      const hashRow = async () => (await s.sessions.listActive(at(now, 5 * MIN))).find((x) => x.id === rec.id)!;
      await s.sessions.touch(rec.id, at(now, 10 * MIN));
      expect((await hashRow()).lastSeenAt).toBe(at(now, 10 * MIN));
      await s.sessions.touch(rec.id, at(now, 2 * MIN));
      expect((await hashRow()).lastSeenAt).toBe(at(now, 10 * MIN));
      await s.sessions.updateAuth(rec.id, at(now, 12 * MIN), ["hwk", "pwd"]);
      expect(await hashRow()).toMatchObject({ authTime: at(now, 12 * MIN), amr: ["hwk", "pwd"] });
    });

    it("listActive: 30-minute idle limit, 8-hour absolute limit, and revoked sessions are out", async () => {
      const u = await newUser();
      const t0 = Date.now();
      const fresh = await newSession(u.id, t0);
      const idle = await newSession(u.id, t0);
      const revoked = await newSession(u.id, t0);
      const shortLived = await newSession(u.id, t0, { absoluteHours: 1 });
      await s.sessions.touch(fresh.id, at(t0, 7 * 60 * MIN)); // kept busy all day
      await s.sessions.touch(shortLived.id, at(t0, 70 * MIN));
      await s.sessions.revoke(revoked.id, "dev-owner", at(t0, MIN));
      const ids = (when: number) => s.sessions.listActive(at(when)).then((l) => l.filter((x) => x.userId === u.id).map((x) => x.id));

      expect(await ids(t0 + 5 * MIN)).toEqual(expect.arrayContaining([fresh.id, idle.id, shortLived.id]));
      expect(await ids(t0 + 5 * MIN)).not.toContain(revoked.id);
      // 31 minutes after start: `idle` was never touched, so it has gone quiet. `fresh` is still within its touch.
      expect(await ids(t0 + 31 * MIN)).not.toContain(idle.id);
      expect(await ids(t0 + 31 * MIN)).toContain(fresh.id);
      // Past the shortLived session's own absolute limit (1 hour), even though it was touched at 70 minutes.
      expect(await ids(t0 + 71 * MIN)).not.toContain(shortLived.id);
      // 7h20 in, `fresh` was last seen at 7h00: idle for 20 minutes, still active.
      expect(await ids(t0 + (7 * 60 + 20) * MIN)).toEqual([fresh.id]);
      // At the 8-hour mark it is over, however recently it was seen.
      await s.sessions.touch(fresh.id, at(t0, 8 * 60 * MIN - MIN));
      expect(await ids(t0 + 8 * 60 * MIN + 1)).toEqual([]);
    });

    it("newest-first order", async () => {
      const u = await newUser();
      const t0 = Date.now();
      const a = await newSession(u.id, t0);
      const b = await newSession(u.id, t0);
      await s.sessions.touch(a.id, at(t0, 3 * MIN));
      await s.sessions.touch(b.id, at(t0, 6 * MIN));
      const l = (await s.sessions.listActive(at(t0, 7 * MIN))).filter((x) => x.userId === u.id).map((x) => x.id);
      expect(l).toEqual([b.id, a.id]);
    });

    it("revoke records who and when once; revokeAllForUser returns the count and skips the already revoked", async () => {
      const u = await newUser();
      const t0 = Date.now();
      const a = await newSession(u.id, t0);
      const b = await newSession(u.id, t0);
      const c = await newSession(u.id, t0);
      await s.sessions.revoke(a.id, "dev-owner", at(t0, MIN));
      await s.sessions.revoke(a.id, "someone-else", at(t0, 2 * MIN)); // second revoke changes nothing
      const rows = async () => (await s.sessions.listActive(at(t0, 3 * MIN))).filter((x) => x.userId === u.id);
      expect((await rows()).map((x) => x.id).sort()).toEqual([b.id, c.id].sort());
      expect(await s.sessions.revokeAllForUser(u.id, "dev-owner", at(t0, 4 * MIN))).toBe(2);
      expect(await s.sessions.revokeAllForUser(u.id, "dev-owner", at(t0, 5 * MIN))).toBe(0);
      expect(await rows()).toEqual([]);
    });

    it("refuses a session for a person who is not on the allow-list, and a duplicate token hash", async () => {
      const now = Date.now();
      await expect(newSession("no-such-user", now)).rejects.toThrow();
      const u = await newUser();
      const h = hash();
      const base = { userId: u.id, createdAt: at(now), absoluteExpiresAt: at(now, 60 * MIN), authTime: at(now), amr: [], userAgent: null, ipPrefix: null };
      await s.sessions.create({ ...base, tokenHash: h });
      await expect(s.sessions.create({ ...base, tokenHash: h })).rejects.toThrow();
    });
  });

  describe("audit", () => {
    it("appends with seq, id and time from the database; list is newest first", async () => {
      const who = `u-${rand()}`;
      const a = await s.audit.append({ who, action: "person.open", target: "GOD-1", reason: "support ticket" });
      const b = await s.audit.append({ who, action: "export.pdf", target: "insight", outcome: "refused" });
      expect(b.seq).toBeGreaterThan(a.seq);
      expect(a.id).toBe(`ev-${a.seq}`);
      expect(a.reason).toBe("support ticket");
      expect(b).toMatchObject({ reason: "", outcome: "refused" });
      expect(Math.abs(Date.now() - Date.parse(a.when))).toBeLessThan(60_000);
      expect((await s.audit.list({ who })).map((e) => e.seq)).toEqual([b.seq, a.seq]);
      expect(Object.isFrozen(a)).toBe(true);
    });

    it("filters by action, target, outcome, day and limit", async () => {
      const who = `u-${rand()}`;
      await s.audit.append({ who, action: "person.open", target: "GOD-9" });
      await s.audit.append({ who, action: "person.open", target: "GOD-10", outcome: "refused" });
      await s.audit.append({ who, action: "session.revoke", target: "ses_1" });
      expect(await s.audit.list({ who, action: "person.open" })).toHaveLength(2);
      expect(await s.audit.list({ who, target: "GOD-9" })).toHaveLength(1);
      expect(await s.audit.list({ who, outcome: "refused" })).toHaveLength(1);
      expect(await s.audit.list({ who, limit: 2 })).toHaveLength(2);
      const day = (offset: number) => new Date(Date.now() + 11 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
      expect(await s.audit.list({ who, from: day(0), to: day(0) })).toHaveLength(3);
      expect(await s.audit.list({ who, from: day(1) })).toHaveLength(0);
      expect(await s.audit.list({ who, to: day(-1) })).toHaveLength(0);
      expect(await s.audit.list({ who, from: "not a date" })).toHaveLength(3);
    });

    it("validates input like the memory log, and the pool user cannot rewrite history", async () => {
      await expect(s.audit.append({ who: "", action: "person.open", target: "x" })).rejects.toThrow(RangeError);
      await expect(s.audit.append({ who: "a", action: "person.open", target: " " })).rejects.toThrow(RangeError);
      expect(Object.keys(s.audit).sort()).toEqual(["append", "list"]);
    });
  });
});
