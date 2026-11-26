import { describe, expect, it } from "vitest";
import { EMERGENCY_REFUSED, freshGate } from "../auth/fresh";
import type { SessionState } from "../auth/session";
import type { Viewer } from "../types";
import { beginEnrol, finishEnrol, revokeKey, type EnrolDeps } from "./enrol";
import { CONFIG, SECOND_OWNER, THIRD_OWNER, fakeWebAuthn, regResponse, world } from "./testing/fixtures";

const OWNER: Viewer = { id: "dev-owner", displayName: "Alex Morgan", role: "owner" };
const EMERGENCY_OWNER: Viewer = { ...OWNER, breakGlass: true };
const DATA: Viewer = { id: "dev-data", displayName: "Jordan Lee", role: "data" };

type W = ReturnType<typeof world>;

/** Deps for a request from `state`: the real fresh gate over that session state (not a stub). */
function depsFor(w: W, state: SessionState, over: Partial<EnrolDeps> = {}): EnrolDeps {
  return {
    stores: w.stores,
    config: CONFIG,
    webauthn: fakeWebAuthn(),
    ceremonies: w.ceremonies,
    fresh: async () => freshGate(state, false, w.now()),
    sessionId: state.kind === "ok" ? state.session.id : null,
    now: w.now,
    notify: w.notify,
    ...over,
  };
}

async function owner(w: W, ageMs = 60_000) {
  const s = await w.yourtalSession("dev-owner", ageMs);
  return { ...s, deps: depsFor(w, s.state) };
}

