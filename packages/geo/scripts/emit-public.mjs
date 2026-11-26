#!/usr/bin/env node
/**
 * Writes the display boundaries as plain GeoJSON for the browser: state.json, sa4.json, sa3.json, sa2.json.
 *   node emit-public.mjs [outDir]        (default: apps/dashboard/public/geo)
 * Run by the dashboard's `dev` and `build` scripts, so the files are generated from the committed TopoJSON in
 * packages/geo/data and are not committed themselves. Each feature has `id` and `properties` { code, name }; a
 * state's code is its abbreviation ("NSW"). Coordinates have 5 decimals (about a metre).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toFeatureCollection } from "../src/topo.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "..", "data");
const OUT = resolve(process.argv[2] ?? join(HERE, "..", "..", "..", "apps", "dashboard", "public", "geo"));

const read = async (f) => (await import(pathToFileURL(join(DATA, f)).href)).default;
const areas = await read("areas.js");
const FILES = [
  ["state", "ste.topo.js", areas.ste],
  ["sa4", "sa4.topo.js", areas.sa4],
  ["sa3", "sa3.topo.js", areas.sa3],
  ["sa2", "sa2.topo.js", areas.sa2],
];

mkdirSync(OUT, { recursive: true });
for (const [level, file, rows] of FILES) {
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const fc = toFeatureCollection(await read(file), (id) => ({ code: id, name: names.get(id) ?? id }));
  const body = JSON.stringify(fc);
  writeFileSync(join(OUT, `${level}.json`), body);
  console.log(`[geo] ${level}.json ${(body.length / 1024).toFixed(0)} KB, ${fc.features.length} features -> ${OUT}`);
}
