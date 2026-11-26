import { describe, expect, it } from "vitest";
import { sha256Hex } from "../auth/crypto";
import { resolveSession } from "../auth/session";
import { BREAK_GLASS_ABSOLUTE_MS } from "../store/limits";
import { createRateLimiter } from "./ceremonies";
import { emergencyOptions, emergencyVerify, NOT_ACCEPTED, TOO_MANY, type EmergencyDeps } from "./signin";
import { CONFIG, authResponse, fakeWebAuthn, world } from "./testing/fixtures";

type W = ReturnType<typeof world>;

function depsOf(w: W, over: Partial<EmergencyDeps> = {}): EmergencyDeps {
  return {
    stores: w.stores,
    config: CONFIG,
    webauthn: fakeWebAuthn(),
    ceremonies: w.ceremonies,
    limiter: w.limiter,
    now: w.now,
    notify: w.notify,
    ...over,
  };
}

const IP = "203.0.113.77";

async function withKey(w: W, signCount = 5, ownerId = "dev-owner") {
  await w.stores.breakGlass.create({ credentialId: "cred-1", publicKey: new Uint8Array(77), signCount, ownerId });
}

/** options then verify, as the page does. */
async function attempt(w: W, response: unknown, deps = depsOf(w), sessionToken?: string) {
  const o = await emergencyOptions({ ip: IP }, deps);
  if (!o.ok) return o;
  return emergencyVerify({ ceremonyId: o.ceremonyId, response, ip: IP, userAgent: "Mozilla/5.0 (X11; Linux) Firefox/150.0", sessionToken }, deps);
}

describe("emergency sign-in: success", () => {
  it("makes a normal session row with amr hwk + break-glass and a 1-hour limit; audits and alerts", async () => {
    const w = world();
    await withKey(w, 5);
    const r = await attempt(w, authResponse("cred-1", 6));
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.session).toMatchObject({ userId: "dev-owner", amr: ["hwk", "break-glass"], ipPrefix: "203.0.113.x" });
    expect(Date.parse(r.session.absoluteExpiresAt) - Date.parse(r.session.createdAt)).toBe(BREAK_GLASS_ABSOLUTE_MS);
    expect(await w.stores.breakGlass.findActive("cred-1")).toMatchObject({ signCount: 6, lastUsedAt: new Date(w.now()).toISOString() });
    expect(await w.actions("breakglass.signin")).toEqual([
      expect.objectContaining({ who: "dev-owner", target: `session:${r.session.id}`, outcome: "done" }),
    ]);
    expect(w.alerts).toEqual([
      expect.objectContaining({
        event: "breakglass.signin",
        ownerId: "dev-owner",
        key: "key:cred-1",
        sessionId: r.session.id,
        ipPrefix: "203.0.113.x",
        device: "Firefox on Linux",
      }),
    ]);
    const state = await resolveSession(r.token, w.stores, w.now() + 1000);
    expect(state).toMatchObject({ kind: "ok", viewer: { id: "dev-owner", role: "owner", breakGlass: true } });
  });

  it("works with an authenticator that has no counter (0 then 0)", async () => {
    const w = world();
    await withKey(w, 0);
    expect((await attempt(w, authResponse("cred-1", 0))).ok).toBe(true);
    expect((await attempt(w, authResponse("cred-1", 0))).ok).toBe(true);
  });

  it("the session ends at 1 hour, to the millisecond, however busy", async () => {
    const w = world();
    await withKey(w);
    const r = await attempt(w, authResponse("cred-1", 6));
    if (!r.ok) throw new Error("no session");
    for (let t = w.now() + 10 * 60_000; t < w.now() + BREAK_GLASS_ABSOLUTE_MS; t += 10 * 60_000) {
      expect((await resolveSession(r.token, w.stores, t)).kind).toBe("ok");
    }
    expect((await resolveSession(r.token, w.stores, w.now() + BREAK_GLASS_ABSOLUTE_MS - 1)).kind).toBe("ok");
    expect(await resolveSession(r.token, w.stores, w.now() + BREAK_GLASS_ABSOLUTE_MS)).toEqual({ kind: "ended", why: "absolute" });
  });

  it("replaces the session this browser already had", async () => {
    const w = world();
    await withKey(w);
    const before = await w.yourtalSession("dev-owner");
    const r = await attempt(w, authResponse("cred-1", 6), depsOf(w), before.token);
    expect(r.ok).toBe(true);
    expect((await w.stores.sessions.findByTokenHash(sha256Hex(before.token)))?.revokedAt).not.toBeNull();
  });
});

