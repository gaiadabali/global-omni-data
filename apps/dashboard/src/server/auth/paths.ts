/**
 * Where sign-in may send the browser back to: a path on this origin only, never another site. The pages the
 * sign-in flow itself owns are refused, so a return path cannot loop.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  // No control characters or backslashes anywhere (browsers treat "\" like "/").
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return null;
  }
  let u: URL;
  try {
    u = new URL(value, "https://dashboard.invalid");
  } catch {
    return null;
  }
  if (u.origin !== "https://dashboard.invalid") return null;
  if (u.pathname.startsWith("/auth/") || u.pathname === "/signin" || u.pathname === "/healthz") return null;
  return `${u.pathname}${u.search}`;
}

export type SigninReason = "not-listed" | "password" | "teen" | "expired" | "retry" | "unavailable" | "signed-out";

export function signinPath(reason: SigninReason): string {
  return `/signin?reason=${reason}`;
}

/** The step-up URL a fresh passkey check sends the browser to. The page adds where to come back to. */
export const FRESH_START_PATH = "/auth/start?fresh=1";
