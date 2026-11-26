import { mkdirSync, writeFileSync } from "node:fs";
import { pointToSa2 } from "@god/geo";
import { latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import {
  API_HEADERS,
  handleActivity,
  handleActivityArea,
  handleArea,
  handleHotspots,
  handleInfluence,
  handleSummary,
  mapMeta,
  parseActivityQuery,
  parseInfluenceQuery,
  parseSummaryQuery,
  type ApiResult,
} from "./map-api";
import type { Viewer } from "./types";
import { warmSynthetic } from "./data/synthetic";
import { viewerFromDevCookie } from "./viewer";

const viewer = (cookie: string): Viewer => {
  const v = viewerFromDevCookie(cookie);
  if (!v) throw new Error(cookie);
  return v;
};
const sp = (s: string) => new URLSearchParams(s);

describe("query validation", () => {
  it("accepts the defaults", () => {
    const q = parseInfluenceQuery(sp(""));
    expect(q).toEqual({
      ok: true,
      value: { brand: "all", audience: "both", measure: "count", month: "2026-11", level: "state" },
    });
  });

  it.each([
    ["brand=nope", /brand/],
    ["audience=everyone", /audience/],
    ["measure=ratio", /measure/],
    ["month=2026-13", /month/],
    ["month=2020-01", /month/],
    ["month=Nov", /month/],
    ["level=hex", /level/],
    ["level=street", /level/],
    ["level=sa2", /bbox is required/],
    ["level=h3&res=6", /bbox is required/],
    ["level=h3&res=2&bbox=151,-34,151.3,-33.7", /res must be 6 or 7/],
    ["level=h3&res=5&bbox=151,-34,151.3,-33.7", /res must be 6 or 7/],
    ["level=h3&res=8&bbox=151,-34,151.3,-33.7", /res must be 6 or 7/],
    ["level=h3&res=9&bbox=151,-34,151.3,-33.7", /res must be 6 or 7/],
    ["level=h3&res=x&bbox=151,-34,151.3,-33.7", /res/],
    ["bbox=1,2,3", /bbox/],
    ["bbox=a,b,c,d", /bbox/],
    ["bbox=,,,", /bbox/],
    ["bbox=150,-30,140,-20", /west < east/],
    ["bbox=100,-30,200,-20", /outside/],
  ])("rejects influence %s", (qs, message) => {
    const r = parseInfluenceQuery(sp(qs));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("accepts every area level, and a good h3 query at res 6 and 7", () => {
    for (const level of ["state", "sa4", "sa3"]) {
      expect(parseInfluenceQuery(sp(`level=${level}`)).ok).toBe(true);
    }
    expect(parseInfluenceQuery(sp("level=sa2&bbox=151,-34,151.3,-33.7")).ok).toBe(true);
    const r = parseInfluenceQuery(sp("brand=yourtal&level=h3&res=7&bbox=151,-34,151.3,-33.7&measure=per1000"));
    expect(r).toEqual({
      ok: true,
      value: {
        brand: "yourtal",
        audience: "both",
        measure: "per1000",
        month: "2026-11",
        level: { h3: 7 },
        bbox: [151, -34, 151.3, -33.7],
      },
    });
    const r6 = parseInfluenceQuery(sp("level=h3&res=6&bbox=151,-34,151.3,-33.7"));
    expect(r6.ok && r6.value.level).toEqual({ h3: 6 });
  });

  it.each([
    ["category=beer", /category/],
    ["ageBand=40s", /ageBand/],
    ["h3=4", /h3/],
    ["h3=8&bbox=151,-34,151.3,-33.7", /h3 must be 5, 6 or 7/],
    ["h3=7", /bbox is required/],
    ["ageBand=13-17&category=pharm&h3=5", /sensitive/],
    ["month=2027-01", /month/],
  ])("rejects activity %s", (qs, message) => {
    const r = parseActivityQuery(sp(qs));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("takes a plain hyphen for the teen band", () => {
    const r = parseActivityQuery(sp("ageBand=13-17&h3=6"));
    expect(r.ok && r.value.ageBand).toBe("13–17");
  });

  it("validates the summary query", () => {
    expect(parseSummaryQuery(sp(""))).toEqual({
      ok: true,
      value: { brand: "all", audience: "both", measure: "count", month: "2026-11", level: "state", limit: 20 },
    });
    for (const qs of ["level=h3", "level=street", "limit=0", "limit=101", "limit=x"]) {
      expect(parseSummaryQuery(sp(qs)).ok, qs).toBe(false);
    }
  });
});

describe("access", () => {
  it("401 with nobody signed in, on every endpoint", async () => {
    expect((await handleInfluence(null, sp(""))).status).toBe(401);
    expect((await handleActivity(null, sp("h3=5"))).status).toBe(401);
    expect((await handleSummary(null, sp(""))).status).toBe(401);
    expect((await handleArea(null, sp("level=state&id=NSW"))).status).toBe(401);
    expect((await handleHotspots(null, sp(""))).status).toBe(401);
    expect((await handleActivityArea(null, sp("level=sa2&id=1"))).status).toBe(401);
  });

  it("403 when a brand lead asks about another brand or all", async () => {
    const sam = viewer("brand_lead_yourtal");
    expect((await handleInfluence(sam, sp("brand=snapapp"))).status).toBe(403);
    expect((await handleInfluence(sam, sp("brand=all"))).status).toBe(403);
    expect((await handleInfluence(sam, sp("brand=yourtal"))).status).toBe(200);
  });

  it("400 for a bad query, before any data is read", async () => {
    expect((await handleInfluence(viewer("owner"), sp("month=bad"))).status).toBe(400);
  });

  it("sends private, per-viewer, no-cache headers", () => {
    expect(API_HEADERS["Cache-Control"]).toContain("private");
    expect(API_HEADERS.Vary).toBe("Cookie");
  });

  it("a brand lead's activity map is limited to their brand's audience", async () => {
    const sam = viewer("brand_lead_yourtal");
    const a = await handleActivity(sam, sp("h3=5"));
    const o = await handleActivity(viewer("owner"), sp("h3=5"));
    expect(a.status).toBe(200);
    const total = (r: { body: unknown }) =>
      (r.body as { heat: { value: number; suppressed: boolean }[] }).heat.reduce(
        (s, h) => s + (h.suppressed ? 0 : h.value),
        0,
      );
    expect(total(a)).toBeLessThan(total(o));
  });
});

describe("the map meta", () => {
  it("names the boundary files, with the data version in the URL", () => {
    const m = mapMeta();
    expect(m.geo.version).toMatch(/^[0-9a-f]{10}$/);
    for (const level of ["state", "sa4", "sa3", "sa2"] as const) {
      expect(m.geo.levels[level]).toBe(`/geo/${level}.json?v=${m.geo.version}`);
    }
  });
});

/* ---------------- timing: target p95 under 300 ms on the sample ---------------- */

const SYDNEY = "bbox=150.6,-34.2,151.5,-33.5";
const SEQ = "bbox=152.6,-28.4,153.7,-26.8";
const PARRAMATTA_SA2 = pointToSa2(151.0035, -33.815)!.id;
const PARRAMATTA_CELL7 = latLngToCell(-33.815, 151.0035, 7);
const PARRAMATTA_CELL6 = latLngToCell(-33.815, 151.0035, 6);

type Kind = "i" | "a" | "s" | "r" | "h" | "x";
const HANDLERS: Record<Kind, (v: Viewer, q: URLSearchParams) => Promise<ApiResult>> = {
  i: handleInfluence,
  a: handleActivity,
  s: handleSummary,
  r: handleArea,
  h: handleHotspots,
  x: handleActivityArea,
};

const QUERIES: [string, Kind, string][] = [
  ["influence state count", "i", "level=state"],
  ["influence state per1000", "i", "level=state&measure=per1000&brand=yourtal"],
  ["influence sa4 all", "i", "level=sa4"],
  ["influence sa3 all", "i", "level=sa3&brand=snapapp"],
  ["influence sa2 national", "i", "level=sa2&bbox=112,-45,155,-9"],
  ["influence sa2 Sydney", "i", `level=sa2&${SYDNEY}&brand=ftr`],
  ["influence sa2 per1000", "i", `level=sa2&${SYDNEY}&measure=per1000`],
  ["influence h3 6 national", "i", "level=h3&res=6&bbox=112,-45,155,-9&brand=yourtal&audience=people"],
  ["influence h3 6 Sydney per1000", "i", `level=h3&res=6&${SYDNEY}&measure=per1000`],
  ["influence h3 7 Sydney", "i", `level=h3&res=7&${SYDNEY}`],
  ["influence h3 7 SE Qld per1000", "i", `level=h3&res=7&${SEQ}&measure=per1000`],
  ["summary state", "s", "level=state"],
  ["summary sa4", "s", "level=sa4&brand=snapapp"],
  ["summary sa3 per1000", "s", "level=sa3&measure=per1000"],
  ["summary sa2", "s", "level=sa2&limit=50"],
  ["area state", "r", "level=state&id=NSW"],
  ["area sa4", "r", "level=sa4&id=125"],
  ["area sa2", "r", `level=sa2&id=${PARRAMATTA_SA2}&brand=yourtal`],
  ["area h3 7", "r", `level=h3&id=${PARRAMATTA_CELL7}`],
  ["area h3 6", "r", `level=h3&id=${PARRAMATTA_CELL6}&audience=people`],
  ["activity h3 5 all", "a", "h3=5"],
  ["activity h3 6 teens", "a", "h3=6&ageBand=13-17"],
  ["activity h3 7 Sydney cafe", "a", `h3=7&category=cafe&${SYDNEY}`],
  ["activity h3 7 Sydney", "a", `h3=7&${SYDNEY}`],
  ["activity h3 7 SE Qld 25-34", "a", `h3=7&ageBand=25-34&${SEQ}`],
  ["hotspots national", "h", ""],
  ["hotspots Sydney cafe", "h", `category=cafe&${SYDNEY}`],
  ["hotspots teens", "h", "ageBand=13-17&limit=20"],
  ["activity area h3 7", "x", `level=h3&id=${PARRAMATTA_CELL7}`],
  ["activity area h3 5 teens", "x", `level=h3&id=${latLngToCell(-33.815, 151.0035, 5)}&ageBand=13-17`],
  ["activity area sa2", "x", `level=sa2&id=${PARRAMATTA_SA2}&category=groc`],
];

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

describe("timings", () => {
  it("p95 under 300 ms for every map query on the sample", async () => {
    const who = viewer("executive");
    // Warm up, as the server does in the background at start: builds the sample and every index.
    const warmStart = performance.now();
    warmSynthetic();
    const warm = performance.now() - warmStart;

    const rows: Record<string, string | number>[] = [];
    const all: number[] = [];
    for (const [name, kind, qs] of QUERIES) {
      const times: number[] = [];
      let cells = 0;
      for (let i = 0; i < 20; i++) {
        const t0 = performance.now();
        const r = await HANDLERS[kind](who, sp(qs));
        const json = JSON.stringify(r.body); // the route serialises the body
        times.push(performance.now() - t0);
        expect(r.status, name).toBe(200);
        if (i === 0) {
          const b = r.body as { cells?: unknown[]; heat?: unknown[]; merchants?: unknown[]; areas?: unknown[]; hotspots?: unknown[] };
          cells = (b.cells ?? b.heat ?? b.areas ?? b.hotspots ?? []).length + (b.merchants?.length ?? 0);
          expect(json.length).toBeGreaterThan(20);
        }
      }
      times.sort((a, b) => a - b);
      all.push(...times);
      rows.push({
        query: name,
        items: cells,
        "p50 ms": Math.round(pct(times, 0.5)),
        "p95 ms": Math.round(pct(times, 0.95)),
        "max ms": Math.round(times[times.length - 1]!),
      });
    }
    all.sort((a, b) => a - b);
    console.log(`TIMINGS cold start warm-up (sample and all indexes, once per server start): ${Math.round(warm)} ms`);
    console.table(rows);
    // Also written to a file, because the build log hides the output of passing tests.
    mkdirSync("node_modules/.cache", { recursive: true });
    writeFileSync(
      "node_modules/.cache/god-timings.txt",
      [`cold start warm-up ${Math.round(warm)} ms`, ...rows.map((r) => JSON.stringify(r))].join("\n"),
    );
    console.log(`TIMINGS overall p50 ${Math.round(pct(all, 0.5))} ms, p95 ${Math.round(pct(all, 0.95))} ms over ${all.length} calls`);
    for (const r of rows) expect(r["p95 ms"], String(r.query)).toBeLessThan(300);
    expect(pct(all, 0.95)).toBeLessThan(300);
  });
});
