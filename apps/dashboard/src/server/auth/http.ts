import { NextResponse, type NextRequest } from "next/server";
import type { AuthConfig } from "./config";
import { SESSION_COOKIE } from "./session";
import { TXN_COOKIE, TXN_TTL_MS } from "./transaction";

/** Response helpers shared by the /auth route handlers. */

export const NO_STORE = { "Cache-Control": "no-store", Vary: "Cookie" } as const;

/** Redirects go to the configured public origin (behind nginx the request URL is the upstream's), or to the
 *  request's own origin when real sign-in is off. */
export function redirectTo(request: NextRequest, cfg: AuthConfig | null, path: string): NextResponse {
  const res = NextResponse.redirect(new URL(path, cfg?.publicUrl ?? request.nextUrl.origin), 303);
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}

export function setTxnCookie(res: NextResponse, value: string): void {
  res.cookies.set(TXN_COOKIE, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: TXN_TTL_MS / 1000 });
}

export function clearCookie(res: NextResponse, name: typeof TXN_COOKIE | typeof SESSION_COOKIE): void {
  res.cookies.set(name, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/** The caller's address as nginx passes it. Only a coarse prefix of it is ever stored. */
export function clientIp(request: NextRequest): string | null {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for");
}

/** Whether a POST came from this dashboard's own pages: the Origin header, or failing that Sec-Fetch-Site.
 *  Neither present: refused. */
export function sameOriginPost(headers: Headers, origin: string): boolean {
  const o = headers.get("origin");
  if (o !== null) return o === origin;
  return headers.get("sec-fetch-site") === "same-origin";
}
