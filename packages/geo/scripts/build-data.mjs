#!/usr/bin/env node
/**
 * Builds packages/geo/data from the Australian Bureau of Statistics downloads (CC BY 4.0, see ../SOURCES.md).
 *
 *   pnpm --filter @god/geo run build:data        (on server-f: bash scripts/server-f/remote-build.sh <tree> geo-data <name>)
 *
 * Plain Node, npm packages only, none native: shapefile (reads the .shp/.dbf), topojson-server and topojson-simplify
 * (shared arcs, then simplification that keeps neighbours on one boundary), fflate (zips).
 * Downloads are cached in $GOD_ABS_CACHE (default /opt/god-build/cache/abs on server-f, else packages/geo/.cache) and
 * checked against the SHA-256 recorded below, so a changed upstream file stops the build instead of changing the data.
 * The output is deterministic: no timestamps, sorted by code.
 *
 * Writes to data/ (each .js is `export default <json>;`, with a .d.ts beside it):
 *   ste.topo.js sa4.topo.js sa3.topo.js sa2.topo.js   simplified display boundaries (TopoJSON, ids = area codes)
 *   areas.js          per area: id, name, parents, centroid (a point inside the area), bbox, area in km2
 *   suburbs.js        one point per suburb or locality (SAL): code, name, state, lon, lat, SA2, km2
 *   population.js    estimated resident population by SA2 and 5-year age group, 30 June 2025
 *   manifest.json     the sources used (URL, bytes, SHA-256), the tool versions and the settings
 */
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import * as shapefile from "shapefile";
import { topology } from "topojson-server";
import { quantize } from "topojson-client";
import { presimplify, simplify, sphericalTriangleArea } from "topojson-simplify";
// Node strips the types of these two files; they have no imports and only erasable syntax on purpose.
import { decodeArcs, polygonsOf } from "../src/topo.ts";
import { labelPoint, polygonsBBox, pointInPolygon } from "../src/shape.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const OUT = join(PKG, "data");
const CACHE = process.env.GOD_ABS_CACHE ?? (existsSync("/opt/god-build/cache") ? "/opt/god-build/cache/abs" : join(PKG, ".cache"));

const ASGS = "https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/access-and-downloads/digital-boundary-files";
const ERP = "https://www.abs.gov.au/statistics/people/population/regional-population-age-and-sex/2025";

/** Every download, with the SHA-256 seen on 2026-11-26. */
const SOURCES = {
  STE: { url: `${ASGS}/STE_2021_AUST_SHP_GDA2020.zip`, sha256: "d9b7f735de6085b37414faf011f796dda3c7f768c55e9dce01f96e790f399a21" },
  SA4: { url: `${ASGS}/SA4_2021_AUST_SHP_GDA2020.zip`, sha256: "36eeceb69329f981d95d08b68e8e5af37c261d23e735d701b6e466acaa1bbe39" },
  SA3: { url: `${ASGS}/SA3_2021_AUST_SHP_GDA2020.zip`, sha256: "05215ddc3a577373aa929038cad4cd0fddf910d2f62dbc36cc9c628b5e0a6a32" },
  SA2: { url: `${ASGS}/SA2_2021_AUST_SHP_GDA2020.zip`, sha256: "c4dc5bac209f01177eaa0715d27f32cdb09ab5784fb82979741556d2f8e6d148" },
  SAL: { url: `${ASGS}/SAL_2021_AUST_GDA2020_SHP.zip`, sha256: "1284f6aa4a5eedbe6d0b8c71099494f634d59f1500532c1944b8227b4d1474ca" },
  ERP: { url: `${ERP}/32350DS0001_2025.xlsx`, sha256: "35b4aadda000e7830813a8450cee2aa817891069353805a31e58f6fd3a3f4f02" },
};

/**
 * Simplification per level: Visvalingam, the interval in metres (the side of the smallest triangle kept), applied to
 * the shared arcs so neighbours keep one boundary and do not gap. Coarser for the levels shown from far away.
 */
