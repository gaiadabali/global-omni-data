import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import { describe, expect, it } from "vitest";
import { freshGate } from "../auth/fresh";
import { resolveSession } from "../auth/session";
import type { Viewer } from "../types";
import { beginEnrol, finishEnrol, type EnrolDeps } from "./enrol";
import { emergencyOptions, emergencyVerify, type EmergencyDeps } from "./signin";
import { SoftAuthenticator, type SoftAssertionOverrides } from "./testing/soft-authenticator";
import { CONFIG, world } from "./testing/fixtures";
import { simpleWebAuthn } from "./webauthn";

/**
 * The real @simplewebauthn/server verification, end to end through the handlers, against a software authenticator
 * that builds every byte the way a real one does (a real P-256 key, real signatures over the real challenge).
 */

const OWNER: Viewer = { id: "dev-owner", displayName: "Alex Morgan", role: "owner" };
type W = ReturnType<typeof world>;

async function enrolDeps(w: W): Promise<EnrolDeps> {
  const s = await w.yourtalSession("dev-owner");
  return {
    stores: w.stores,
    config: CONFIG,
    webauthn: simpleWebAuthn,
    ceremonies: w.ceremonies,
    fresh: async () => freshGate(s.state, false, w.now()),
    sessionId: s.state.kind === "ok" ? s.state.session.id : null,
    now: w.now,
    notify: w.notify,
  };
}

const signinDeps = (w: W): EmergencyDeps => ({
  stores: w.stores,
  config: CONFIG,
  webauthn: simpleWebAuthn,
  ceremonies: w.ceremonies,
  limiter: w.limiter,
  now: w.now,
  notify: w.notify,
});

async function enrol(w: W, auth: SoftAuthenticator) {
  const deps = await enrolDeps(w);
  const b = await beginEnrol(OWNER, { code: w.stores.breakGlass.issueCode("dev-owner") }, deps);
  if (!b.ok) throw new Error(b.error);
  expect(b.options.rp.id).toBe(CONFIG.rpId);
  expect(b.options.authenticatorSelection).toMatchObject({ userVerification: "required", residentKey: "required" });
  return finishEnrol(OWNER, { ceremonyId: b.ceremonyId, response: auth.register(b.options) }, deps);
}

async function signIn(w: W, auth: SoftAuthenticator, over: SoftAssertionOverrides = {}, tamper?: (r: ReturnType<SoftAuthenticator["assert"]>) => unknown) {
  const deps = signinDeps(w);
  const o = await emergencyOptions({ ip: "203.0.113.5" }, deps);
  if (!o.ok) throw new Error(o.error);
  expect(o.options).toMatchObject({ rpId: CONFIG.rpId, userVerification: "required" });
  // No key is named to an anonymous visitor.
  expect(o.options.allowCredentials ?? []).toEqual([]);
  const answer = auth.assert(o.options, over);
  return emergencyVerify(
    { ceremonyId: o.ceremonyId, response: tamper ? tamper(answer) : answer, ip: "203.0.113.5", userAgent: null, sessionToken: undefined },
    deps,
  );
}

describe("real WebAuthn verification (software authenticator)", () => {
  it("enrols a key and signs in with it; the counter moves", async () => {
    const w = world();
    const auth = new SoftAuthenticator(CONFIG.rpId, CONFIG.origin);
    expect(await enrol(w, auth)).toMatchObject({ ok: true });
    const [k] = await w.stores.breakGlass.list();
    expect(k).toMatchObject({ credentialId: auth.credentialId, ownerId: "dev-owner", signCount: 0 });
    expect(k!.publicKey.byteLength).toBeGreaterThan(60);
    const s = await signIn(w, auth);
    if (!s.ok) throw new Error("refused");
    expect((await w.stores.breakGlass.findActive(auth.credentialId))?.signCount).toBe(1);
    expect(await resolveSession(s.token, w.stores, w.now())).toMatchObject({ kind: "ok", viewer: { breakGlass: true } });
    expect((await signIn(w, auth)).ok).toBe(true);
  });

  it("refuses a registration from another origin or without user verification", async () => {
    const w = world();
    const deps = await enrolDeps(w);
    const code = w.stores.breakGlass.issueCode("dev-owner");
    const elsewhere = new SoftAuthenticator(CONFIG.rpId, "https://evil.example");
    const b = await beginEnrol(OWNER, { code }, deps);
    if (!b.ok) throw new Error(b.error);
    expect(await finishEnrol(OWNER, { ceremonyId: b.ceremonyId, response: elsewhere.register(b.options) }, deps)).toMatchObject({ ok: false });
    const wrongRp = new SoftAuthenticator("god.gaiada.com", CONFIG.origin);
    const b2 = await beginEnrol(OWNER, { code }, deps);
    if (!b2.ok) throw new Error(b2.error);
    expect(
      await finishEnrol(OWNER, { ceremonyId: b2.ceremonyId, response: wrongRp.register(b2.options as PublicKeyCredentialCreationOptionsJSON) }, deps),
    ).toMatchObject({ ok: false });
    expect(await w.stores.breakGlass.list()).toEqual([]);
  });

  const refusals: [string, SoftAssertionOverrides, ((r: ReturnType<SoftAuthenticator["assert"]>) => unknown) | undefined][] = [
    ["a bad signature", {}, (r) => ({ ...r, response: { ...r.response, signature: Buffer.from("not a signature").toString("base64url") } })],
    ["another origin", { origin: "https://evil.example" }, undefined],
    ["another RP ID", { rpId: "god.gaiada.com" }, undefined],
    ["no user verification (a touch only)", { userVerified: false }, undefined],
    ["a counter replay (the same counter again)", { counter: 1 }, undefined],
    ["a counter that went back", { counter: 0 }, undefined],
  ];
  for (const [name, over, tamper] of refusals) {
    it(`refuses ${name}`, async () => {
      const w = world();
      const auth = new SoftAuthenticator(CONFIG.rpId, CONFIG.origin);
      expect((await enrol(w, auth)).ok).toBe(true);
      expect((await signIn(w, auth)).ok).toBe(true); // counter now 1
      expect(await signIn(w, auth, over, tamper)).toMatchObject({ ok: false, status: 401 });
      expect((await w.actions("breakglass.refused")).length).toBe(1);
      expect((await w.stores.breakGlass.findActive(auth.credentialId))?.signCount).toBe(1);
    });
  }

  it("refuses a key nobody enrolled, and an answer replayed on a new challenge", async () => {
    const w = world();
    const auth = new SoftAuthenticator(CONFIG.rpId, CONFIG.origin);
    expect((await enrol(w, auth)).ok).toBe(true);
    const stranger = new SoftAuthenticator(CONFIG.rpId, CONFIG.origin);
    stranger.register({ challenge: "x", user: { id: "dXNlcg", name: "u", displayName: "u" } } as unknown as PublicKeyCredentialCreationOptionsJSON);
    expect(await signIn(w, stranger)).toMatchObject({ ok: false });
    const deps = signinDeps(w);
    const o1 = await emergencyOptions({ ip: "203.0.113.5" }, deps);
    if (!o1.ok) throw new Error("o1");
    const old = auth.assert(o1.options);
    const o2 = await emergencyOptions({ ip: "203.0.113.5" }, deps);
    if (!o2.ok) throw new Error("o2");
    expect(
      await emergencyVerify({ ceremonyId: o2.ceremonyId, response: old, ip: null, userAgent: null, sessionToken: undefined }, deps),
    ).toMatchObject({ ok: false });
  });
});
