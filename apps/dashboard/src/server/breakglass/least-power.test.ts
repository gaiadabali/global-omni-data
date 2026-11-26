import { describe, expect, it } from "vitest";
import { featuredProfiles } from "@god/synthetic";
import { allowedInEmergency } from "../access";
import {
  handleAllowListChange,
  handleExport,
  handleInvite,
  handleOpenProfile,
  handleRevokeAllForPerson,
  handleRevokeSession,
  type Deps,
} from "../audit/handlers";
import { handleCallback } from "../auth/callback";
import { sha256Hex, newToken } from "../auth/crypto";
import { EMERGENCY_REFUSED, freshGate, isFreshAuth } from "../auth/fresh";
import { RedeemError } from "../auth/oidc";
import { resolveSession } from "../auth/session";
import { sealTransaction } from "../auth/transaction";
import { DataAccessError, getDashboardData } from "../data";
import { syntheticData } from "../data/synthetic";
import { BREAK_GLASS_AMR } from "../store/limits";
import type { Viewer } from "../types";
import { beginEnrol, revokeKey } from "./enrol";
import { emergencyOptions, emergencyVerify } from "./signin";
import { CONFIG, authResponse, fakeWebAuthn, world } from "./testing/fixtures";

/**
 * An emergency (break-glass) session may read what an Owner reads and revoke sessions, nothing more. Each refusal
 * is enforced twice on the server: the handler's emergency check (viewer.breakGlass), and the fresh passkey gate,
 * which fails closed for an emergency session whatever its times. Both are tested on their own here.
 */

type W = ReturnType<typeof world>;

/** A real emergency session, through the real sign-in handler. */
async function emergencySession(w: W) {
  await w.stores.breakGlass.create({ credentialId: "cred-1", publicKey: new Uint8Array(77), signCount: 0, ownerId: "dev-owner" });
  const deps = { stores: w.stores, config: CONFIG, webauthn: fakeWebAuthn(), ceremonies: w.ceremonies, limiter: w.limiter, now: w.now, notify: w.notify };
  const o = await emergencyOptions({ ip: "203.0.113.5" }, deps);
  if (!o.ok) throw new Error("options");
  const v = await emergencyVerify(
    { ceremonyId: o.ceremonyId, response: authResponse("cred-1", 1), ip: "203.0.113.5", userAgent: null, sessionToken: undefined },
    deps,
  );
  if (!v.ok) throw new Error("verify");
  const state = await resolveSession(v.token, w.stores, w.now());
  if (state.kind !== "ok") throw new Error("state");
  return { state, viewer: state.viewer, token: v.token };
}

const INVITE = {
  name: "Riley Tran",
  email: "riley.tran@example.com",
  role: "data",
  agreementSigned: "2026-11-20",
  originalHeldBy: "Alex Morgan",
};

