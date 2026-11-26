import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createMemoryAuditLog } from "../audit";
import { SESSION_ABSOLUTE_MS } from "../store/limits";
import { createMemoryAllowList, createMemorySessionStore } from "../store/memory";
import { ALLOW_LIST_SEED } from "../store/seed";
import { sha256Hex } from "./crypto";
import { handleSecurityEvent, type EventDeps } from "./events";

const ISSUER = "https://yourtal.test/oidc";
const CLIENT = "god-dashboard";
const T0 = Date.parse("2026-11-26T00:00:00Z");
const CT = "application/secevent+jwt";

let yt: { privateKey: CryptoKey; publicKey: CryptoKey };
let other: { privateKey: CryptoKey; publicKey: CryptoKey };
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  yt = await generateKeyPair("RS256");
  other = await generateKeyPair("RS256");
  jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(yt.publicKey)), kid: "yt-1", alg: "RS256" }],
  });
});

async function set(
  over: { payload?: Record<string, unknown>; typ?: string; kid?: string; key?: CryptoKey } = {},
): Promise<string> {
  return new SignJWT({
    jti: "jti-1",
    sub_id: { format: "iss_sub", iss: ISSUER, sub: "seed-sub-dev-data" },
    events: { "urn:yourtal:event:account-deleted": {} },
    ...over.payload,
  })
    .setProtectedHeader({ alg: "RS256", typ: over.typ ?? "secevent+jwt", kid: over.kid ?? "yt-1" })
    .setIssuer(ISSUER)
    .setAudience(CLIENT)
    .setIssuedAt(Math.floor(T0 / 1000))
    .sign(over.key ?? yt.privateKey);
}

async function world() {
  const audit = createMemoryAuditLog();
  const stores = {
    allowList: createMemoryAllowList({ seed: ALLOW_LIST_SEED }),
    sessions: createMemorySessionStore(),
    audit,
  };
  for (const name of ["a", "b"]) {
    await stores.sessions.create({
      tokenHash: sha256Hex(name),
      userId: "dev-data",
      createdAt: new Date(T0).toISOString(),
      absoluteExpiresAt: new Date(T0 + SESSION_ABSOLUTE_MS).toISOString(),
      authTime: new Date(T0).toISOString(),
      amr: ["hwk"],
      userAgent: null,
      ipPrefix: null,
    });
  }
  const deps: EventDeps = {
    issuer: ISSUER,
    clientId: CLIENT,
    getKey: jwks,
    stores,
    now: () => T0 + 60_000,
    seen: new Map(),
  };
  const active = async () =>
    (await stores.sessions.listActive(new Date(T0 + 60_000).toISOString())).length;
  return { audit, stores, deps, active };
}

describe("YourTal's signed events", () => {
  it("account-deleted ends every session of that person, once, and a retry is acknowledged", async () => {
    const w = await world();
    expect(await w.active()).toBe(2);
    expect(await handleSecurityEvent(CT, await set(), w.deps)).toEqual({ status: 202, body: null });
    expect(await w.active()).toBe(0);
    expect(await handleSecurityEvent(CT, await set(), w.deps)).toEqual({ status: 202, body: null });
    const events = await w.audit.list();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      who: "yourtal",
      action: "session.revoke",
      target: "dev-data",
    });
  });

  it("access-ended does the same; an unknown sub or event type is acknowledged and changes nothing", async () => {
    const w = await world();
    const unknownSub = await set({
      payload: { jti: "j-2", sub_id: { format: "iss_sub", iss: ISSUER, sub: "nobody" } },
    });
    expect((await handleSecurityEvent(CT, unknownSub, w.deps)).status).toBe(202);
    const adult = await set({
      payload: { jti: "j-3", events: { "urn:yourtal:event:became-adult": {} } },
    });
    expect((await handleSecurityEvent(CT, adult, w.deps)).status).toBe(202);
    expect(await w.active()).toBe(2);
    const ended = await set({
      payload: {
        jti: "j-4",
        events: { "urn:yourtal:event:access-ended": { reason: "security", erase_data: false } },
      },
    });
    expect((await handleSecurityEvent(CT, ended, w.deps)).status).toBe(202);
    expect(await w.active()).toBe(0);
  });

  const refusals: [string, () => Promise<string>, string, string?][] = [
    ["an unknown key id", () => set({ kid: "yt-9" }), "invalid_key"],
    ["a signature by another key", () => set({ key: other.privateKey }), "authentication_failed"],
    ["an ID token posing as an event (typ JWT)", () => set({ typ: "JWT" }), "invalid_request"],
    ["no sub_id", () => set({ payload: { sub_id: undefined } }), "invalid_request"],
    [
      "two events in one token",
      () =>
        set({
          payload: {
            events: {
              "urn:yourtal:event:account-deleted": {},
              "urn:yourtal:event:access-ended": {},
            },
          },
        }),
      "invalid_request",
    ],
    ["the wrong content type", () => set(), "invalid_request", "application/json"],
  ];
  for (const [name, make, err, ct] of refusals) {
    it(`refuses ${name} with 400 ${err}, and ends nothing`, async () => {
      const w = await world();
      expect(await handleSecurityEvent(ct ?? CT, await make(), w.deps)).toEqual({
        status: 400,
        body: { err },
      });
      expect(await w.active()).toBe(2);
    });
  }

  it("refuses an event for another app or from another issuer", async () => {
    const w = await world();
    const wrongAud = await new SignJWT({
      jti: "x",
      sub_id: { format: "iss_sub", iss: ISSUER, sub: "seed-sub-dev-data" },
      events: { "urn:yourtal:event:account-deleted": {} },
    })
      .setProtectedHeader({ alg: "RS256", typ: "secevent+jwt", kid: "yt-1" })
      .setIssuer(ISSUER)
      .setAudience("snapapp-staging-server")
      .setIssuedAt(Math.floor(T0 / 1000))
      .sign(yt.privateKey);
    expect(await handleSecurityEvent(CT, wrongAud, w.deps)).toEqual({
      status: 400,
      body: { err: "invalid_audience" },
    });
    expect(
      await handleSecurityEvent(CT, await set(), {
        ...w.deps,
        issuer: "https://elsewhere.test/oidc",
      }),
    ).toEqual({ status: 400, body: { err: "invalid_issuer" } });
    expect(await w.active()).toBe(2);
  });

  it("refuses an event older than 30 days or more than 5 minutes in the future", async () => {
    const w = await world();
    expect(
      (
        await handleSecurityEvent(CT, await set(), {
          ...w.deps,
          now: () => T0 + 31 * 24 * 3_600_000,
        })
      ).status,
    ).toBe(400);
    expect(
      (await handleSecurityEvent(CT, await set(), { ...w.deps, now: () => T0 - 10 * 60_000 }))
        .status,
    ).toBe(400);
  });
});
