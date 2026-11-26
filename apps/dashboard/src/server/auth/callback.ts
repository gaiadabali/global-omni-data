import type { AllowEntry, SessionRecord, Stores } from "../store/types";
import { sameString, subLabel } from "./crypto";
import { isFreshAuth, strongEnough } from "./fresh";
import { RedeemError } from "./oidc";
import type { SigninReason } from "./paths";
import { resolveSession, startSession, viewerOf } from "./session";
import { openTransaction, type Transaction } from "./transaction";

/**
 * What /auth/callback does, before any session exists, in this order:
 *   1. the transaction cookie opens (untampered, under 10 minutes) and `state` matches it;
 *   2. the code is redeemed and the ID token validated (issuer, audience, nonce, expiry, signature);
 *   3. `amr` must contain `hwk` (a passkey): otherwise "password";
 *   4. `age_band` must be "adult": a teen is refused ("teen");
 *   5. the allow-list by sub; an unbound entry is bound by email once (bindSub);
 *   6. the entry must be invited or active: otherwise "not-listed", with no hint whether the email exists.
 * Every refusal writes a `signin.refused` audit event with a keyed hash of the sub, never the sub or the email.
 * A fresh passkey check (the transaction names a session) instead updates that session's auth time, and only for
 * the same person, signed in with a passkey after the check began.
 */

export type CallbackOutcome =
  | {
      kind: "signed-in";
      token: string;
      session: SessionRecord;
      entry: AllowEntry;
      returnTo: string | null;
    }
  | { kind: "fresh-ok"; returnTo: string | null }
  | { kind: "refused"; reason: SigninReason; endSession?: boolean };

export interface CallbackDeps {
  stores: Pick<Stores, "allowList" | "sessions" | "audit">;
  secret: string;
  now: () => number;
  /** Redeems the code (openid-client); throws RedeemError. */
  redeem: (
    query: URLSearchParams,
    expected: Pick<Transaction, "state" | "nonce" | "codeVerifier">,
  ) => Promise<Record<string, unknown>>;
}

export interface CallbackInput {
  txnCookie: string | undefined;
  query: URLSearchParams;
  /** The session cookie, if the browser has one. */
  sessionToken: string | undefined;
  userAgent: string | null;
  ip: string | null;
}

/** YourTal's refusal codes (docs/26 §1.5) that map to one of our states. */
const PROVIDER_REFUSALS: Record<string, SigninReason> = {
  teen_not_allowed: "teen",
  teen_invite_required: "teen",
};

