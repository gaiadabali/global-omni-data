/**
 * TEMPORARY, from the fe/backend branch: the sign-in branch (fe/auth) adds the real /healthz. At merge, keep one of
 * the two and delete this file. The Docker HEALTHCHECK, the deploy script and nginx checks call this path. It needs
 * no session and touches no database: it only says the process is serving. GOD_BUILD_SHA is baked into the image, so
 * a curl shows which build is live.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    { ok: true, build: process.env.GOD_BUILD_SHA ?? "unknown" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
