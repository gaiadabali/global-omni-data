import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import { allowedInEmergency, canAccessPage, type GuardedAction } from "../access";
import { EMERGENCY_REFUSED, FRESH_REFUSED, type FreshGate } from "../auth/fresh";
import { isBreakGlassSession } from "../store/limits";
import type { Stores } from "../store/types";
import type { Viewer } from "../types";
import type { CeremonyStore } from "./ceremonies";
import { codeHash, normaliseCode } from "./codes";
import type { BreakGlassConfig } from "./config";
import { keyLabel, notifyBreakGlass, type BreakGlassAlert } from "./notify";
import type { WebAuthn } from "./webauthn";

/**
 * Adding and revoking emergency (break-glass) keys: Admin, Emergency access. Only while YourTal works, because it
 * builds on a real session:
 *
 *   1. an Owner, signed in with YourTal, in a normal (not emergency) session;
 *   2. a fresh passkey check (YourTal, under 5 minutes; the same gate as exports);
 *   3. a one-time enrolment code the lead made on the server (node /app/db/src/cli.ts break-glass-code), for this
 *      Owner, unused and under 15 minutes old. Two people: server access plus an Owner session;
 *   4. this Owner has no active key, and fewer than 2 are active;
 *   5. the WebAuthn registration verifies (origin, RP ID, user verification), for the challenge this session started.
 * The code is used at the last step, before the key is stored. Every refusal is written to the audit log.
 * Revoking needs 1, 2 and an active key; it also ends that Owner's emergency sessions.
 */

export interface EnrolDeps {
  stores: Pick<Stores, "allowList" | "sessions" | "audit" | "breakGlass">;
  config: BreakGlassConfig | null;
  webauthn: WebAuthn;
  ceremonies: CeremonyStore;
  /** The fresh passkey gate for this request. Default: refuse. */
  fresh?: () => Promise<FreshGate>;
  /** The real session behind this request; null with dev sign-in. */
  sessionId: string | null;
  now: () => number;
  notify?: (alert: BreakGlassAlert) => void;
}

export interface Fail {
  ok: false;
  error: string;
  freshUrl?: string;
}

export const DEV_ONLY =
  "Emergency keys can only be added on the live dashboard. Dev sign-in is on here.";

/** The checks every break-glass admin action makes first, in order. Null when it may go on. */
async function guard(
  viewer: Viewer | null,
  action: Extract<GuardedAction, "breakglass.enrol" | "breakglass.revoke">,
  deps: EnrolDeps,
  refuse: (why: string) => Promise<void>,
): Promise<Fail | null> {
  if (!viewer) return { ok: false, error: "Sign in required." };
  if (!canAccessPage(viewer, "admin")) return { ok: false, error: "Your role cannot do this." };
  if (!allowedInEmergency(viewer, action)) {
    await refuse("Refused in emergency access");
    return { ok: false, error: EMERGENCY_REFUSED };
  }
  const g = await (deps.fresh ?? FRESH_REFUSED)();
  if (!g.ok) {
    await refuse("No passkey check with YourTal in the last 5 minutes");
    return { ok: false, error: g.error, ...(g.freshUrl ? { freshUrl: g.freshUrl } : {}) };
  }
  return null;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/* ---------------- add a key: begin ---------------- */

export type BeginResult =
  | { ok: true; ceremonyId: string; options: PublicKeyCredentialCreationOptionsJSON }
  | Fail;

const CODE_WRONG = "That code is not right. Check it and try again.";

export async function beginEnrol(
  viewer: Viewer | null,
  input: { code: unknown },
  deps: EnrolDeps,
): Promise<BeginResult> {
  const { stores, config } = deps;
  const at = new Date(deps.now()).toISOString();
  const refuse = async (why: string, target = viewer?.id ?? "unknown") => {
    await stores.audit.append({
      who: viewer?.id ?? "unknown",
      action: "breakglass.refused",
      target,
      reason: `Adding an emergency key refused: ${why}`,
      outcome: "refused",
    });
  };
  const denied = await guard(viewer, "breakglass.enrol", deps, refuse);
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };
  if (!config) return { ok: false, error: DEV_ONLY };
  if (!deps.sessionId) return { ok: false, error: "Your session has ended. Sign in again." };

  const normal = normaliseCode(input.code);
  if (!normal) {
    await refuse("the enrolment code is malformed");
    return { ok: false, error: CODE_WRONG };
  }
  const hash = codeHash(normal);
  const check = await stores.breakGlass.checkCode(hash, at);
  if (check.state === "unknown") {
    await refuse("no such enrolment code");
    return { ok: false, error: CODE_WRONG };
  }
  if (check.ownerId !== viewer.id) {
    await refuse(`the enrolment code was made for another Owner (${check.ownerId})`);
    return { ok: false, error: CODE_WRONG };
  }
  if (check.state === "expired") {
    await refuse("the enrolment code has expired");
    return { ok: false, error: "That code has expired. Ask for a new one." };
  }
  if (check.state === "used") {
    await refuse("the enrolment code was already used");
    return { ok: false, error: "That code has been used. Ask for a new one." };
  }

  const active = (await stores.breakGlass.list()).filter((k) => k.revokedAt === null);
  if (active.some((k) => k.ownerId === viewer.id)) {
    await refuse("this Owner already has an active emergency key");
    return { ok: false, error: "You already have an emergency key. Revoke it first." };
  }
  if (active.length >= 2) {
    await refuse("two emergency keys are already active");
    return { ok: false, error: "Two emergency keys are active already. Revoke one first." };
  }

  const options = await deps.webauthn.registrationOptions({
    rpId: config.rpId,
    rpName: config.rpName,
    exclude: active.map((k) => k.credentialId),
  });
  const ceremonyId = deps.ceremonies.put(
    {
      kind: "enrol",
      challenge: options.challenge,
      sessionId: deps.sessionId,
      ownerId: viewer.id,
      codeHash: hash,
    },
    deps.now(),
  );
  return { ok: true, ceremonyId, options };
}

