import {
  BREAK_GLASS_ABSOLUTE_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_TOUCH_MS,
  isBreakGlassSession,
  sessionEndedReason,
} from "../store/limits";
import type { AllowEntry, SessionRecord, Stores } from "../store/types";
import { isBrandId, type Viewer } from "../types";
import { TOKEN_SHAPE, newToken, sha256Hex } from "./crypto";

/**
 * Dashboard sessions. The browser holds a random 256-bit token in `__Host-god_session`; the store holds only its
 * SHA-256. Every request checks the idle (30 min) and absolute (8 h) limits, revocation, and that the person is
 * still active on the allow-list. lastSeenAt is written at most once a minute.
 */
export const SESSION_COOKIE = "__Host-god_session";

export type SessionState =
  | { kind: "none" }
  | { kind: "ended"; why: "revoked" | "absolute" | "idle" | "not-listed" }
  | { kind: "ok"; session: SessionRecord; entry: AllowEntry; viewer: Viewer };

/** The viewer an allow-list entry signs in as, or null when the entry cannot sign in. */
export function viewerOf(entry: AllowEntry): Viewer | null {
  if (entry.status !== "active") return null;
  if (entry.role === "brand_lead") {
    if (!entry.brand || !isBrandId(entry.brand)) return null;
    return { id: entry.id, displayName: entry.name, role: "brand_lead", brand: entry.brand };
  }
  return { id: entry.id, displayName: entry.name, role: entry.role };
}

type SessionStores = Pick<Stores, "allowList" | "sessions">;

export async function resolveSession(
  token: string | undefined,
  stores: SessionStores,
  now: number,
): Promise<SessionState> {
  if (!token || !TOKEN_SHAPE.test(token)) return { kind: "none" };
  const session = await stores.sessions.findByTokenHash(sha256Hex(token));
  if (!session) return { kind: "none" };
  const ended = sessionEndedReason(session, now);
  if (ended) return { kind: "ended", why: ended };
  // An emergency session's hour counts from its start, whatever its stored limit says (the database checks it too).
  if (isBreakGlassSession(session) && now - Date.parse(session.createdAt) >= BREAK_GLASS_ABSOLUTE_MS)
    return { kind: "ended", why: "absolute" };
  const entry = await stores.allowList.find(session.userId);
  const base = entry ? viewerOf(entry) : null;
  if (!entry || !base) return { kind: "ended", why: "not-listed" };
  // An emergency session is an Owner's, on every request, not only at sign-in.
  const emergency = isBreakGlassSession(session);
  if (emergency && entry.role !== "owner") return { kind: "ended", why: "not-listed" };
  const viewer: Viewer = emergency ? { ...base, breakGlass: true } : base;
  if (now - Date.parse(session.lastSeenAt) >= SESSION_TOUCH_MS) {
    const at = new Date(now).toISOString();
    await stores.sessions.touch(session.id, at);
    session.lastSeenAt = at;
  }
  return { kind: "ok", session, entry, viewer };
}

/** "203.0.113.x" or "2001:db8:1::/48": a coarse hint for Admin, never the full address. */
export function ipPrefixOf(ip: string | null | undefined): string | null {
  const raw = (ip ?? "").split(",")[0]?.trim() ?? "";
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(raw);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
  if (/^[0-9a-f:]+$/i.test(raw) && raw.includes(":")) {
    const parts = raw.split("::")[0]!.split(":").filter(Boolean).slice(0, 3);
    if (parts.length) return `${parts.join(":")}::/48`;
  }
  return null;
}

/** "Chrome on Windows" from a user agent, for Admin. Unknown parts say so. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "A browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iPhone"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "an unknown system";
  return `${browser} on ${os}`;
}

/**
 * Starts a session for an allow-listed person after a passkey sign-in. Returns the cookie token once.
 * `absoluteMs` is the absolute limit: 8 hours, or 1 hour for an emergency session.
 */
export async function startSession(
  stores: SessionStores,
  input: {
    entry: AllowEntry;
    authTime: string;
    amr: readonly string[];
    userAgent: string | null;
    ip: string | null;
    now: number;
    absoluteMs?: number;
  },
): Promise<{ token: string; session: SessionRecord }> {
  const token = newToken();
  const createdAt = new Date(input.now).toISOString();
  const session = await stores.sessions.create({
    tokenHash: sha256Hex(token),
    userId: input.entry.id,
    createdAt,
    absoluteExpiresAt: new Date(
      input.now + Math.min(input.absoluteMs ?? SESSION_ABSOLUTE_MS, SESSION_ABSOLUTE_MS),
    ).toISOString(),
    authTime: input.authTime,
    amr: input.amr,
    userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
    ipPrefix: ipPrefixOf(input.ip),
  });
  await stores.allowList.recordSignIn(input.entry.id, createdAt);
  return { token, session };
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_ABSOLUTE_MS / 1000,
};
