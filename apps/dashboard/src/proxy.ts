import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, generateNonce } from "@/lib/csp";

/**
 * Next 16 renamed middleware to proxy (src/proxy.ts, exporting `proxy`). It runs on every page request and sets
 * the Content-Security-Policy with a fresh nonce. The nonce goes on the request headers too, so Next puts it on
 * its own scripts while rendering (this is why every page is rendered per request, never prerendered).
 * The other security headers are static and live in next.config.ts. See src/lib/csp.ts for the policy.
 */
export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
    // Staging and production sit behind https and set no GOD_DEPLOYMENT. Local dev runs on plain http.
    upgradeInsecure: process.env.GOD_DEPLOYMENT !== "dev",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Not the API (route handlers set their own policy), static files, images or the favicon.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
