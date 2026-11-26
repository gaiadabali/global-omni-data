import type { NextRequest } from "next/server";
import { homePathFor } from "@/server/access";
import { handleCallback } from "@/server/auth/callback";
import { readAuthConfig } from "@/server/auth/config";
import { clearCookie, clientIp, redirectTo } from "@/server/auth/http";
import { getConfiguration, redeem } from "@/server/auth/oidc";
import { signinPath } from "@/server/auth/paths";
import { SESSION_COOKIE, sessionCookieOptions, viewerOf } from "@/server/auth/session";
import { TXN_COOKIE } from "@/server/auth/transaction";
import { isDevAuthEnabled } from "@/server/dev-auth";
import { getStores } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * GET /auth/callback: YourTal's redirect back. Every check runs before a session exists (src/server/auth/callback.ts).
 * The transaction cookie is deleted whatever happens. A refusal goes to /signin?reason=... and sets no session.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const cfg = readAuthConfig();
  if (isDevAuthEnabled() || !cfg) {
    const res = redirectTo(request, cfg, signinPath("unavailable"));
    clearCookie(res, TXN_COOKIE);
    return res;
  }

  const outcome = await handleCallback(
    {
      txnCookie: request.cookies.get(TXN_COOKIE)?.value,
      query: request.nextUrl.searchParams,
      sessionToken: request.cookies.get(SESSION_COOKIE)?.value,
      userAgent: request.headers.get("user-agent"),
      ip: clientIp(request),
    },
    {
      stores: getStores(),
      secret: cfg.sessionSecret,
      now: Date.now,
      redeem: async (query, expected) =>
        redeem(await getConfiguration(cfg), cfg.redirectUri, query, expected),
    },
  );

  let res;
  if (outcome.kind === "signed-in") {
    const viewer = viewerOf(outcome.entry);
    res = redirectTo(request, cfg, outcome.returnTo ?? (viewer ? homePathFor(viewer) : "/"));
    res.cookies.set(SESSION_COOKIE, outcome.token, sessionCookieOptions);
  } else if (outcome.kind === "fresh-ok") {
    res = redirectTo(request, cfg, outcome.returnTo ?? "/");
  } else {
    res = redirectTo(request, cfg, signinPath(outcome.reason));
    if (outcome.endSession) clearCookie(res, SESSION_COOKIE);
  }
  clearCookie(res, TXN_COOKIE);
  return res;
}
