import type { NextRequest } from "next/server";
import { readAuthConfig } from "@/server/auth/config";
import { clearCookie, redirectTo, sameOriginPost } from "@/server/auth/http";
import { signinPath } from "@/server/auth/paths";
import { SESSION_COOKIE, resolveSession } from "@/server/auth/session";
import { isDevAuthEnabled } from "@/server/dev-auth";
import { getStores } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * POST /auth/signout: ends this browser's session (revoked in the store, cookie cleared) and goes to /signin.
 * POST only (Next answers 405 to anything else). CSRF-safe: the session cookie is SameSite=Lax, so a cross-site
 * POST carries none, and a request whose Origin is not this dashboard's is refused before anything changes.
 * YourTal has no RP-initiated logout (docs/26 §1.1), so this signs out of the dashboard only.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const cfg = readAuthConfig();
  if (isDevAuthEnabled() || !cfg) return redirectTo(request, cfg, "/signin");
  if (!sameOriginPost(request.headers, cfg.publicUrl)) {
    return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const stores = getStores();
  const now = Date.now();
  const state = await resolveSession(request.cookies.get(SESSION_COOKIE)?.value, stores, now);
  if (state.kind === "ok") {
    await stores.sessions.revoke(state.session.id, state.entry.id, new Date(now).toISOString());
    await stores.audit.append({ who: state.entry.id, action: "signout", target: `session:${state.session.id}`, reason: "Signed out" });
  }
  const res = redirectTo(request, cfg, signinPath("signed-out"));
  clearCookie(res, SESSION_COOKIE);
  return res;
}