describe("the four forbidden actions are refused in an emergency session", () => {
  const adult = featuredProfiles().adult.id;

  async function all(viewer: Viewer, deps: Deps) {
    return {
      export: await handleExport(viewer, { kind: "insight", entity: "southern" }, deps),
      exportTeens: await handleExport(viewer, { kind: "teens", entity: "kidzone" }, deps),
      person: await handleOpenProfile(viewer, { id: adult, reasonId: "geocoding", note: "Checking a geocode result" }, deps),
      invite: await handleInvite(viewer, INVITE, deps),
      change: await handleAllowListChange(viewer, { id: "dev-data", change: "suspend" }, deps),
    };
  }

  it("by the emergency check, even when a fresh gate says yes; each refusal is audited", async () => {
    const w = world();
    const { viewer } = await emergencySession(w);
    expect(viewer.breakGlass).toBe(true);
    const deps: Deps = { audit: w.audit, stores: w.stores, source: syntheticData, fresh: async () => ({ ok: true }) };
    const out = await all(viewer, deps);
    for (const r of Object.values(out)) expect(r).toEqual({ ok: false, error: EMERGENCY_REFUSED });
    const refused = await w.actions("breakglass.refused");
    expect(refused.map((e) => e.target).sort()).toEqual(
      ["allowlist.change", "allowlist.invite", "export", "export", "person.open"].sort(),
    );
    expect(refused.every((e) => e.who === "dev-owner" && e.outcome === "refused")).toBe(true);
    // Nothing happened: no export or open event, nobody invited or suspended.
    expect(await w.actions("export.pdf")).toEqual([]);
    expect(await w.actions("person.open")).toEqual([]);
    expect((await w.stores.allowList.find("dev-data"))?.status).toBe("active");
    expect((await w.stores.allowList.list()).some((e) => e.email === INVITE.email)).toBe(false);
  });

  it("by the fresh gate alone: it fails closed for an emergency session, with no way to step up", async () => {
    const w = world();
    const { state } = await emergencySession(w);
    // The session was made a moment ago with a passkey: its times alone would pass.
    expect(isFreshAuth({ authTime: state.session.authTime, amr: ["hwk"] }, w.now())).toBe(true);
    expect(isFreshAuth(state.session, w.now())).toBe(false);
    expect(freshGate(state, false, w.now())).toEqual({ ok: false, error: EMERGENCY_REFUSED });
    // A viewer WITHOUT the emergency flag (as if the flag were lost) is still stopped by the gate.
    const plain: Viewer = { id: "dev-owner", displayName: "Alex Morgan", role: "owner" };
    const deps: Deps = { audit: w.audit, stores: w.stores, source: syntheticData, fresh: async () => freshGate(state, false, w.now()) };
    const out = await all(plain, deps);
    for (const r of Object.values(out)) expect(r).toMatchObject({ ok: false, error: EMERGENCY_REFUSED });
    expect(Object.values(out).some((r) => "freshUrl" in r)).toBe(false);
  });

  it("adding and revoking emergency keys: refused by both layers", async () => {
    const w = world();
    const { state, viewer } = await emergencySession(w);
    const code = w.stores.breakGlass.issueCode("dev-owner");
    const base = { stores: w.stores, config: CONFIG, webauthn: fakeWebAuthn(), ceremonies: w.ceremonies, sessionId: state.session.id, now: w.now };
    const yes = { ...base, fresh: async () => ({ ok: true }) as const };
    const gate = { ...base, fresh: async () => freshGate(state, false, w.now()) };
    const plain: Viewer = { id: "dev-owner", displayName: "Alex Morgan", role: "owner" };
    expect(await beginEnrol(viewer, { code }, yes)).toEqual({ ok: false, error: EMERGENCY_REFUSED });
    expect(await revokeKey(viewer, { credentialId: "cred-1" }, yes)).toEqual({ ok: false, error: EMERGENCY_REFUSED });
    expect(await beginEnrol(plain, { code }, gate)).toEqual({ ok: false, error: EMERGENCY_REFUSED });
    expect(await revokeKey(plain, { credentialId: "cred-1" }, gate)).toEqual({ ok: false, error: EMERGENCY_REFUSED });
    expect(await w.stores.breakGlass.findActive("cred-1")).not.toBeNull();
    expect(await w.actions("breakglass.refused")).toHaveLength(4);
  });

  it("the access table: only revoking sessions is open to an emergency session", () => {
    const e: Viewer = { id: "o", displayName: "O", role: "owner", breakGlass: true };
    const n: Viewer = { id: "o", displayName: "O", role: "owner" };
    for (const a of ["export", "person.open", "allowlist.invite", "allowlist.change", "breakglass.enrol", "breakglass.revoke"] as const) {
      expect(allowedInEmergency(e, a)).toBe(false);
      expect(allowedInEmergency(n, a)).toBe(true);
    }
    expect(allowedInEmergency(e, "session.revoke")).toBe(true);
  });
});

