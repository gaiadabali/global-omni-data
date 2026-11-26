import { errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Stores } from "../store/types";

/**
 * YourTal's signed events (Security Event Tokens, RFC 8417, pushed per RFC 8935; YourTal docs/26 §2.3 and §2.5).
 * `account-deleted` and `access-ended` end every dashboard session of the person with that sub. Acting is
 * idempotent (revoking twice ends nothing more), so a retried event is harmless; `jti`s seen are remembered for
 * 30 days in memory only, to answer a retry without acting again. Other event types are acknowledged and ignored.
 * The token is never logged.
 */

const DELETED = "urn:yourtal:event:account-deleted";
const ENDED = "urn:yourtal:event:access-ended";
const MAX_BODY = 16_384;
const SEEN_MS = 30 * 24 * 3_600_000;

export interface EventDeps {
  issuer: string;
  clientId: string;
  getKey: JWTVerifyGetKey;
  stores: Pick<Stores, "allowList" | "sessions" | "audit">;
  now: () => number;
  seen: Map<string, number>;
}

export interface EventAnswer {
  status: 202 | 400;
  body: Record<string, string> | null;
}

const bad = (err: string): EventAnswer => ({ status: 400, body: { err } });

export async function handleSecurityEvent(contentType: string | null, body: string, deps: EventDeps): Promise<EventAnswer> {
  if (!(contentType ?? "").toLowerCase().startsWith("application/secevent+jwt")) return bad("invalid_request");
  const token = body.trim();
  if (!token || token.length > MAX_BODY) return bad("invalid_request");

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, deps.getKey, {
      issuer: deps.issuer,
      audience: deps.clientId,
      typ: "secevent+jwt",
      algorithms: ["RS256"],
      // iat at most 5 minutes ahead, at most 30 days old.
      maxTokenAge: "30d",
      clockTolerance: 300,
      currentDate: new Date(deps.now()),
    }));
  } catch (e) {
    if (e instanceof errors.JWKSNoMatchingKey) return bad("invalid_key");
    if (e instanceof errors.JWTClaimValidationFailed) {
      if (e.claim === "iss") return bad("invalid_issuer");
      if (e.claim === "aud") return bad("invalid_audience");
      return bad("invalid_request");
    }
    if (e instanceof errors.JWSSignatureVerificationFailed) return bad("authentication_failed");
    return bad("invalid_request");
  }

  const jti = typeof payload.jti === "string" ? payload.jti : "";
  const subId = payload.sub_id as { format?: unknown; iss?: unknown; sub?: unknown } | undefined;
  const events = payload.events as Record<string, unknown> | undefined;
  if (!jti || !subId || subId.format !== "iss_sub" || subId.iss !== deps.issuer || typeof subId.sub !== "string" || !subId.sub) {
    return bad("invalid_request");
  }
  if (!events || typeof events !== "object" || Object.keys(events).length !== 1) return bad("invalid_request");

  const now = deps.now();
  for (const [k, t] of deps.seen) if (now - t > SEEN_MS) deps.seen.delete(k);
  if (deps.seen.has(jti)) return { status: 202, body: null };

  const type = Object.keys(events)[0]!;
  if (type === DELETED || type === ENDED) {
    const entry = await deps.stores.allowList.findBySub(subId.sub);
    if (entry) {
      const at = new Date(now).toISOString();
      const ended = await deps.stores.sessions.revokeAllForUser(entry.id, "yourtal", at);
      const detail = type === DELETED ? "YourTal account deleted" : `YourTal access ended (${String((events[type] as { reason?: unknown })?.reason ?? "no reason").slice(0, 40)})`;
      await deps.stores.audit.append({
        who: "yourtal",
        action: "session.revoke",
        target: entry.id,
        reason: `${detail}; ${ended} ${ended === 1 ? "session" : "sessions"} ended`,
      });
    }
  }
  deps.seen.set(jti, now);
  return { status: 202, body: null };
}