const LEVELS = [
  { key: "ste", src: "STE", interval: Number(process.env.GEO_INTERVAL_STE ?? 800), fields: ["STE_CODE21", "STE_NAME21", "AREASQKM21"] },
  { key: "sa4", src: "SA4", interval: Number(process.env.GEO_INTERVAL_SA4 ?? 400), fields: ["SA4_CODE21", "SA4_NAME21", "GCC_CODE21", "GCC_NAME21", "STE_CODE21", "AREASQKM21"] },
  { key: "sa3", src: "SA3", interval: Number(process.env.GEO_INTERVAL_SA3 ?? 250), fields: ["SA3_CODE21", "SA3_NAME21", "SA4_CODE21", "STE_CODE21", "AREASQKM21"] },
  { key: "sa2", src: "SA2", interval: Number(process.env.GEO_INTERVAL_SA2 ?? 150), fields: ["SA2_CODE21", "SA2_NAME21", "SA3_CODE21", "STE_CODE21", "AREASQKM21"] },
];
const QUANT = Number(process.env.GEO_QUANT ?? 1000000);

const STATE_ABBR = { 1: "NSW", 2: "VIC", 3: "QLD", 4: "SA", 5: "WA", 6: "TAS", 7: "NT", 8: "ACT", 9: "OT" };
const abbrOf = (code) => STATE_ABBR[Number(code)] ?? "OT";

const log = (...a) => console.log("[geo]", ...a);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

