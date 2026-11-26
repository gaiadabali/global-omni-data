import { describe, expect, it } from "vitest";
import { createMemoryAuditLog } from "../audit";
import { createMemoryAllowList, createMemorySessionStore } from "../store/memory";
import { ALLOW_LIST_SEED } from "../store/seed";
import { handleCallback, type CallbackDeps } from "./callback";
import { sha256Hex } from "./crypto";
import { RedeemError } from "./oidc";
import { resolveSession } from "./session";
import { sealTransaction, type Transaction } from "./transaction";

const SECRET = "s".repeat(40);
const T0 = Date.parse("2026-11-26T00:00:00Z");

function world(claims: Record<string, unknown> | Error, now = T0) {
  const audit = createMemoryAuditLog();
  const stores = {
    allowList: createMemoryAllowList({ seed: ALLOW_LIST_SEED, now: () => now }),
    sessions: createMemorySessionStore(),
    audit,
  };
  let clock = now;
  const deps: CallbackDeps = {
    stores,
    secret: SECRET,
    now: () => clock,
    redeem: async (_q, expected) => {
      if (claims instanceof Error) throw claims;
      // The library checks the nonce; the fake does too, so a mismatched transaction fails like the real thing.
      if (claims.nonce !== undefined && claims.nonce !== expected.nonce)
        throw new RedeemError("failed");
      return claims;
    },
  };
  return { audit, stores, deps, tick: (ms: number) => (clock += ms) };
}

const txn = (over: Partial<Transaction> = {}): Transaction => ({
  state: "state-1",
  nonce: "nonce-1",
  codeVerifier: "v".repeat(43),
  returnTo: null,
  freshFor: null,
  startedAt: T0 - 1000,
  ...over,
});

const input = (
  t: Transaction | string | undefined = txn(),
  q: Record<string, string> = {},
  sessionToken?: string,
) => ({
  txnCookie: typeof t === "string" || t === undefined ? t : sealTransaction(t, SECRET),
  query: new URLSearchParams({
    code: "c",
    state: "state-1",
    iss: "https://yourtal.test/oidc",
    ...q,
  }),
  sessionToken,
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/142.0",
  ip: "203.0.113.77",
});

const authS = (ms: number) => Math.floor(ms / 1000);
const adult = (over: Record<string, unknown> = {}) => ({
  sub: "sub-alex",
  amr: ["hwk"],
  auth_time: authS(T0 - 2000),
  nonce: "nonce-1",
  email: "alex.morgan@example.com",
  email_verified: true,
  age_band: "adult",
  ...over,
});

/** An invited, unbound person to sign in as. */
async function withInvite(w: ReturnType<typeof world>, email = "riley.tran@example.com") {
  return (await w.stores.allowList.invite({
    name: "Riley Tran",
    email,
    role: "data",
    agreementSigned: "2026-11-20",
    originalHeldBy: "Alex Morgan",
    invitedBy: "dev-owner",
  }))!;
}

describe("the callback refuses before any session exists", () => {
  const cases: [string, Record<string, unknown> | Error, string][] = [
    ["a password-only sign-in", adult({ sub: "seed-sub-dev-owner", amr: ["pwd"] }), "password"],
    [
      "a password plus app code, still no passkey",
      adult({ sub: "seed-sub-dev-owner", amr: ["pwd", "otp", "mfa"] }),
      "password",
    ],
    ["a teen", adult({ sub: "seed-sub-dev-owner", age_band: "teen" }), "teen"],
    [
      "a missing age band (not assumed adult)",
      adult({ sub: "seed-sub-dev-owner", age_band: undefined }),
      "retry",
    ],
    [
      "someone not on the allow-list",
      adult({ sub: "sub-stranger", email: "stranger@example.com" }),
      "not-listed",
    ],
    ["a token that fails validation", new RedeemError("failed"), "retry"],
    ["YourTal being down", new RedeemError("unavailable"), "unavailable"],
    [
      "a token with no auth_time",
      adult({ sub: "seed-sub-dev-owner", auth_time: undefined }),
      "retry",
    ],
  ];
  for (const [name, claims, reason] of cases) {
    it(`refuses ${name} (${reason}), writes signin.refused with a hashed sub, and starts no session`, async () => {
      const w = world(claims);
      const out = await handleCallback(input(), w.deps);
      expect(out).toEqual({ kind: "refused", reason });
      const events = await w.audit.list();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        who: "sign-in",
        action: "signin.refused",
        outcome: "refused",
      });
      expect(events[0]?.target).toMatch(/^sub#([0-9a-f]{16}|none)$/);
      // Never the sub or the email in the log.
      expect(JSON.stringify(events)).not.toMatch(/sub-stranger|seed-sub-dev-owner|example\.com/);
      expect(await w.stores.sessions.listActive(new Date(T0).toISOString())).toEqual([]);
    });
  }

  it("refuses a suspended person, with the same not-listed answer", async () => {
    const w = world(adult({ sub: "seed-sub-dev-data" }));
    await w.stores.allowList.setStatus("dev-data", "suspended");
    expect(await handleCallback(input(), w.deps)).toEqual({
      kind: "refused",
      reason: "not-listed",
    });
  });

  it("refuses a removed person", async () => {
    const w = world(adult({ sub: "seed-sub-dev-data" }));
    await w.stores.allowList.setStatus("dev-data", "removed");
    expect(await handleCallback(input(), w.deps)).toEqual({
      kind: "refused",
      reason: "not-listed",
    });
  });

  it("maps YourTal's own teen refusal, and any other error to try again", async () => {
    const w = world(adult());
    expect(
      await handleCallback(
        input(txn(), { error: "access_denied", error_description: "teen_not_allowed" }),
        w.deps,
      ),
    ).toEqual({ kind: "refused", reason: "teen" });
    expect(
      await handleCallback(
        input(txn(), { error: "access_denied", error_description: "user_cancelled" }),
        w.deps,
      ),
    ).toEqual({ kind: "refused", reason: "retry" });
  });
});