describe("emergency sign-in: refusals, each audited, each the same answer", () => {
  async function refused(w: W, response: unknown, reason: RegExp, deps = depsOf(w)) {
    const r = await attempt(w, response, deps);
    expect(r).toEqual({ ok: false, status: 401, error: NOT_ACCEPTED });
    const events = await w.actions("breakglass.refused");
    expect(events[0]).toMatchObject({ who: "break-glass", outcome: "refused", reason: expect.stringMatching(reason) });
    expect(w.alerts).toEqual([]);
    expect(await w.actions("breakglass.signin")).toEqual([]);
  }

  it("a revoked key", async () => {
    const w = world();
    await withKey(w);
    await w.stores.breakGlass.revoke("cred-1", new Date(w.now()).toISOString());
    await refused(w, authResponse("cred-1", 6), /Unknown or revoked/);
  });

  it("an unknown key", async () => {
    const w = world();
    await withKey(w);
    await refused(w, authResponse("cred-other", 6), /Unknown or revoked/);
  });

  it("a suspended Owner, a removed Owner", async () => {
    for (const status of ["suspended", "removed"] as const) {
      const w = world();
      await withKey(w);
      await w.stores.allowList.setStatus("dev-owner", status);
      await refused(w, authResponse("cred-1", 6), new RegExp(status));
    }
  });

  it("a key whose entry is not an Owner (held by a data-team entry)", async () => {
    const w = world();
    await w.stores.breakGlass.create({ credentialId: "cred-1", publicKey: new Uint8Array(77), signCount: 0, ownerId: "dev-data" });
    await refused(w, authResponse("cred-1", 6), /role data/);
  });

  it("a bad signature (or wrong origin, or no user verification: the library says no)", async () => {
    const w = world();
    await withKey(w);
    await refused(w, authResponse("cred-1", 6, "bad"), /signature/);
  });

  it("a counter replay: the same counter twice, or one that goes back", async () => {
    const w = world();
    await withKey(w, 5);
    await refused(w, authResponse("cred-1", 5), /counter did not move forward/);
    const w2 = world();
    await withKey(w2, 5);
    await refused(w2, authResponse("cred-1", 3), /counter did not move forward/);
  });

  it("a malformed response, and a challenge used twice or expired", async () => {
    const w = world();
    await withKey(w);
    await refused(w, { id: "cred-1" }, /Malformed/);
    const deps = depsOf(w);
    const o = await emergencyOptions({ ip: IP }, deps);
    if (!o.ok) throw new Error("no options");
    const answer = { ceremonyId: o.ceremonyId, response: authResponse("cred-1", 7), ip: IP, userAgent: null, sessionToken: undefined };
    expect((await emergencyVerify(answer, deps)).ok).toBe(true);
    expect(await emergencyVerify({ ...answer, response: authResponse("cred-1", 8) }, deps)).toMatchObject({ ok: false, status: 401 });
    const o2 = await emergencyOptions({ ip: IP }, deps);
    if (!o2.ok) throw new Error("no options");
    w.tick(120_000);
    expect(await emergencyVerify({ ...answer, ceremonyId: o2.ceremonyId, response: authResponse("cred-1", 9) }, deps)).toMatchObject({ ok: false });
    expect((await w.actions("breakglass.refused")).filter((e) => /challenge/.test(e.reason))).toHaveLength(2);
  });

  it("off with dev sign-in: 503, and nothing is written", async () => {
    const w = world();
    const deps = depsOf(w, { config: null });
    expect(await emergencyOptions({ ip: IP }, deps)).toMatchObject({ ok: false, status: 503 });
    expect(await emergencyVerify({ ceremonyId: "x", response: {}, ip: IP, userAgent: null, sessionToken: undefined }, deps)).toMatchObject({
      ok: false,
      status: 503,
    });
    expect(await w.actions()).toEqual([]);
  });
});

describe("emergency sign-in: rate limit", () => {
  it("5 attempts per network prefix per 15 minutes; the 6th is refused and audited once", async () => {
    const w = world();
    const deps = depsOf(w);
    for (let i = 0; i < 5; i++) expect((await emergencyOptions({ ip: "198.51.100.7" }, deps)).ok).toBe(true);
    for (let i = 0; i < 3; i++)
      expect(await emergencyOptions({ ip: "198.51.100.200" }, deps)).toEqual({ ok: false, status: 429, error: TOO_MANY });
    // Another network is not affected.
    expect((await emergencyOptions({ ip: "192.0.2.1" }, deps)).ok).toBe(true);
    expect(await w.actions("breakglass.refused")).toEqual([
      expect.objectContaining({ who: "break-glass", target: "ip:198.51.100.x", outcome: "refused" }),
    ]);
    // 15 minutes after the first attempt, the window has moved on.
    w.tick(15 * 60_000);
    expect((await emergencyOptions({ ip: "198.51.100.7" }, deps)).ok).toBe(true);
  });

  it("20 in total per 15 minutes from everywhere", async () => {
    const w = world();
    const deps = depsOf(w);
    for (let i = 0; i < 20; i++) expect((await emergencyOptions({ ip: `10.0.${i}.1` }, deps)).ok).toBe(true);
    expect(await emergencyOptions({ ip: "10.99.0.1" }, deps)).toMatchObject({ ok: false, status: 429 });
    expect((await w.actions("breakglass.refused"))[0]).toMatchObject({ target: "all" });
  });

  it("a right key past the limit is still refused (the limit comes first)", async () => {
    const w = world();
    await withKey(w);
    const deps = depsOf(w, { limiter: createRateLimiter({ perPrefix: 1 }) });
    expect((await attempt(w, authResponse("cred-1", 6), deps)).ok).toBe(true);
    expect(await attempt(w, authResponse("cred-1", 7), deps)).toMatchObject({ ok: false, status: 429 });
  });
});