/* ---------------- downloads ---------------- */

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function fetchSource(key) {
  const { url, sha256: want } = SOURCES[key];
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, url.split("/").pop());
  if (!existsSync(file)) {
    log("downloading", url);
    const res = await fetch(url, { headers: { "User-Agent": "god-geo-build" } });
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status}): ${url}`);
    const part = `${file}.part`;
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
    renameSync(part, file);
  }
  const buf = readFileSync(file);
  const got = sha256(buf);
  if (got !== want) {
    throw new Error(`${file} has SHA-256 ${got}, expected ${want}. ABS has changed the file: check it, then update SOURCES.`);
  }
  log("source ok", key, kb(buf.length));
  return { file, buf, url, bytes: buf.length, sha256: got };
}

/** Unzips only the shapefile parts into the cache, once. Returns the .shp and .dbf paths. */
function unpackShapefile(key, zipFile, zipBuf) {
  const dir = join(CACHE, "unpacked", key);
  mkdirSync(dir, { recursive: true });
  const files = unzipSync(new Uint8Array(zipBuf), { filter: (f) => /\.(shp|dbf|prj|cpg)$/i.test(f.name) });
  let shp = null;
  let dbf = null;
  for (const [name, data] of Object.entries(files)) {
    const out = join(dir, name);
    if (!existsSync(out) || statSync(out).size !== data.length) writeFileSync(out, data);
    if (/\.shp$/i.test(name)) shp = out;
    if (/\.dbf$/i.test(name)) dbf = out;
  }
  if (!shp || !dbf) throw new Error(`no shapefile in ${zipFile}`);
  return { shp, dbf };
}

/* ---------------- simplification ---------------- */

const EARTH_R = 6371008.8;

/**
 * Reads the shapefile, builds a topology (neighbours share their boundary arcs, so they cannot gap), then drops every
 * vertex whose triangle with its neighbours has an area under interval x interval metres (Visvalingam).
 */
async function simplifyLevel(level, shp, dbf) {
  const source = await shapefile.open(shp, dbf, { encoding: "utf-8" });
  const features = [];
  for (;;) {
    const r = await source.read();
    if (r.done) break;
    if (!r.value.geometry) continue; // the special codes with no shape (no usual address, offshore, ...)
    const properties = {};
    for (const k of level.fields) properties[k] = r.value.properties[k];
    features.push({ type: "Feature", properties, geometry: r.value.geometry });
  }
  log(level.key, features.length, "shapes read; simplifying at", level.interval, "m");
  let topo = topology({ areas: { type: "FeatureCollection", features } });
  topo = presimplify(topo, sphericalTriangleArea); // weights in steradians
  topo = simplify(topo, (level.interval / EARTH_R) ** 2);
  // Back to integer coordinates, delta-encoded: much smaller, and shared points stay shared.
  return quantize(topo, QUANT);
}

/* ---------------- areas ---------------- */

const PROP = {
  ste: (p) => ({ id: abbrOf(p.STE_CODE21), code: String(p.STE_CODE21), name: p.STE_NAME21 }),
  sa4: (p) => ({
    id: String(p.SA4_CODE21),
    name: p.SA4_NAME21,
    state: abbrOf(p.STE_CODE21),
    gcc: String(p.GCC_CODE21),
    gccName: p.GCC_NAME21,
  }),
  sa3: (p) => ({ id: String(p.SA3_CODE21), name: p.SA3_NAME21, sa4: String(p.SA4_CODE21), state: abbrOf(p.STE_CODE21) }),
  sa2: (p) => ({ id: String(p.SA2_CODE21), name: p.SA2_NAME21, sa3: String(p.SA3_CODE21), state: abbrOf(p.STE_CODE21) }),
};

/** Turns the simplified TopoJSON into a clean topology (ids only) plus the area records. */
function processLevel(level, topo) {
  const layer = Object.values(topo.objects)[0];
  const arcs = decodeArcs(topo);
  const records = [];
  const polys = new Map();
  const keep = [];
  for (const g of layer.geometries) {
    if (!g.type || !g.arcs || !g.properties) continue; // the special codes with no shape (no usual address, offshore, ...)
    const p = g.properties;
    const base = PROP[level.key](p);
    const polygons = polygonsOf(g, arcs);
    if (!polygons.length) continue;
    const [lon, lat] = labelPoint(polygons);
    const bbox = polygonsBBox(polygons).map((v) => round(v, 3));
    const rec = {
      ...base,
      areaKm2: round(Number(p.AREASQKM21), 2),
      centroid: [round(lon, 4), round(lat, 4)],
      bbox,
    };
    records.push(rec);
    polys.set(rec.id, polygons);
    keep.push({ type: g.type, arcs: g.arcs, id: rec.id });
  }
  const order = records.map((r, i) => [r.id, i]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const sorted = order.map(([, i]) => records[i]);
  const keepSorted = order.map(([, i]) => keep[i]);
  const clean = {
    type: "Topology",
    transform: topo.transform,
    arcs: topo.arcs,
    objects: { areas: { type: "GeometryCollection", geometries: keepSorted } },
  };
  return { records: sorted, topology: clean, polys };
}

/* ---------------- population (xlsx) ---------------- */

const dec = new TextDecoder("utf-8");
const unxml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function readXlsxTable(buf, sheetName) {
  const zip = unzipSync(new Uint8Array(buf), {
    filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(f.name),
  });
  const text = (n) => dec.decode(zip[n]);
  const strings = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  const wb = text("xl/workbook.xml");
  const sheetTag = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`name="${sheetName}"`));
  if (!sheetTag) throw new Error(`sheet ${sheetName} not found`);
  const rid = /r:id="([^"]+)"/.exec(sheetTag)[1];
  const rels = text("xl/_rels/workbook.xml.rels");
  const relTag = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`));
  const target = /Target="([^"]+)"/.exec(relTag)[1].replace(/^\/?(xl\/)?/, "xl/");
  const xml = text(target);
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = /\br="([A-Z]+)\d+"/.exec(cm[1])?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(cm[2] ?? "")?.[1];
      if (!col || v === undefined) continue;
      cells[col] = /\bt="s"/.test(cm[1]) ? strings[Number(v)] : unxml(v);
    }
    rows.push(cells);
  }
  return rows;
}

const AGE_COLS = ["K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AB"];