describe("adding an emergency key: refusals", () => {
  it("refuses without a fresh passkey check, and says where to get one; audited", async () => {
    const w = world();
    const { deps } = await owner(w, 10 * 60_000); // last passkey 10 minutes ago
    const code = w.stores.breakGlass.issueCode("dev-owner");
    const r = await beginEnrol(OWNER, { code }, deps);
    expect(r).toMatchObject({ ok: false, freshUrl: "/auth/start?fresh=1" });
    expect(await w.actions("breakglass.refused")).toEqual([
      expect.objectContaining({ who: "dev-owner", outcome: "refused", reason: expect.stringMatching(/passkey check/) }),
    ]);
  });

  it("refuses when no fresh gate is supplied at all (a forgotten gate never lets it through)", async () => {
    const w = world();
    const { deps } = await owner(w);
    const { fresh: _fresh, ...noGate } = deps;
    void _fresh;
    expect(await beginEnrol(OWNER, { code: w.stores.breakGlass.issueCode("dev-owner") }, noGate)).toMatchObject({ ok: false });
  });

  it("refuses without a code, a malformed code, an unknown code; each audited", async () => {
    const w = world();
    const { deps } = await owner(w);
    w.stores.breakGlass.issueCode("dev-owner");
    for (const code of [undefined, "", "not a code", "AAAA-AAAA-AAAA-AAAA-AAAA"]) {
      expect(await beginEnrol(OWNER, { code }, deps)).toEqual({
        ok: false,
        error: "That code is not right. Check it and try again.",
      });
    }
    expect(await w.actions("breakglass.refused")).toHaveLength(4);
  });

  it("refuses an expired code (15 minutes, to the millisecond)", async () => {
    const w = world();
    const code = w.stores.breakGlass.issueCode("dev-owner");
    w.tick(15 * 60_000);
    const { deps } = await owner(w);
    expect(await beginEnrol(OWNER, { code }, deps)).toMatchObject({ ok: false, error: /expired/ });
    expect((await w.actions("breakglass.refused"))[0]?.reason).toMatch(/expired/);
  });

  it("a code is good just before 15 minutes", async () => {
    const w = world();
    const code = w.stores.breakGlass.issueCode("dev-owner");
    w.tick(15 * 60_000 - 1);
    const { deps } = await owner(w);
    expect(await beginEnrol(OWNER, { code }, deps)).toMatchObject({ ok: true });
  });

  it("refuses a code made for another Owner", async () => {
    const w = world({ extraOwners: [SECOND_OWNER] });
    const theirs = w.stores.breakGlass.issueCode(SECOND_OWNER.id);
    const { deps } = await owner(w);
    expect(await beginEnrol(OWNER, { code: theirs }, deps)).toMatchObject({ ok: false, error: /not right/ });
    expect((await w.actions("breakglass.refused"))[0]?.reason).toMatch(/another Owner/);
  });

  it("refuses a reused code: once a key is added, the same code is spent", async () => {
    const w = world();
    const { deps } = await owner(w);
    const code = w.stores.breakGlass.issueCode("dev-owner");
    const b = await beginEnrol(OWNER, { code }, deps);
    if (!b.ok) throw new Error(b.error);
    expect(await finishEnrol(OWNER, { ceremonyId: b.ceremonyId, response: regResponse("cred-a") }, deps)).toMatchObject({ ok: true });
    await revokeKey(OWNER, { credentialId: "cred-a" }, deps);
    expect(await beginEnrol(OWNER, { code }, deps)).toMatchObject({ ok: false, error: /been used/ });
  });

  it("an older code stops working when the lead makes a new one", async () => {
    const w = world();
    const first = w.stores.breakGlass.issueCode("dev-owner");
    w.tick(1000);
    const second = w.stores.breakGlass.issueCode("dev-owner");
    const { deps } = await owner(w);
    expect(await beginEnrol(OWNER, { code: first }, deps)).toMatchObject({ ok: false, error: /expired/ });
    expect(await beginEnrol(OWNER, { code: second }, deps)).toMatchObject({ ok: true });
  });

  it("refuses a non-Owner role, and nobody signed in", async () => {
    const w = world();
    const { deps } = await owner(w);
    expect(await beginEnrol(DATA, { code: "x" }, deps)).toEqual({ ok: false, error: "Your role cannot do this." });
    expect(await beginEnrol(null, { code: "x" }, deps)).toEqual({ ok: false, error: "Sign in required." });
  });

  it("refuses in an emergency session, even if a gate said yes; audited", async () => {
    const w = world();
    const { deps } = await owner(w);
    const code = w.stores.breakGlass.issueCode("dev-owner");
    const r = await beginEnrol(EMERGENCY_OWNER, { code }, { ...deps, fresh: async () => ({ ok: true }) });
    expect(r).toEqual({ ok: false, error: EMERGENCY_REFUSED });
    expect((await w.actions("breakglass.refused"))[0]?.reason).toMatch(/emergency access/);
  });

  it("refuses with dev sign-in (no config) and with no real session", async () => {
    const w = world();
    const { deps } = await owner(w);
    const code = w.stores.breakGlass.issueCode("dev-owner");
    expect(await beginEnrol(OWNER, { code }, { ...deps, config: null })).toMatchObject({ ok: false, error: /live dashboard/ });
    expect(await beginEnrol(OWNER, { code }, { ...deps, sessionId: null })).toMatchObject({ ok: false, error: /ended/ });
  });

  it("refuses a second key for the same Owner, and a third key in total", async () => {
    const w = world({ extraOwners: [SECOND_OWNER, THIRD_OWNER] });
    await w.stores.breakGlass.create({ credentialId: "k1", publicKey: new Uint8Array(77), signCount: 0, ownerId: "dev-owner" });
    const { deps } = await owner(w);
    expect(await beginEnrol(OWNER, { code: w.stores.breakGlass.issueCode("dev-owner") }, deps)).toMatchObject({
      ok: false,
      error: /already have/,
    });
    await w.stores.breakGlass.create({ credentialId: "k2", publicKey: new Uint8Array(77), signCount: 0, ownerId: SECOND_OWNER.id });
    const third = await w.yourtalSession(THIRD_OWNER.id);
    const v3: Viewer = { id: THIRD_OWNER.id, displayName: THIRD_OWNER.name, role: "owner" };
    expect(await beginEnrol(v3, { code: w.stores.breakGlass.issueCode(THIRD_OWNER.id) }, depsFor(w, third.state))).toMatchObject({
      ok: false,
      error: /Two emergency keys/,
    });
  });

  it("finish: refuses a ceremony from another session, a replayed ceremony, and a failed registration", async () => {
    const w = world();
    const a = await owner(w);
    const code = w.stores.breakGlass.issueCode("dev-owner");
    const b1 = await beginEnrol(OWNER, { code }, a.deps);
    if (!b1.ok) throw new Error(b1.error);
    // Another session of the same Owner (say a stolen cookie) cannot finish this one's ceremony.
    const other = await w.yourtalSession("dev-owner");
    expect(await finishEnrol(OWNER, { ceremonyId: b1.ceremonyId, response: regResponse("c1") }, depsFor(w, other.state))).toMatchObject({
      ok: false,
      error: /too long/,
    });
    // ...and the ceremony was taken by that attempt: it cannot be used again.
    expect(await finishEnrol(OWNER, { ceremonyId: b1.ceremonyId, response: regResponse("c1") }, a.deps)).toMatchObject({ ok: false });
    const b2 = await beginEnrol(OWNER, { code }, a.deps);
    if (!b2.ok) throw new Error(b2.error);
    expect(await finishEnrol(OWNER, { ceremonyId: b2.ceremonyId, response: regResponse("c2", false) }, a.deps)).toMatchObject({
      ok: false,
      error: /could not be checked/,
    });
    // A failed registration does not spend the code.
    const b3 = await beginEnrol(OWNER, { code }, a.deps);
    expect(b3.ok).toBe(true);
    expect((await w.actions("breakglass.refused")).length).toBe(3);
    expect(await w.stores.breakGlass.list()).toEqual([]);
  });

  it("finish: refuses after the ceremony's 2 minutes", async () => {
    const w = world();
    const a = await owner(w);
    const b = await beginEnrol(OWNER, { code: w.stores.breakGlass.issueCode("dev-owner") }, a.deps);
    if (!b.ok) throw new Error(b.error);
    w.tick(120_000);
    expect(await finishEnrol(OWNER, { ceremonyId: b.ceremonyId, response: regResponse("c1") }, a.deps)).toMatchObject({ ok: false });
  });

  it("finish: refuses when the fresh check lapsed during the ceremony, or in an emergency session", async () => {
    const w = world();
    const a = await owner(w, 4 * 60_000 + 50_000); // 10 seconds of fresh left
    const b = await beginEnrol(OWNER, { code: w.stores.breakGlass.issueCode("dev-owner") }, a.deps);
    if (!b.ok) throw new Error(b.error);
    w.tick(20_000);
    expect(await finishEnrol(OWNER, { ceremonyId: b.ceremonyId, response: regResponse("c1") }, a.deps)).toMatchObject({
      ok: false,
      freshUrl: "/auth/start?fresh=1",
    });
    expect(
      await finishEnrol(EMERGENCY_OWNER, { ceremonyId: b.ceremonyId, response: regResponse("c1") }, { ...a.deps, fresh: async () => ({ ok: true }) }),
    ).toEqual({ ok: false, error: EMERGENCY_REFUSED });
  });
});

