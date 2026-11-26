/**
 * Session limits, shared by every SessionStore implementation (listActive) and by the session check that runs on
 * every request (src/server/auth/session.ts). One place, so Admin's list and the sign-in check never disagree.
 */
export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_ABSOLUTE_MS = 8 * 3_600_000;
/** An emergency (break-glass) session ends 1 hour after it began, whatever else happens. The database checks it too. */
export const BREAK_GLASS_ABSOLUTE_MS = 3_600_000;
/** The `amr` of an emergency session: a passkey local to the dashboard, used as the break-glass key. */
export const BREAK_GLASS_AMR = ["hwk", "break-glass"] as const;

/** Whether a session is an emergency (break-glass) session. Once one, always one. */
export function isBreakGlassSession(s: { amr: readonly string[] }): boolean {
  return s.amr.includes("break-glass");
}
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