export async function handleCallback(
  input: CallbackInput,
  deps: CallbackDeps,
): Promise<CallbackOutcome> {
  const { stores, secret } = deps;
  const now = deps.now();
  const at = new Date(now).toISOString();

  const refuse = async (
    reason: SigninReason,
    why: string,
    sub?: string | null,
    endSession = false,
  ): Promise<CallbackOutcome> => {
    await stores.audit.append({
      who: "sign-in",
      action: "signin.refused",
      target: subLabel(sub, secret),
      reason: why,
      outcome: "refused",
    });
    return { kind: "refused", reason, ...(endSession ? { endSession } : {}) };
  };

  // 1. The transaction and state.
  const txn = openTransaction(input.txnCookie, secret, now);
  if (!txn) return refuse("retry", "Sign-in state missing, expired or altered");
  const state = input.query.get("state") ?? "";
  if (!state || !sameString(state, txn.state))
    return refuse("retry", "State did not match this browser's sign-in");

  const error = input.query.get("error");
  if (error) {
    const code = (input.query.get("error_description") ?? "").slice(0, 60);
    const mapped = PROVIDER_REFUSALS[code];
    return refuse(
      mapped ?? "retry",
      `YourTal refused or the person cancelled (${/^[a-z_]+$/.test(code) ? code : error.slice(0, 40)})`,
    );
  }

  // 2. Redeem and validate.
  let claims: Record<string, unknown>;
  try {
    claims = await deps.redeem(input.query, txn);
  } catch (e) {
    if (e instanceof RedeemError && e.kind === "unavailable")
      return refuse("unavailable", "YourTal could not be reached");
    return refuse("retry", "The code or ID token failed validation");
  }
  const sub =
    typeof claims.sub === "string" && claims.sub.length > 0 && claims.sub.length <= 255
      ? claims.sub
      : null;
  const amr = Array.isArray(claims.amr)
    ? claims.amr.filter((v): v is string => typeof v === "string")
    : [];
  const authTimeS =
    typeof claims.auth_time === "number" && Number.isFinite(claims.auth_time)
      ? claims.auth_time
      : null;
  if (!sub || authTimeS === null)
    return refuse("retry", "The ID token has no sub or auth_time", sub);
  const authTime = new Date(authTimeS * 1000).toISOString();

  // 3. A passkey (or, while the staging switch GOD_ALLOW_PASSWORD_SIGNIN=1 is on, a password).
  if (!strongEnough(amr))
    return refuse("password", "Signed in without a passkey (amr has no hwk)", sub);
  // 4. Adults only. Anything but "adult" is refused; a missing band is not assumed to be adult.
  if (claims.age_band === "teen") return refuse("teen", "A teen account", sub);
  if (claims.age_band !== "adult") return refuse("retry", "The ID token has no age_band", sub);

  // A fresh passkey check for an existing session.
  if (txn.freshFor) {
    const current = await resolveSession(input.sessionToken, stores, now);
    if (current.kind !== "ok" || current.session.id !== txn.freshFor)
      return refuse("expired", "Passkey check for a session that has ended", sub);
    if (current.entry.yourtalSub !== sub) {
      // Someone else's YourTal account answered this person's check: end the session.
      await stores.sessions.revoke(current.session.id, "sign-in", at);
      return refuse(
        "expired",
        "Passkey check answered by a different YourTal account; session ended",
        sub,
        true,
      );
    }
    if (!isFreshAuth({ authTime, amr }, now) || authTimeS * 1000 < txn.startedAt - 5_000) {
      return refuse("retry", "Passkey check did not include a new sign-in", sub);
    }
    await stores.sessions.updateAuth(current.session.id, authTime, amr);
    await stores.audit.append({
      who: current.entry.id,
      action: "signin.fresh",
      target: `session:${current.session.id}`,
      reason: "Passkey checked again",
    });
    return { kind: "fresh-ok", returnTo: txn.returnTo };
  }

  // 5. The allow-list: by sub, or bind an unbound entry by its email, once.
  let entry = await stores.allowList.findBySub(sub);
  if (!entry) {
    const email =
      typeof claims.email === "string" && claims.email_verified === true
        ? claims.email.trim().toLowerCase()
        : "";
    const unbound = email ? await stores.allowList.findUnboundByEmail(email) : null;
    if (
      unbound &&
      (unbound.status === "invited" || unbound.status === "active") &&
      (await stores.allowList.bindSub(unbound.id, sub))
    ) {
      entry = await stores.allowList.find(unbound.id);
    }
  }
  // 6. Invited or active only. The refusal is the same whatever the reason, so nothing hints at who is listed.
  if (!entry) return refuse("not-listed", "Not on the allow-list", sub);
  if (entry.status === "invited") {
    await stores.allowList.setStatus(entry.id, "active");
    entry = { ...entry, status: "active" };
  }
  const viewer = viewerOf(entry);
  if (!viewer) return refuse("not-listed", `Allow-list entry is ${entry.status}`, sub);

  // A sign-in replaces whatever session this browser had.
  const previous = await resolveSession(input.sessionToken, stores, now);
  if (previous.kind === "ok") await stores.sessions.revoke(previous.session.id, entry.id, at);

  const { token, session } = await startSession(stores, {
    entry,
    authTime,
    amr,
    userAgent: input.userAgent,
    ip: input.ip,
    now,
  });
  await stores.audit.append({
    who: entry.id,
    action: "signin.ok",
    target: `session:${session.id}`,
    reason: amr.includes("hwk")
      ? "Signed in with a passkey"
      : "Signed in with a password (staging switch GOD_ALLOW_PASSWORD_SIGNIN)",
  });
  return { kind: "signed-in", token, session, entry, returnTo: txn.returnTo };
}
