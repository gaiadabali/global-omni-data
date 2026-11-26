import { isRealSignInOn, passwordSignInAllowed } from "@/server/auth/config";
import { isDevAuthEnabled } from "@/server/dev-auth";
import { getStores } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * GET /healthz: up or not, which build is live, which sign-in runs and which store kind. Nothing else, no secrets,
 * no session and no database query. The Docker HEALTHCHECK, the deploy script (it waits for `build` to equal the new
 * image's sha) and the nginx checks call it. GOD_BUILD_SHA is baked into the image.
 */
export async function GET(): Promise<Response> {
  const signIn = isDevAuthEnabled() ? "dev" : isRealSignInOn() ? "yourtal" : "off";
  return Response.json(
    {
      ok: true,
      build: process.env.GOD_BUILD_SHA ?? "unknown",
      signIn,
      passwordSignIn: passwordSignInAllowed(),
      store: getStores().kind,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
