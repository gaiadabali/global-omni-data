import { isBreakGlassSession } from "../store/limits";
import { passwordSignInAllowed } from "./config";
import { FRESH_START_PATH } from "./paths";
import type { SessionState } from "./session";

/**
 * Whether a YourTal sign-in is strong enough for the dashboard: a passkey (`hwk`) always; a password (`pwd`, or
 * `mfa` for password plus an authenticator code) only while the staging switch GOD_ALLOW_PASSWORD_SIGNIN=1 is on.
 */
export function strongEnough(
  amr: readonly string[],
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (amr.includes("hwk")) return true;
  return passwordSignInAllowed(env) && (amr.includes("pwd") || amr.includes("mfa"));
}

/**
 * The fresh passkey check in front of exports, opening a Person 360 profile, and allow-list changes or invites:
 * the session's last YourTal sign-in must be under 5 minutes old and done with a passkey (`amr` has `hwk`).
 * An emergency (break-glass) session never passes it, whatever its times: that is how its least power is enforced in
 * the same gates (exports, Person 360, allow-list changes, and adding or revoking emergency keys).
 * Otherwise the page sends the browser to /auth/start?fresh=1 (max_age=0), and the action can be tried again on
 * return.
 */
export const FRESH_MS = 5 * 60_000;

export function isFreshAuth(s: { authTime: string; amr: readonly string[] }, now: number): boolean {
  const t = Date.parse(s.authTime);
  // An emergency (break-glass) session never passes a fresh check: least power while YourTal is down.
  if (!Number.isFinite(t) || !strongEnough(s.amr) || isBreakGlassSession(s)) return false;
  // Not from the future beyond a minute of clock skew, and under 5 minutes old.
  return t <= now + 60_000 && now - t < FRESH_MS;
}

export type FreshGate = { ok: true } | { ok: false; error: string; freshUrl?: string };

export const FRESH_NEEDED = "Confirm with your passkey to carry on.";
export const EMERGENCY_REFUSED =
  "Not available in emergency access. Sign in with YourTal to do this once it is back.";

/**
 * Pure: the gate for a session state. Dev sign-in has no passkeys, so it passes there (dev sign-in is on only
 * with GOD_DEPLOYMENT=dev). Anything else needs a real session with a fresh passkey.
 */
export function freshGate(state: SessionState, devSignIn: boolean, now: number): FreshGate {
  if (devSignIn) return { ok: true };
  if (state.kind !== "ok") return { ok: false, error: "Your session has ended. Sign in again." };
  // Fails closed, and with no freshUrl: YourTal cannot turn an emergency session into a normal one.
  if (isBreakGlassSession(state.session)) return { ok: false, error: EMERGENCY_REFUSED };
  if (isFreshAuth(state.session, now)) return { ok: true };
  return { ok: false, error: FRESH_NEEDED, freshUrl: FRESH_START_PATH };
}

/** What a handler uses when nobody supplied a gate: refuse. A forgotten gate never lets an action through. */
export const FRESH_REFUSED: () => Promise<FreshGate> = async () => ({
  ok: false,
  error: FRESH_NEEDED,
});
