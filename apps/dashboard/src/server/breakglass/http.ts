import type { NextRequest } from "next/server";
import { NO_STORE, sameOriginPost } from "../auth/http";
import { getStores } from "../store";
import { getBreakGlassRuntime } from "./ceremonies";
import { readBreakGlassConfig } from "./config";
import type { EmergencyDeps } from "./signin";
import { simpleWebAuthn } from "./webauthn";

/** Shared by the two /auth/emergency route handlers. */

export function emergencyDeps(): EmergencyDeps {
  const { ceremonies, limiter } = getBreakGlassRuntime();
  return {
    stores: getStores(),
    config: readBreakGlassConfig(),
    webauthn: simpleWebAuthn,
    ceremonies,
    limiter,
    now: Date.now,
  };
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

const MAX_BODY = 16_384;

/**
 * The JSON body of a same-origin POST, or a Response refusing it: another origin (403), not JSON or too big (400).
 * The Origin must be the dashboard's own (GOD_PUBLIC_URL), so another site cannot drive the ceremony.
 */
export async function readPost(request: NextRequest, origin: string): Promise<unknown | Response> {
  if (!sameOriginPost(request.headers, origin)) return json({ error: "Forbidden" }, 403);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json"))
    return json({ error: "Send JSON." }, 400);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "Too large." }, 400);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return json({ error: "Send JSON." }, 400);
  }
}