describe("what an emergency session may still do", () => {
  it("revoke another person's session, and sign them out everywhere; audited as usual", async () => {
    const w = world();
    const { viewer } = await emergencySession(w);
    const other = await w.yourtalSession("dev-data");
    const deps: Deps = { audit: w.audit, stores: w.stores, source: syntheticData };
    expect(await handleRevokeSession(viewer, { sessionId: other.session.id }, deps)).toMatchObject({ ok: true, ended: 1 });
    await w.yourtalSession("dev-data");
    expect(await handleRevokeAllForPerson(viewer, { personId: "dev-data" }, deps)).toMatchObject({ ok: true, ended: 1 });
    expect(await w.actions("session.revoke")).toHaveLength(2);
  });

  it("read the Owner's pages through the data layer; but no export view and no profile", async () => {
    const w = world();
    const { viewer } = await emergencySession(w);
    const d = getDashboardData(viewer, syntheticData, w.audit, w.stores);
    await expect(d.insight({ entity: "southern" })).resolves.toBeTruthy();
    await expect(d.teens({ entity: "kidzone" })).resolves.toBeTruthy();
    expect((await d.adminAllowList()).length).toBeGreaterThan(0);
    expect((await d.adminBreakGlass()).map((k) => k.label)).toEqual(["key:cred-1"]);
    await expect(d.insight({ entity: "southern", forExport: true })).rejects.toBeInstanceOf(DataAccessError);
    await expect(d.teens({ entity: "kidzone", forExport: true })).rejects.toBeInstanceOf(DataAccessError);
    const id = featuredProfiles().adult.id;
    await expect(d.personOpen(id, "Checking a geocode result")).rejects.toBeInstanceOf(DataAccessError);
    // Not even a profile the same Owner opened earlier, in a normal session, with a reason.
    await w.audit.append({ who: "dev-owner", action: "person.open", target: id, reason: "Earlier, with YourTal" });
    expect(await d.personGet(id)).toEqual({ kind: "emergency-refused", id });
    // Admin shows the session as an emergency one.
    expect((await d.adminSessions(null)).find((s) => s.emergency)?.personId).toBe("dev-owner");
  });
});

describe("an emergency session stays one", () => {
  it("a YourTal passkey check cannot lift it: the callback refuses, and the store keeps its amr", async () => {
    const w = world();
    const { state, token } = await emergencySession(w);
    const secret = "s".repeat(40);
    const txn = sealTransaction(
      { state: "st", nonce: "n", codeVerifier: "v".repeat(43), returnTo: null, freshFor: state.session.id, startedAt: w.now() - 1000 },
      secret,
    );
    const out = await handleCallback(
      {
        txnCookie: txn,
        query: new URLSearchParams({ code: "c", state: "st" }),
        sessionToken: token,
        userAgent: null,
        ip: null,
      },
      {
        stores: w.stores,
        secret,
        now: w.now,
        redeem: async (_q, expected) => {
          if (expected.nonce !== "n") throw new RedeemError("failed");
          return { sub: "seed-sub-dev-owner", amr: ["hwk"], auth_time: Math.floor(w.now() / 1000), age_band: "adult", nonce: "n" };
        },
      },
    );
    expect(out).toMatchObject({ kind: "refused" });
    await w.stores.sessions.updateAuth(state.session.id, new Date(w.now()).toISOString(), ["hwk"]);
    const again = await resolveSession(token, w.stores, w.now());
    expect(again).toMatchObject({ kind: "ok", session: { amr: [...BREAK_GLASS_AMR] }, viewer: { breakGlass: true } });
  });

  it("ends at 1 hour from its start even if a store held a longer limit", async () => {
    const w = world();
    const token = newToken();
    await w.stores.sessions.create({
      tokenHash: sha256Hex(token),
      userId: "dev-owner",
      createdAt: new Date(w.now()).toISOString(),
      absoluteExpiresAt: new Date(w.now() + 8 * 3_600_000).toISOString(),
      authTime: new Date(w.now()).toISOString(),
      amr: [...BREAK_GLASS_AMR],
      userAgent: null,
      ipPrefix: null,
    });
    // Busy: a request every 25 minutes keeps it from going idle.
    expect((await resolveSession(token, w.stores, w.now() + 25 * 60_000)).kind).toBe("ok");
    expect((await resolveSession(token, w.stores, w.now() + 50 * 60_000)).kind).toBe("ok");
    expect((await resolveSession(token, w.stores, w.now() + 3_600_000 - 1)).kind).toBe("ok");
    expect(await resolveSession(token, w.stores, w.now() + 3_600_000)).toEqual({ kind: "ended", why: "absolute" });
  });

  it("ends at once if its entry is not an Owner", async () => {
    const w = world();
    const token = newToken();
    await w.stores.sessions.create({
      tokenHash: sha256Hex(token),
      userId: "dev-data",
      createdAt: new Date(w.now()).toISOString(),
      absoluteExpiresAt: new Date(w.now() + 3_600_000).toISOString(),
      authTime: new Date(w.now()).toISOString(),
      amr: [...BREAK_GLASS_AMR],
      userAgent: null,
      ipPrefix: null,
    });
    expect(await resolveSession(token, w.stores, w.now())).toEqual({ kind: "ended", why: "not-listed" });
  });
});
