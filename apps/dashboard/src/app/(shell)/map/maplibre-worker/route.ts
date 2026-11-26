import { readFile } from "node:fs/promises";
import path from "node:path";
import { getViewer } from "@/server/viewer";

export const dynamic = "force-dynamic";

/**
 * MapLibre GL 6 runs its tile work in a module worker loaded from a separate file, `maplibre-gl-worker.mjs`.
 * A bundler does not move that file, so the app serves it itself, from the installed package, on this origin.
 * The page points MapLibre at it with setWorkerUrl(), and the CSP allows it with `worker-src 'self'`: no blob URL
 * and no change to the policy. Same-version by construction (it is read from the package the app was built with).
 *
 * Signed-in staff only, like every other route in this app. The file is open-source library code, not data.
 */
export async function GET(): Promise<Response> {
  const viewer = await getViewer();
  if (!viewer) return new Response("Sign in required", { status: 401 });
  const tail = ["node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"];
  // `next start` runs from apps/dashboard; a run from the repo root finds it one folder down.
  const candidates = [path.join(process.cwd(), ...tail), path.join(process.cwd(), "apps", "dashboard", ...tail)];
  let body: Buffer | null = null;
  for (const file of candidates) {
    try {
      body = await readFile(file);
      break;
    } catch {
      // try the next place
    }
  }
  if (!body) return new Response("Map worker not found", { status: 500 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // The page asks for it as ?v=<maplibre version>, so a new version is a new URL.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
