import { createRemoteJWKSet } from "jose";
import { readAuthConfig } from "@/server/auth/config";
import { handleSecurityEvent } from "@/server/auth/events";
import { getConfiguration } from "@/server/auth/oidc";
import { getStores } from "@/server/store";

export const dynamic = "force-dynamic";

type Holder = { __godSetSeen?: Map<string, number>; __godJwks?: { uri: string; get: ReturnType<typeof createRemoteJWKSet> } };

/**
 * POST /auth/yourtal/events: YourTal's signed events (docs/26 §2.3). Server to server, so no cookie and no
 * Origin check: the signature against YourTal's JWKS, `typ`, `iss` and `aud` are the authentication.
 * 202 when valid (or already seen), 400 with an RFC 8935 `err` otherwise, 503 while sign-in is not configured.
 */
export async function POST(request: Request): Promise<Response> {
  const cfg = readAuthConfig();
  if (!cfg) return new Response(null, { status: 503 });
  let jwksUri: string | undefined;
  try {
    jwksUri = (await getConfiguration(cfg)).serverMetadata().jwks_uri;
  } catch {
    return new Response(null, { status: 503 });
  }
  if (!jwksUri) return new Response(null, { status: 503 });

  const g = globalThis as Holder;
  g.__godSetSeen ??= new Map();
  if (g.__godJwks?.uri !== jwksUri) g.__godJwks = { uri: jwksUri, get: createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 10_000 }) };

  const answer = await handleSecurityEvent(request.headers.get("content-type"), await request.text(), {
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    getKey: g.__godJwks.get,
    stores: getStores(),
    now: Date.now,
    seen: g.__godSetSeen,
  });
  return answer.body
    ? Response.json(answer.body, { status: answer.status, headers: { "Cache-Control": "no-store" } })
    : new Response(null, { status: answer.status, headers: { "Cache-Control": "no-store" } });
}