function readPopulation(buf) {
  const rows = readXlsxTable(buf, "Table 3"); // persons
  const head = rows.find((r) => r.K === "0–4");
  if (!head) throw new Error("age header row not found in Table 3");
  const ageGroups = AGE_COLS.map((c) => head[c]);
  if (ageGroups[17] !== "85 and over" || head.AC !== "Total persons") throw new Error(`unexpected columns: ${ageGroups.join("|")}`);
  const sa2 = {};
  for (const r of rows) {
    if (!/^\d{9}$/.test(r.I ?? "")) continue;
    const groups = AGE_COLS.map((c) => Number(r[c]));
    const total = Number(r.AC);
    if (groups.some((n) => !Number.isFinite(n)) || !Number.isFinite(total)) throw new Error(`bad row for SA2 ${r.I}`);
    sa2[r.I] = [total, ...groups];
  }
  return { ageGroups, sa2 };
}

/* ---------------- suburbs (SAL) ---------------- */

/** A grid of the SA2 polygons, to find the SA2 a suburb point is in. */
function sa2Finder(sa2Polys, sa2Records) {
  const CELL = 0.25;
  const grid = new Map();
  const bboxes = new Map();
  for (const rec of sa2Records) {
    const [w, s, e, n] = rec.bbox;
    bboxes.set(rec.id, rec.bbox);
    for (let gx = Math.floor(w / CELL); gx <= Math.floor(e / CELL); gx++) {
      for (let gy = Math.floor(s / CELL); gy <= Math.floor(n / CELL); gy++) {
        const k = gx * 100000 + gy;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(rec.id);
      }
    }
  }
  const nearestVertex = (x, y, ids) => {
    let best = null;
    let bd = Infinity;
    for (const id of ids) {
      for (const poly of sa2Polys.get(id)) {
        const r = poly[0];
        for (let i = 0; i < r.length; i += 2) {
          const dx = r[i] - x;
          const dy = r[i + 1] - y;
          const d = dx * dx + dy * dy;
          if (d < bd) {
            bd = d;
            best = id;
          }
        }
      }
    }
    return best;
  };
  return (x, y) => {
    const ids = grid.get(Math.floor(x / CELL) * 100000 + Math.floor(y / CELL)) ?? [];
    for (const id of ids) {
      const [w, s, e, n] = bboxes.get(id);
      if (x < w || x > e || y < s || y > n) continue;
      for (const poly of sa2Polys.get(id)) if (pointInPolygon(x, y, poly)) return id;
    }
    // On the coast, simplification can leave a point just outside every SA2: take the nearest boundary.
    const near = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of grid.get((Math.floor(x / CELL) + dx) * 100000 + Math.floor(y / CELL) + dy) ?? []) near.push(id);
      }
    }
    return near.length ? nearestVertex(x, y, [...new Set(near)]) : null;
  };
}

const toRing = (coords) => {
  const r = new Float64Array(coords.length * 2);
  for (let i = 0; i < coords.length; i++) {
    r[2 * i] = coords[i][0];
    r[2 * i + 1] = coords[i][1];
  }
  return r;
};

async function readSuburbs(dbf, shp, findSa2) {
  const src = await shapefile.open(shp, dbf, { encoding: "utf-8" });
  const rows = [];
  let skipped = 0;
  let noSa2 = 0;
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    const f = r.value;
    if (!f.geometry) {
      skipped++; // no usual address, migratory and so on
      continue;
    }
    const polygons = (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p.map(toRing));
    const [lon, lat] = labelPoint(polygons);
    const sa2 = findSa2(lon, lat);
    if (!sa2) noSa2++;
    const name = String(f.properties.SAL_NAME21).replace(/\s*\([^)]*\)$/, "");
    rows.push([
      String(f.properties.SAL_CODE21),
      name,
      abbrOf(f.properties.STE_CODE21),
      round(lon, 4),
      round(lat, 4),
      sa2 ?? "",
      round(Number(f.properties.AREASQKM21), 2),
    ]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  log("suburbs", rows.length, "kept;", skipped, "with no shape skipped;", noSa2, "without an SA2");
  return rows;
}

/* ---------------- main ---------------- */

