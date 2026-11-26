/**
 * Session limits, shared by every SessionStore implementation (listActive) and by the session check that runs on
 * every request (src/server/auth/session.ts). One place, so Admin's list and the sign-in check never disagree.
 */
export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_ABSOLUTE_MS = 8 * 3_600_000;
/** lastSeenAt is written at most this often, so a busy page does not write on every request. */
export const SESSION_TOUCH_MS = 60_000;

/** Why a stored session no longer counts at `at`, or null while it does. Boundaries are inclusive: at exactly
 *  30 minutes idle, or exactly 8 hours old, it has ended. */
export function sessionEndedReason(
  s: { lastSeenAt: string; absoluteExpiresAt: string; revokedAt: string | null },
  at: number,
): "revoked" | "absolute" | "idle" | null {
  if (s.revokedAt !== null) return "revoked";
  const absolute = Date.parse(s.absoluteExpiresAt);
  const seen = Date.parse(s.lastSeenAt);
  if (!Number.isFinite(absolute) || at >= absolute) return "absolute";
  if (!Number.isFinite(seen) || at - seen >= SESSION_IDLE_MS) return "idle";
  return null;
}
