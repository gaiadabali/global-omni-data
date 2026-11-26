import { cache } from "react";
import { cookies } from "next/headers";
import { isDevAuthEnabled } from "../dev-auth";
import { getStores } from "../store";
import { freshGate, type FreshGate } from "./fresh";
import { SESSION_COOKIE, resolveSession, type SessionState } from "./session";

/**
 * The real session behind this request, resolved once per request. While dev sign-in is on there is never a real
 * session: the viewer comes from the dev cookie instead (src/server/viewer.ts). Never both.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  if (isDevAuthEnabled()) return { kind: "none" };
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value, getStores(), Date.now());
});

/** The fresh passkey gate for the person making this request. */
export async function checkFresh(): Promise<FreshGate> {
  const dev = isDevAuthEnabled();
  return freshGate(dev ? { kind: "none" } : await getSessionState(), dev, Date.now());
}
