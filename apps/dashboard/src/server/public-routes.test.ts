import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUBLIC_ROUTES } from "./access";

/**
 * Every route handler under src/app/api either asks who is signed in (getViewer, then requireApi) or is listed in
 * PUBLIC_ROUTES. A new route that does neither fails here, so an unauthenticated endpoint is always a decision someone
 * wrote down, never an accident.
 */
const API_DIR = fileURLToPath(new URL("../app/api", import.meta.url));

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? routeFiles(p) : name === "route.ts" ? [p] : [];
  });
}

const apiPath = (file: string) => "/api/" + relative(API_DIR, file).split(sep).slice(0, -1).join("/");

describe("public routes", () => {
  const files = routeFiles(API_DIR);
  const publicPaths = PUBLIC_ROUTES.map((r) => r.path);

  it("every route under /api that does not look at the viewer is in PUBLIC_ROUTES, and no other", () => {
    const unauthenticated = files.filter((f) => !/getViewer\(/.test(readFileSync(f, "utf8"))).map(apiPath);
    // The contact route reaches its handler, which reads no viewer: it is the one public route.
    expect(unauthenticated.sort()).toEqual([...publicPaths].sort());
  });

  it("every route that reads the viewer also gates on its role", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (!/getViewer\(/.test(src)) continue;
      expect(src, apiPath(f)).toMatch(/handle[A-Z]\w+\(viewer|requireApi\(viewer/);
    }
  });

  it("every public route has a file, and only the one method it lists", () => {
    for (const r of PUBLIC_ROUTES) {
      const file = files.find((f) => apiPath(f) === r.path);
      expect(file, r.path).toBeDefined();
      const src = readFileSync(file!, "utf8");
      const methods = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]);
      expect(methods).toEqual([r.method]);
    }
  });
});