describe("state, nonce and the transaction cookie", () => {
  it("refuses a missing cookie, a wrong state, a tampered cookie, an expired one, and one sealed under another secret", async () => {
    const w = world(adult({ sub: "seed-sub-dev-owner" }));
    const sealed = sealTransaction(txn(), SECRET);
    const flipped = `${sealed.slice(0, 20)}${sealed[20] === "A" ? "B" : "A"}${sealed.slice(21)}`;
    for (const bad of [
      input(undefined),
      input(txn(), { state: "state-other" }),
      input(txn(), { state: "" }),
      input(flipped),
      input(txn({ startedAt: T0 - 10 * 60_000 })),
      input(sealTransaction(txn(), "x".repeat(40))),
    ]) {
      expect(await handleCallback(bad, w.deps)).toEqual({ kind: "refused", reason: "retry" });
    }
    expect((await w.audit.list()).every((e) => e.action === "signin.refused")).toBe(true);
  });

  it("refuses a token whose nonce belongs to another sign-in", async () => {
    const w = world(adult({ sub: "seed-sub-dev-owner", nonce: "nonce-from-elsewhere" }));
    expect(await handleCallback(input(), w.deps)).toEqual({ kind: "refused", reason: "retry" });
  });
});

describe("binding by email happens once", () => {
  it("binds an invited entry's email to the sub at first sign-in, then matches only by sub", async () => {
    const w = world(adult({ sub: "sub-riley", email: "Riley.Tran@example.com" }));
    const invited = await withInvite(w);
    const out = await handleCallback(input(), w.deps);
    expect(out).toMatchObject({
      kind: "signed-in",
      entry: { id: invited.id, status: "active", yourtalSub: "sub-riley" },
    });
    expect((await w.stores.allowList.find(invited.id))?.yourtalSub).toBe("sub-riley");

    // A second YourTal account with the same email is refused: the entry is bound.
    const second = world(adult({ sub: "sub-riley-two", email: "riley.tran@example.com" }));
    second.stores.allowList = w.stores.allowList;
    second.deps.stores = second.stores;
    expect(await handleCallback(input(), second.deps)).toEqual({
      kind: "refused",
      reason: "not-listed",
    });
    expect((await w.stores.allowList.find(invited.id))?.yourtalSub).toBe("sub-riley");
  });

  it("never binds by an email YourTal did not verify", async () => {
    const w = world(
      adult({ sub: "sub-riley", email: "riley.tran@example.com", email_verified: false }),
    );
    await withInvite(w);
    expect(await handleCallback(input(), w.deps)).toEqual({
      kind: "refused",
      reason: "not-listed",
    });
  });

  it("an existing bound person signs in by sub, whatever email the token carries", async () => {
    const w = world(adult({ sub: "seed-sub-dev-data", email: "new.address@example.com" }));
    expect(await handleCallback(input(), w.deps)).toMatchObject({
      kind: "signed-in",
      entry: { id: "dev-data" },
    });
  });
});

