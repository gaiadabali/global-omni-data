import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { deviceLabel, ipPrefixOf, resolveSession, startSession } from "../auth/session";
import { BREAK_GLASS_ABSOLUTE_MS, BREAK_GLASS_AMR } from "../store/limits";
import type { AllowEntry, SessionRecord, Stores } from "../store/types";
import type { CeremonyStore, RateLimiter } from "./ceremonies";
import type { BreakGlassConfig } from "./config";
import { keyLabel, notifyBreakGlass, type BreakGlassAlert } from "./notify";
import { responseCredentialId, type WebAuthn } from "./webauthn";

/**
 * Emergency (break-glass) sign-in, for when YourTal is down: /auth/emergency. Nothing here talks to YourTal.
 *
 *   options  rate limit (5 per network prefix and 20 in total per 15 minutes), then a single-use challenge.
 *            allowCredentials is empty: the key is discoverable, so an anonymous visitor learns nothing about it.
 *   verify   the challenge (once, 2 minutes); the key is active; its Owner entry is still active with role owner;
 *            the signature, origin, RP ID and user verification check out; the counter moves forward. Then a
 *            normal session row with amr ["hwk", "break-glass"] and an absolute limit of 1 hour, the audit event,
 *            and notifyBreakGlass.
 * Every refusal is written to the audit log (who "break-glass") and answers the browser with the same plain
 * message, so a failed attempt never says which check it failed.
 */

export interface EmergencyDeps {
  stores: Pick<Stores, "allowList" | "sessions" | "audit" | "breakGlass">;
  config: BreakGlassConfig | null;
  webauthn: WebAuthn;
  ceremonies: CeremonyStore;
  limiter: RateLimiter;
  now: () => number;
  notify?: (alert: BreakGlassAlert) => void;
}

export const NOT_ACCEPTED = "That key was not accepted.";
export const TOO_MANY = "Too many tries. Wait 15 minutes, then try again.";
export const NOT_AVAILABLE = "Emergency sign-in is not available here.";

export type OptionsOutcome =
  | { ok: true; ceremonyId: string; options: PublicKeyCredentialRequestOptionsJSON }
  | { ok: false; status: 429 | 503; error: string };

export async function emergencyOptions(
  input: { ip: string | null },
  deps: EmergencyDeps,
): Promise<OptionsOutcome> {
  const { config } = deps;
  if (!config) return { ok: false, status: 503, error: NOT_AVAILABLE };
  const now = deps.now();
  const prefix = ipPrefixOf(input.ip) ?? "unknown";
  const rate = deps.limiter.take(prefix, now);
  if (!rate.ok) {
    if (rate.first) {
      await deps.stores.audit.append({
        who: "break-glass",
        action: "breakglass.refused",
        target: rate.scope === "global" ? "all" : `ip:${prefix}`,
        reason:
          rate.scope === "global"
            ? "Too many emergency sign-in attempts from everywhere together; refusing all for up to 15 minutes"
            : "Too many emergency sign-in attempts from this network; refusing it for up to 15 minutes",
        outcome: "refused",
      });
    }
    return { ok: false, status: 429, error: TOO_MANY };
  }
  const options = await deps.webauthn.authenticationOptions({ rpId: config.rpId });
  const ceremonyId = deps.ceremonies.put({ kind: "signin", challenge: options.challenge }, now);
  return { ok: true, ceremonyId, options };
}

export type VerifyOutcome =
  | { ok: true; token: string; session: SessionRecord; entry: AllowEntry }
  | { ok: false; status: 401 | 503; error: string };

export async function emergencyVerify(
  input: {
    ceremonyId: unknown;
    response: unknown;
    ip: string | null;
    userAgent: string | null;
    /** The session cookie this browser already has, if any: it is replaced. */
    sessionToken: string | undefined;
  },
  deps: EmergencyDeps,
): Promise<VerifyOutcome> {
  const { config, stores } = deps;
  if (!config) return { ok: false, status: 503, error: NOT_AVAILABLE };
  const now = deps.now();
  const at = new Date(now).toISOString();
  const prefix = ipPrefixOf(input.ip);

  const refuse = async (target: string, why: string): Promise<VerifyOutcome> => {
    await stores.audit.append({
      who: "break-glass",
      action: "breakglass.refused",
      target,
      reason: `${why}${prefix ? ` (from ${prefix})` : ""}`,
      outcome: "refused",
    });
    return { ok: false, status: 401, error: NOT_ACCEPTED };
  };

  // 1. The challenge: once, and only while fresh. Taken before anything else is checked.
  const ceremony = deps.ceremonies.take(input.ceremonyId, now);
  if (!ceremony || ceremony.kind !== "signin")
    return refuse(prefix ? `ip:${prefix}` : "unknown", "Emergency sign-in challenge missing, expired or used");

  // 2. A key we hold and have not revoked.
  const credentialId = responseCredentialId(input.response);
  if (!credentialId) return refuse(prefix ? `ip:${prefix}` : "unknown", "Malformed emergency key response");
  const target = keyLabel(credentialId);
  const key = await stores.breakGlass.findActive(credentialId);
  if (!key) return refuse(target, "Unknown or revoked emergency key");

  // 3. Its Owner is still an active Owner.
  const entry = await stores.allowList.find(key.ownerId);
  if (!entry || entry.status !== "active" || entry.role !== "owner")
    return refuse(target, `The key's Owner entry is ${entry ? `${entry.status}, role ${entry.role}` : "gone"}`);

  // 4. Signature, origin, RP ID, user verification, and the library's own counter check.
  const verified = await deps.webauthn.verifyAuthentication({
    response: input.response,
    challenge: ceremony.challenge,
    origin: config.origin,
    rpId: config.rpId,
    key: { credentialId, publicKey: key.publicKey, counter: key.signCount },
  });
  if (!verified)
    return refuse(target, "Emergency key signature, origin or user verification failed, or its counter went back");

  // 5. The counter moves forward in the store too, atomically: a replay or a cloned key loses here.
  if (!(await stores.breakGlass.recordUse(credentialId, verified.newCounter, at)))
    return refuse(target, "Emergency key counter did not move forward: a replay or a cloned key");

  // A sign-in replaces whatever session this browser had.
  const previous = await resolveSession(input.sessionToken, stores, now);
  if (previous.kind === "ok") await stores.sessions.revoke(previous.session.id, entry.id, at);

  const { token, session } = await startSession(stores, {
    entry,
    authTime: at,
    amr: BREAK_GLASS_AMR,
    userAgent: input.userAgent,
    ip: input.ip,
    now,
    absoluteMs: BREAK_GLASS_ABSOLUTE_MS,
  });
  await stores.audit.append({
    who: entry.id,
    action: "breakglass.signin",
    target: `session:${session.id}`,
    reason: `Signed in with the emergency key ${target}, without YourTal${prefix ? `, from ${prefix}` : ""}. The session ends within 1 hour and cannot export, open profiles or change the allow-list`,
  });
  (deps.notify ?? notifyBreakGlass)({
    event: "breakglass.signin",
    at,
    ownerId: entry.id,
    key: target,
    sessionId: session.id,
    ipPrefix: prefix,
    device: deviceLabel(input.userAgent),
  });
  return { ok: true, token, session, entry };
}
