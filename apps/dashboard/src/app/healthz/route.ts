import { isRealSignInOn } from "@/server/auth/config";
import { isDevAuthEnabled } from "@/server/dev-auth";
import { getStores } from "@/server/store";

export const dynamic = "force-dynamic";

/** GET /healthz: up or not, which sign-in runs, and which store kind. Nothing else, and no secrets. */
export async function GET(): Promise<Response> {
  const signIn = isDevAuthEnabled() ? "dev" : isRealSignInOn() ? "yourtal" : "off";
  return Response.json({ ok: true, signIn, store: getStores().kind }, { headers: { "Cache-Control": "no-store" } });
}
