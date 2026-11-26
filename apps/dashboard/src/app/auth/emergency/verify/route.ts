import { NextResponse, type NextRequest } from "next/server";
import { homePathFor } from "@/server/access";
import { NO_STORE, clientIp } from "@/server/auth/http";
import { SESSION_COOKIE, sessionCookieOptions, viewerOf } from "@/server/auth/session";
import { emergencyDeps, json, readPost } from "@/server/breakglass/http";
import { NOT_AVAILABLE, emergencyVerify } from "@/server/breakglass/signin";
import { BREAK_GLASS_ABSOLUTE_MS } from "@/server/store/limits";

export const dynamic = "force-dynamic";

/**
 * POST /auth/emergency/verify { ceremonyId, response }: checks the emergency key's answer (src/server/breakglass/
 * signin.ts). On success the session cookie is set for 1 hour and the answer names where to go; the browser then
 * navigates there. Every refusal is the same 401 with the same words.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const deps = emergencyDeps();
  if (!deps.config) return json({ error: NOT_AVAILABLE }, 503);
  const body = await readPost(request, deps.config.origin);
  if (body instanceof Response) return body;
  const b = (typeof body === "object" && body !== null ? body : {}) as {
    ceremonyId?: unknown;
    response?: unknown;
  };
  const out = await emergencyVerify(
    {
      ceremonyId: b.ceremonyId,
      response: b.response,
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
      sessionToken: request.cookies.get(SESSION_COOKIE)?.value,
    },
    deps,
  );
  if (!out.ok) return json({ error: out.error }, out.status);
  const viewer = viewerOf(out.entry);
  const res = NextResponse.json(
    { ok: true, next: viewer ? homePathFor(viewer) : "/" },
    { headers: NO_STORE },
  );
  res.cookies.set(SESSION_COOKIE, out.token, {
    ...sessionCookieOptions,
    maxAge: Math.floor(BREAK_GLASS_ABSOLUTE_MS / 1000),
  });
  return res;
}
