import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { createMemoryAuditLog } from "../../audit";
import { resolveSession, startSession } from "../../auth/session";
import {
  createMemoryAllowList,
  createMemoryBreakGlassStore,
  createMemorySessionStore,
} from "../../store/memory";
import { ALLOW_LIST_SEED } from "../../store/seed";
import type { AllowEntry } from "../../store/types";
import { createCeremonyStore, createRateLimiter } from "../ceremonies";
import type { BreakGlassConfig } from "../config";
import type { BreakGlassAlert } from "../notify";
import type { WebAuthn } from "../webauthn";

/** Tests only. A small world of memory stores, a clock, a fake WebAuthn seam and recorded alerts. */

export const T0 = Date.parse("2026-11-27T00:00:00Z");
export const CONFIG: BreakGlassConfig = {
  rpId: "dashboard.god.gaiada.com",
  origin: "https://dashboard.god.gaiada.com",
  rpName: "GOD dashboard",
};

/** A second, fictional Owner on top of the seed, so "two keys in total" can be reached. */
export const SECOND_OWNER: AllowEntry = {
  id: "dev-owner-2",
  name: "Robin Hale",
  email: "robin.hale@example.com",
  yourtalSub: "seed-sub-dev-owner-2",
  role: "owner",
  agreementSigned: "2026-11-02",
  originalHeldBy: "GOD registered office, safe",
  status: "active",
  invitedBy: "dev-owner",
  invitedAt: "2026-11-02T10:00:00+11:00",
  lastSignIn: null,
};
export const THIRD_OWNER: AllowEntry = {
  ...SECOND_OWNER,
  id: "dev-owner-3",
  name: "Casey Ward",
  email: "casey.ward@example.com",
  yourtalSub: "seed-sub-dev-owner-3",
};

/**
 * A fake for the seam. A response is `{ id, rawId, type, response, sig, counter }`: `sig: "good"` verifies, and the
 * fake reports `counter` as the new counter (so a test can replay one). Registration: `{ id, rawId, type, response,
 * ok }`.
 */
export function fakeWebAuthn(): WebAuthn {
  let n = 0;
  return {
    async registrationOptions() {
      n += 1;
      return { challenge: `reg-${n}` } as unknown as PublicKeyCredentialCreationOptionsJSON;
    },
    async verifyRegistration({ response }) {
      const r = response as { id?: string; ok?: boolean };
      return r?.ok && r.id ? { credentialId: r.id, publicKey: new Uint8Array(77).fill(7), counter: 0 } : null;
    },
    async authenticationOptions() {
      n += 1;
      return { challenge: `auth-${n}` } as unknown as PublicKeyCredentialRequestOptionsJSON;
    },
    async verifyAuthentication({ response, key }) {
      const r = response as { sig?: string; counter?: number; id?: string };
      if (r?.sig !== "good" || r.id !== key.credentialId) return null;
      return { newCounter: r.counter ?? 0 };
    },
  };
}

export const regResponse = (id: string, ok = true) => ({
  id,
  rawId: id,
  type: "public-key",
  response: {},
  ok,
});
export const authResponse = (id: string, counter: number, sig: "good" | "bad" = "good") => ({
  id,
  rawId: id,
  type: "public-key",
  response: {},
  sig,
  counter,
});

export function world(opts: { extraOwners?: AllowEntry[] } = {}) {
  let clock = T0;
  const now = () => clock;
  const audit = createMemoryAuditLog({ now });
  const stores = {
    allowList: createMemoryAllowList({ seed: [...ALLOW_LIST_SEED, ...(opts.extraOwners ?? [])], now }),
    sessions: createMemorySessionStore(),
    audit,
    breakGlass: createMemoryBreakGlassStore({ now }),
  };
  const alerts: BreakGlassAlert[] = [];
  const ceremonies = createCeremonyStore();
  const limiter = createRateLimiter();
  return {
    stores,
    audit,
    alerts,
    ceremonies,
    limiter,
    now,
    tick: (ms: number) => (clock += ms),
    set: (t: number) => (clock = t),
    notify: (a: BreakGlassAlert) => alerts.push(a),
    /** A normal YourTal session for an allow-list entry, signed in with a passkey `ageMs` ago. */
    async yourtalSession(id = "dev-owner", ageMs = 60_000) {
      const entry = (await stores.allowList.find(id))!;
      const t = now();
      const { token, session } = await startSession(stores, {
        entry,
        authTime: new Date(t - ageMs).toISOString(),
        amr: ["hwk"],
        userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/142.0",
        ip: "203.0.113.9",
        now: t - ageMs,
      });
      return { token, session, state: await resolveSession(token, stores, t) };
    },
    async actions(action?: string) {
      return (await audit.list(action ? { action: action as never } : {})).map((e) => ({
        who: e.who,
        action: e.action,
        target: e.target,
        outcome: e.outcome,
        reason: e.reason,
      }));
    },
  };
}
