// Copies MapLibre's tile worker into public/maplibre/ at dev and build time, so it ships in the standalone image
// as a plain static file (the standalone trace cannot follow a file read at run time). Gitignored, regenerated.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("maplibre-gl/package.json"));
const { version } = require("maplibre-gl/package.json");
mkdirSync("public/maplibre", { recursive: true });
copyFileSync(join(dist, "dist", "maplibre-gl-worker.mjs"), "public/maplibre/maplibre-gl-worker.mjs");
console.log(`maplibre worker ${version} -> public/maplibre/`);
