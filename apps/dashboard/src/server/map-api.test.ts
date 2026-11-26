import { describe, expect, it } from "vitest";
import { API_HEADERS, handleActivity, handleInfluence, parseActivityQuery, parseInfluenceQuery } from "./map-api";
import type { Viewer } from "./types";
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
    ["level=h3&res=2", /res/],
    ["level=h3&res=9", /res/],
    ["level=h3&res=x", /res/],
    ["level=h3&res=8", /bbox is required/],
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

  it("accepts a good h3 query", () => {
    const r = parseInfluenceQuery(sp("brand=yourtal&level=h3&res=8&bbox=151,-34,151.3,-33.7&measure=per1000"));
    expect(r).toEqual({
      ok: true,
      value: {
        brand: "yourtal",
        audience: "both",
        measure: "per1000",
        month: "2026-11",
        level: { h3: 8 },
        bbox: [151, -34, 151.3, -33.7],
      },
    });
  });

  it.each([
    ["category=beer", /category/],
    ["ageBand=40s", /ageBand/],
    ["h3=4", /h3/],
    ["h3=8", /bbox is required/],
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
});

describe("access", () => {
  it("401 with nobody signed in, on both endpoints", async () => {
    expect((await handleInfluence(null, sp(""))).status).toBe(401);
    expect((await handleActivity(null, sp("h3=5"))).status).toBe(401);
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

/* ---------------- timing: target p95 under 300 ms on the sample ---------------- */

const SYDNEY = "bbox=150.6,-34.2,151.5,-33.5";
const SEQ = "bbox=152.6,-28.4,153.7,-26.8";
const QUERIES: [string, "i" | "a", string][] = [
  ["influence state count", "i", "level=state"],
  ["influence state per1000", "i", "level=state&measure=per1000&brand=yourtal"],
  ["influence h3 3 all", "i", "level=h3&res=3"],
  ["influence h3 4 all", "i", "level=h3&res=4&brand=snapapp"],
  ["influence h3 5 all", "i", "level=h3&res=5"],
  ["influence h3 6 all", "i", "level=h3&res=6&brand=yourtal&audience=people"],
  ["influence h3 6 per1000", "i", "level=h3&res=6&measure=per1000"],
  ["influence h3 7 Sydney", "i", `level=h3&res=7&${SYDNEY}`],
  ["influence h3 8 Sydney", "i", `level=h3&res=8&${SYDNEY}&brand=ftr`],
  ["influence h3 8 SE Qld per1000", "i", `level=h3&res=8&${SEQ}&measure=per1000`],
  ["activity h3 5 all", "a", "h3=5"],
  ["activity h3 6 teens", "a", "h3=6&ageBand=13-17"],
  ["activity h3 7 Sydney cafe", "a", `h3=7&category=cafe&${SYDNEY}`],
  ["activity h3 8 Sydney", "a", `h3=8&${SYDNEY}`],
  ["activity h3 8 SE Qld 25-34", "a", `h3=8&ageBand=25-34&${SEQ}`],
];

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

describe("timings", () => {
  it("p95 under 300 ms for every map query on the sample", async () => {
    const who = viewer("executive");
    // Warm up: builds the sample and the h3 indexes once.
    const warmStart = performance.now();
    await handleInfluence(who, sp("level=h3&res=8&" + SYDNEY));
    await handleActivity(who, sp("h3=8&" + SYDNEY));
    const warm = performance.now() - warmStart;

    const rows: Record<string, string | number>[] = [];
    const all: number[] = [];
    for (const [name, kind, qs] of QUERIES) {
      const times: number[] = [];
      let cells = 0;
      for (let i = 0; i < 12; i++) {
        const t0 = performance.now();
        const r = kind === "i" ? await handleInfluence(who, sp(qs)) : await handleActivity(who, sp(qs));
        const json = JSON.stringify(r.body); // the route serialises the body
        times.push(performance.now() - t0);
        expect(r.status).toBe(200);
        if (i === 0) {
          const b = r.body as { cells?: unknown[]; heat?: unknown[]; merchants?: unknown[] };
          cells = (b.cells ?? b.heat ?? []).length + (b.merchants?.length ?? 0);
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
      expect(pct(times, 0.95)).toBeLessThan(300);
    }
    all.sort((a, b) => a - b);
    console.log(`TIMINGS first call (builds the sample and indexes): ${Math.round(warm)} ms`);
    console.table(rows);
    console.log(`TIMINGS overall p50 ${Math.round(pct(all, 0.5))} ms, p95 ${Math.round(pct(all, 0.95))} ms over ${all.length} calls`);
    expect(pct(all, 0.95)).toBeLessThan(300);
  });
});