/* ---------------- add a key: finish ---------------- */

export type FinishResult = { ok: true; key: string } | Fail;

export async function finishEnrol(
  viewer: Viewer | null,
  input: { ceremonyId: unknown; response: unknown },
  deps: EnrolDeps,
): Promise<FinishResult> {
  const { stores, config } = deps;
  const now = deps.now();
  const at = new Date(now).toISOString();
  const refuse = async (why: string, target = viewer?.id ?? "unknown") => {
    await stores.audit.append({
      who: viewer?.id ?? "unknown",
      action: "breakglass.refused",
      target,
      reason: `Adding an emergency key refused: ${why}`,
      outcome: "refused",
    });
  };
  const denied = await guard(viewer, "breakglass.enrol", deps, refuse);
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };
  if (!config) return { ok: false, error: DEV_ONLY };
  if (!deps.sessionId) return { ok: false, error: "Your session has ended. Sign in again." };

  // The challenge this session started for this Owner, once, under 2 minutes old.
  const c = deps.ceremonies.take(input.ceremonyId, now);
  if (!c || c.kind !== "enrol" || c.sessionId !== deps.sessionId || c.ownerId !== viewer.id || !c.codeHash) {
    await refuse("the key registration was not started in this session, took too long, or was sent twice");
    return { ok: false, error: "That took too long. Start again." };
  }
  const reg = await deps.webauthn.verifyRegistration({
    response: input.response,
    challenge: c.challenge,
    origin: config.origin,
    rpId: config.rpId,
  });
  if (!reg) {
    await refuse("the key's registration failed verification (origin, challenge or user verification)");
    return { ok: false, error: "The key could not be checked. Try again with a new code." };
  }
  // The code is spent here, once, whatever happens next.
  if (!(await stores.breakGlass.useCode(c.codeHash, viewer.id, at))) {
    await refuse("the enrolment code expired or was used meanwhile");
    return { ok: false, error: "That code has expired or been used. Ask for a new one." };
  }
  const key = await stores.breakGlass.create({
    credentialId: reg.credentialId,
    publicKey: reg.publicKey,
    signCount: reg.counter,
    ownerId: viewer.id,
  });
  const label = keyLabel(reg.credentialId);
  if (!key) {
    await refuse("another emergency key became active meanwhile, or this key is already registered", label);
    return { ok: false, error: "The key was not added: another emergency key is active. Revoke it first." };
  }
  await stores.audit.append({
    who: viewer.id,
    action: "breakglass.enrol",
    target: label,
    reason: `Emergency key added for ${viewer.displayName}, with a one-time code from the server. It signs in without YourTal, for 1 hour at most, read-only apart from revoking sessions`,
  });
  (deps.notify ?? notifyBreakGlass)({
    event: "breakglass.enrol",
    at,
    ownerId: viewer.id,
    key: label,
    by: viewer.id,
  });
  return { ok: true, key: label };
}

/* ---------------- revoke a key ---------------- */

export type RevokeKeyResult = { ok: true; sessionsEnded: number } | Fail;

export async function revokeKey(
  viewer: Viewer | null,
  input: { credentialId: unknown },
  deps: EnrolDeps,
): Promise<RevokeKeyResult> {
  const { stores } = deps;
  const now = deps.now();
  const at = new Date(now).toISOString();
  const credentialId = str(input.credentialId, 1400);
  const label = credentialId ? keyLabel(credentialId) : "unknown";
  const refuse = async (why: string) => {
    await stores.audit.append({
      who: viewer?.id ?? "unknown",
      action: "breakglass.refused",
      target: label,
      reason: `Revoking an emergency key refused: ${why}`,
      outcome: "refused",
    });
  };
  const denied = await guard(viewer, "breakglass.revoke", deps, refuse);
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };

  const key = credentialId ? await stores.breakGlass.findActive(credentialId) : null;
  if (!key || !(await stores.breakGlass.revoke(key.credentialId, at))) {
    await refuse("no such active key");
    return { ok: false, error: "That key is not active." };
  }
  // A revoked key's emergency sessions end with it.
  const live = await stores.sessions.listActive(at);
  let ended = 0;
  for (const s of live) {
    if (s.userId === key.ownerId && isBreakGlassSession(s)) {
      await stores.sessions.revoke(s.id, viewer.id, at);
      ended += 1;
    }
  }
  const owner = await stores.allowList.find(key.ownerId);
  await stores.audit.append({
    who: viewer.id,
    action: "breakglass.revoke",
    target: label,
    reason: `Emergency key of ${owner?.name ?? key.ownerId} revoked${ended ? `; ${ended} emergency ${ended === 1 ? "session" : "sessions"} ended` : ""}`,
  });
  (deps.notify ?? notifyBreakGlass)({
    event: "breakglass.revoke",
    at,
    ownerId: key.ownerId,
    key: label,
    by: viewer.id,
  });
  return { ok: true, sessionsEnded: ended };
}
