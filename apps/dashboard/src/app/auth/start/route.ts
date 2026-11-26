import type { NextRequest } from "next/server";
import { readAuthConfig } from "@/server/auth/config";
import { getSessionState } from "@/server/auth/current";
import { redirectTo, setTxnCookie } from "@/server/auth/http";
import { buildStart, getConfiguration } from "@/server/auth/oidc";
import { safeReturnPath, signinPath } from "@/server/auth/paths";
import { sealTransaction } from "@/server/auth/transaction";
import { isDevAuthEnabled } from "@/server/dev-auth";

export const dynamic = "force-dynamic";

/**
 * GET /auth/start[?fresh=1][&return=/path]: begins Sign in with YourTal (code flow, PKCE S256, state, nonce),
 * keeping the transaction in the encrypted `__Host-god_oidc` cookie. `fresh=1` is the fresh passkey check for the
 * signed-in session (max_age=0). A plain link, never a form post, so CSP form-action never meets the redirect to
 * YourTal.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const cfg = readAuthConfig();
  if (isDevAuthEnabled() || !cfg) return redirectTo(request, cfg, signinPath("unavailable"));

  const params = request.nextUrl.searchParams;
  const fresh = params.get("fresh") === "1";
  const returnTo = safeReturnPath(params.get("return"));
  let freshFor: string | null = null;
  if (fresh) {
    const state = await getSessionState();
    if (state.kind !== "ok") return redirectTo(request, cfg, signinPath("expired"));
    freshFor = state.session.id;
  }

  let started;
  try {
    started = await buildStart(await getConfiguration(cfg), cfg.redirectUri, fresh);
  } catch {
    return redirectTo(request, cfg, signinPath("unavailable"));
  }
  const res = redirectTo(request, cfg, started.url);
  setTxnCookie(
    res,
    sealTransaction(
      { state: started.state, nonce: started.nonce, codeVerifier: started.codeVerifier, returnTo, freshFor, startedAt: Date.now() },
      cfg.sessionSecret,
    ),
  );
  return res;
}