describe("a successful sign-in", () => {
  it("creates a session stored by the token's hash only, and records signin.ok", async () => {
    const w = world(adult({ sub: "seed-sub-dev-owner" }));
    const out = await handleCallback(input(txn({ returnTo: "/admin" })), w.deps);
    if (out.kind !== "signed-in") throw new Error(out.kind);
    expect(out.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(out.returnTo).toBe("/admin");
    expect(out.session).toMatchObject({
      userId: "dev-owner",
      amr: ["hwk"],
      ipPrefix: "203.0.113.x",
      revokedAt: null,
    });
    expect(JSON.stringify(out.session)).not.toContain(out.token);
    expect(await w.stores.sessions.findByTokenHash(sha256Hex(out.token))).toMatchObject({
      id: out.session.id,
    });
    expect(await w.stores.sessions.findByTokenHash(out.token)).toBeNull();
    expect((await w.stores.allowList.find("dev-owner"))?.lastSignIn).toBe(
      new Date(T0).toISOString(),
    );
    expect((await w.audit.list())[0]).toMatchObject({ who: "dev-owner", action: "signin.ok" });
  });

  it("replaces the browser's previous session", async () => {
    const w = world(adult({ sub: "seed-sub-dev-owner" }));
    const first = await handleCallback(input(), w.deps);
    if (first.kind !== "signed-in") throw new Error(first.kind);
    const second = await handleCallback(input(txn(), {}, first.token), w.deps);
    expect(second.kind).toBe("signed-in");
    expect(await resolveSession(first.token, w.stores, T0)).toEqual({
      kind: "ended",
      why: "revoked",
    });
  });
});

describe("the fresh passkey check", () => {
  async function signedIn(w: ReturnType<typeof world>) {
    const out = await handleCallback(input(), w.deps);
    if (out.kind !== "signed-in") throw new Error(out.kind);
    return out;
  }

  it("updates the session's auth time when the same person signs in again with a passkey", async () => {
    const w = world(adult({ sub: "seed-sub-dev-owner" }));
    const s = await signedIn(w);
    w.tick(20 * 60_000);
    const startedAt = T0 + 20 * 60_000 - 1000;
    w.deps.redeem = async () =>
      adult({ sub: "seed-sub-dev-owner", auth_time: authS(startedAt + 500) });
    const out = await handleCallback(
      input(
        txn({ freshFor: s.session.id, startedAt, returnTo: "/insight?entity=harbour" }),
        {},
        s.token,
      ),
      w.deps,
    );
    expect(out).toEqual({ kind: "fresh-ok", returnTo: "/insight?entity=harbour" });
    const state = await resolveSession(s.token, w.stores, T0 + 20 * 60_000);
    expect(state.kind === "ok" && state.session.authTime).toBe(
      new Date(authS(startedAt + 500) * 1000).toISOString(),
    );
    expect((await w.audit.list())[0]).toMatchObject({ action: "signin.fresh", who: "dev-owner" });
  });

  it("refuses a check answered with an old sign-in, or without a passkey", async () => {
    const w = world(adult({ sub: "seed-sub-dev-owner" }));
    const s = await signedIn(w);
    w.tick(20 * 60_000);
    const t = txn({ freshFor: s.session.id, startedAt: T0 + 20 * 60_000 - 1000 });
    w.deps.redeem = async () => adult({ sub: "seed-sub-dev-owner", auth_time: authS(T0) });
    expect(await handleCallback(input(t, {}, s.token), w.deps)).toEqual({
      kind: "refused",
      reason: "retry",
    });
    w.deps.redeem = async () =>
      adult({ sub: "seed-sub-dev-owner", amr: ["pwd"], auth_time: authS(T0 + 20 * 60_000) });
    expect(await handleCallback(input(t, {}, s.token), w.deps)).toEqual({
      kind: "refused",
      reason: "password",
    });
  });

  it("ends the session when a different YourTal account answers the check", async () => {
    const w = world(adult({ sub: "seed-sub-dev-owner" }));
    const s = await signedIn(w);
    w.deps.redeem = async () => adult({ sub: "seed-sub-dev-data", auth_time: authS(T0) });
    expect(
      await handleCallback(input(txn({ freshFor: s.session.id }), {}, s.token), w.deps),
    ).toEqual({ kind: "refused", reason: "expired", endSession: true });
    expect(await resolveSession(s.token, w.stores, T0)).toEqual({ kind: "ended", why: "revoked" });
  });

  it("refuses a check for a session this browser does not hold", async () => {
    const w = world(adult({ sub: "seed-sub-dev-owner" }));
    const s = await signedIn(w);
    expect(
      await handleCallback(input(txn({ freshFor: "s-someone-else" }), {}, s.token), w.deps),
    ).toEqual({ kind: "refused", reason: "expired" });
    expect(
      await handleCallback(input(txn({ freshFor: s.session.id }), {}, undefined), w.deps),
    ).toEqual({ kind: "refused", reason: "expired" });
  });
});