describe("adding an emergency key: success", () => {
  it("stores only the key, spends the code, writes breakglass.enrol and alerts", async () => {
    const w = world();
    const { deps } = await owner(w);
    const code = w.stores.breakGlass.issueCode("dev-owner");
    const b = await beginEnrol(OWNER, { code: code.toLowerCase().replace(/-/g, " ") }, deps);
    if (!b.ok) throw new Error(b.error);
    expect(b.options.challenge).toBe("reg-1");
    const f = await finishEnrol(OWNER, { ceremonyId: b.ceremonyId, response: regResponse("cred-new") }, deps);
    expect(f).toEqual({ ok: true, key: "key:cred-new" });
    const [k] = await w.stores.breakGlass.list();
    expect(k).toMatchObject({ credentialId: "cred-new", ownerId: "dev-owner", signCount: 0, revokedAt: null, lastUsedAt: null });
    expect(Object.keys(k!).sort()).toEqual(["createdAt", "credentialId", "lastUsedAt", "ownerId", "publicKey", "revokedAt", "signCount"]);
    expect(await w.actions("breakglass.enrol")).toEqual([
      expect.objectContaining({ who: "dev-owner", target: "key:cred-new", outcome: "done" }),
    ]);
    expect(w.alerts).toEqual([expect.objectContaining({ event: "breakglass.enrol", ownerId: "dev-owner", key: "key:cred-new" })]);
  });
});

describe("revoking an emergency key", () => {
  async function withKey(w: W) {
    await w.stores.breakGlass.create({ credentialId: "cred-r", publicKey: new Uint8Array(77), signCount: 4, ownerId: "dev-owner" });
  }

  it("needs a fresh check, is refused in an emergency session, and audits both", async () => {
    const w = world();
    await withKey(w);
    const stale = await owner(w, 10 * 60_000);
    expect(await revokeKey(OWNER, { credentialId: "cred-r" }, stale.deps)).toMatchObject({ ok: false, freshUrl: "/auth/start?fresh=1" });
    const fresh = await owner(w);
    expect(await revokeKey(EMERGENCY_OWNER, { credentialId: "cred-r" }, { ...fresh.deps, fresh: async () => ({ ok: true }) })).toEqual({
      ok: false,
      error: EMERGENCY_REFUSED,
    });
    expect(await w.actions("breakglass.refused")).toHaveLength(2);
    expect(await w.stores.breakGlass.findActive("cred-r")).not.toBeNull();
  });

  it("revokes once, ends that Owner's emergency sessions, writes breakglass.revoke and alerts", async () => {
    const w = world();
    await withKey(w);
    const emergency = await w.stores.sessions.create({
      tokenHash: "e".repeat(64),
      userId: "dev-owner",
      createdAt: new Date(w.now()).toISOString(),
      absoluteExpiresAt: new Date(w.now() + 3_600_000).toISOString(),
      authTime: new Date(w.now()).toISOString(),
      amr: ["hwk", "break-glass"],
      userAgent: null,
      ipPrefix: null,
    });
    const { deps, session } = await owner(w);
    expect(await revokeKey(OWNER, { credentialId: "cred-r" }, deps)).toEqual({ ok: true, sessionsEnded: 1 });
    expect(await w.stores.breakGlass.findActive("cred-r")).toBeNull();
    const live = (await w.stores.sessions.listActive(new Date(w.now()).toISOString())).map((s) => s.id);
    expect(live).not.toContain(emergency.id);
    expect(live).toContain(session.id); // the normal session is untouched
    expect(await w.actions("breakglass.revoke")).toEqual([expect.objectContaining({ who: "dev-owner", target: "key:cred-r" })]);
    expect(w.alerts.map((a) => a.event)).toEqual(["breakglass.revoke"]);
    expect(await revokeKey(OWNER, { credentialId: "cred-r" }, deps)).toEqual({ ok: false, error: "That key is not active." });
  });
});