function versionOf(pkg) {
  try {
    return JSON.parse(readFileSync(join(PKG, "node_modules", pkg, "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
}

/**
 * Data files are ES modules (`export default <json>;`) with a one-line .d.ts beside them, not .json: TypeScript would
 * otherwise infer a type for every number in a 2 MB topology and run out of memory. manifest.json stays JSON (small).
 */
function writeData(name, value) {
  const file = join(OUT, `${name}.js`);
  writeFileSync(file, `export default ${JSON.stringify(value)};\n`);
  writeFileSync(join(OUT, `${name}.d.ts`), "declare const data: unknown;\nexport default data;\n");
  const size = statSync(file).size;
  log("wrote", `${name}.js`, kb(size));
  return size;
}

function writeJson(name, value) {
  const file = join(OUT, name);
  writeFileSync(file, JSON.stringify(value));
  return statSync(file).size;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const src = {};
  for (const key of Object.keys(SOURCES)) src[key] = await fetchSource(key);

  const areas = {};
  const tops = {};
  const polysByLevel = {};
  const sizes = {};
  for (const level of LEVELS) {
    const { shp, dbf } = unpackShapefile(level.src, src[level.src].file, src[level.src].buf);
    const topo = await simplifyLevel(level, shp, dbf);
    const { records, topology, polys } = processLevel(level, topo);
    areas[level.key] = records;
    tops[level.key] = topology;
    polysByLevel[level.key] = polys;
    sizes[`${level.key}.topo.js`] = writeData(`${level.key}.topo`, topology);
    log(level.key, records.length, "areas");
  }

  // Population by SA2: every SA2 with a shape needs a row.
  const pop = readPopulation(src.ERP.buf);
  const missing = areas.sa2.filter((a) => !pop.sa2[a.id]).map((a) => a.id);
  const extra = Object.keys(pop.sa2).filter((id) => !polysByLevel.sa2.has(id));
  log("population rows", Object.keys(pop.sa2).length, "; SA2 without a row:", missing.length, "; rows without a shape:", extra.length);
  if (missing.length) log("  SA2 with a shape and no population row:", missing.slice(0, 20).join(","));
  const popOut = {
    asAt: "2025-06-30",
    ageGroups: pop.ageGroups,
    /** SA2 code: [total, ...one number per age group]. */
    sa2: Object.fromEntries(Object.keys(pop.sa2).sort().map((id) => [id, pop.sa2[id]])),
  };
  sizes["population.js"] = writeData("population", popOut);

  const findSa2 = sa2Finder(polysByLevel.sa2, areas.sa2);
  const sal = unpackShapefile("SAL", src.SAL.file, src.SAL.buf);
  const suburbs = await readSuburbs(sal.dbf, sal.shp, findSa2);
  sizes["suburbs.js"] = writeData("suburbs", {
    cols: ["code", "name", "state", "lon", "lat", "sa2", "areaKm2"],
    rows: suburbs,
  });

  sizes["areas.js"] = writeData("areas", areas);

  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  // A short hash of the data files: the dashboard puts it in the URLs of the static boundary files, so a new
  // build of the data is never served from a stale browser cache.
  const hash = createHash("sha256");
  for (const f of ["ste.topo.js", "sa4.topo.js", "sa3.topo.js", "sa2.topo.js", "areas.js", "suburbs.js", "population.js"]) {
    hash.update(readFileSync(join(OUT, f)));
  }
  writeJson("manifest.json", {
    note: "Generated by scripts/build-data.mjs. Do not edit.",
    version: hash.digest("hex").slice(0, 10),
    sources: Object.fromEntries(Object.entries(src).map(([k, v]) => [k, { url: v.url, bytes: v.bytes, sha256: v.sha256 }])),
    tools: {
      node: process.version,
      shapefile: versionOf("shapefile"),
      "topojson-server": versionOf("topojson-server"),
      "topojson-simplify": versionOf("topojson-simplify"),
      fflate: versionOf("fflate"),
    },
    settings: {
      simplify: Object.fromEntries(LEVELS.map((l) => [l.key, `Visvalingam, triangles under ${l.interval} m x ${l.interval} m removed`])),
      quantization: QUANT,
    },
    counts: Object.fromEntries([...Object.entries(areas).map(([k, v]) => [k, v.length]), ["suburbs", suburbs.length]]),
    bytes: sizes,
  });
  log(`done: ${kb(total)} of data in ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
