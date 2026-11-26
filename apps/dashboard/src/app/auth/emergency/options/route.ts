import type { NextRequest } from "next/server";
import { clientIp } from "@/server/auth/http";
import { emergencyDeps, json, readPost } from "@/server/breakglass/http";
import { NOT_AVAILABLE, emergencyOptions } from "@/server/breakglass/signin";

export const dynamic = "force-dynamic";

/**
 * POST /auth/emergency/options: a single-use WebAuthn challenge for the emergency (break-glass) key, after the rate
 * limit. Same-origin JSON only. 503 while emergency sign-in is off (dev sign-in on), 429 past the rate limit.
 * Never talks to YourTal.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const deps = emergencyDeps();
  if (!deps.config) return json({ error: NOT_AVAILABLE }, 503);
  const body = await readPost(request, deps.config.origin);
  if (body instanceof Response) return body;
  const out = await emergencyOptions({ ip: clientIp(request) }, deps);
  return out.ok
    ? json({ ceremonyId: out.ceremonyId, options: out.options })
    : json({ error: out.error }, out.status);
}
