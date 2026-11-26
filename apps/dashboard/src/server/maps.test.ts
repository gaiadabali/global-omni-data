import { areas, getArea, pointToSa2 } from "@god/geo";
import { cellToLatLng, latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import {
  handleActivity,
  handleActivityArea,
  handleArea,
  handleHotspots,
  handleInfluence,
  handleSummary,
  type ApiResult,
} from "./map-api";
import type { Viewer } from "./types";
import { viewerFromDevCookie } from "./viewer";

const viewer = (cookie: string): Viewer => {
  const v = viewerFromDevCookie(cookie);
  if (!v) throw new Error(cookie);
  return v;
};
const sp = (s: string) => new URLSearchParams(s);
const owner = viewer("owner");
const exec = viewer("executive");
const data = viewer("data");
const lead = viewer("brand_lead_yourtal");

const SYDNEY = "bbox=150.6,-34.2,151.5,-33.5";
const PARRAMATTA: [number, number] = [151.0035, -33.815];
const SA2 = pointToSa2(...PARRAMATTA)!;
const CELL7 = latLngToCell(PARRAMATTA[1], PARRAMATTA[0], 7);

async function ok<T>(p: Promise<ApiResult>): Promise<T> {
  const r = await p;
  expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
  return r.body as T;
}

interface PNumT {
  value: number;
  display: string;
  suppressed: boolean;
}
interface CellT {
  id: string;
  name: string;
  label: string;
  parent: string;
  centroid: [number, number];
  value: number;
  display: string;
  suppressed: boolean;
  population: number;
  band: number;
  trend: number[];
  newThisMonth: PNumT;
}
interface InfluenceT {
  query: { level: unknown };
  trendMonths: string[];
  cells: CellT[];
  legend: { label: string }[];
  truncated: boolean;
}
interface SummaryAreaT {
  rank: number;
  id: string;
  name: string;
  parent: string;
  value: number;
  display: string;
  suppressed: boolean;
  change: PNumT;
  changePct: number | null;
  trend: number[];
}
interface SummaryT {
  headline: { total: PNumT; newThisMonth: PNumT; growthPct: number | null; per1000: number | null };
  areas: SummaryAreaT[];
  movers: SummaryAreaT[];
  trendMonths: string[];
}
interface AreaT {
  area: { level: string; id: string; name: string; parent: string; parents: { level: string; id: string }[]; population: number };
  selection: {
    value: PNumT;
    per1000: number | null;
    nationalPer1000: number;
    newThisMonth: PNumT;
    rank: { rank: number | null; of: number; within: string };
  };
  brands: { brand: string; people: PNumT; businesses: PNumT }[];
  god: { people: PNumT; businesses: PNumT } | null;
  series: { months: string[]; values: number[] };
  ageMix: { band: string; teen: boolean; people: PNumT; share: number | null }[];
}
interface MixT {
  category: string;
  value?: number;
  display?: string;
  suppressed?: boolean;
  people?: PNumT;
  share: number | null;
}
interface HotspotsT {
  hotspots: { rank: number; id: string; name: string; parent: string; centroid: [number, number]; value: number; display: string; suppressed: boolean; mix: MixT[] }[];
}
interface ActivityAreaT {
  area: { level: string; id: string; name: string; parent: string };
  total: PNumT;
  categoryMix: MixT[];
  ageMix: { band: string; teen: boolean; people: PNumT; share: number | null }[];
  merchants: { id: string; name: string; suburb: string; category: string; value: number; display: string; suppressed: boolean }[];
}

function keysOf(o: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(o)) o.forEach((x) => keysOf(x, out));
  else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

describe("influence: real levels, names, trend and new this month", () => {
  it("serves state, sa4, sa3 and sa2 with real names and parents", async () => {
    const sa4 = await ok<InfluenceT>(handleInfluence(exec, sp("level=sa4")));
    expect(sa4.cells.length).toBeGreaterThanOrEqual(80);
    const para = sa4.cells.find((c) => c.name === "Sydney - Parramatta")!;
    expect(para.parent).toBe("Greater Sydney, NSW");
    expect(para.id).toBe("125");
    expect(para.label).toBe(para.name);
    expect(para.population).toBeGreaterThan(100_000);
    expect(sa4.legend[0]?.label).toBe("<10");

    const sa3 = await ok<InfluenceT>(handleInfluence(exec, sp("level=sa3")));
    expect(sa3.cells.length).toBeGreaterThanOrEqual(330);
    expect(sa3.cells.find((c) => c.name === "Parramatta")).toBeDefined();

    const sa2 = await ok<InfluenceT>(handleInfluence(exec, sp(`level=sa2&${SYDNEY}`)));
    expect(sa2.cells.length).toBeGreaterThan(100);
    const mine = sa2.cells.find((c) => c.id === SA2.id)!;
    expect(mine.name).toBe(SA2.name);
    expect(mine.parent).toBe("Greater Sydney, NSW");
    expect(mine.centroid).toEqual(SA2.centroid);
    expect(mine.trend).toHaveLength(12);
    expect(sa2.trendMonths).toHaveLength(12);
    expect(sa2.trendMonths.at(-1)).toBe("2026-11");
    // A running total never falls.
    for (let i = 1; i < mine.trend.length; i++) expect(mine.trend[i]!).toBeGreaterThanOrEqual(mine.trend[i - 1]!);
    expect(mine.trend.at(-1)).toBe(mine.value);
    expect(Object.keys(mine.newThisMonth).sort()).toEqual(["display", "suppressed", "value"]);
  });

  it("names an h3 cell for the suburb at its centre, with real parents", async () => {
    const r = await ok<InfluenceT>(handleInfluence(exec, sp(`level=h3&res=7&${SYDNEY}`)));
    expect(r.cells.length).toBeGreaterThan(500);
    const names = new Set(r.cells.map((c) => c.name));
    expect(names.has("Parramatta")).toBe(true);
    for (const c of r.cells) {
      expect(c.name).not.toMatch(/\d+\.\d+[SN]/); // never "Sydney area, 33.86S 151.24E"
      expect(c.name.length).toBeGreaterThan(1);
    }
    const para = r.cells.find((c) => c.id === CELL7);
    if (para) {
      expect(para.name).toBe("Parramatta");
      expect(para.parent).toBe("Greater Sydney, NSW");
    }
    // The centroid is the cell's centre.
    const c0 = r.cells[0]!;
    const [lat, lon] = cellToLatLng(c0.id);
    expect(c0.centroid[0]).toBeCloseTo(lon, 3);
    expect(c0.centroid[1]).toBeCloseTo(lat, 3);
  });

  it("refuses res 8 (no street level) and anything but 6 and 7", async () => {
    for (const res of [3, 4, 5, 8, 9]) {
      const r = await handleInfluence(owner, sp(`level=h3&res=${res}&${SYDNEY}`));
      expect(r.status, `res ${res}`).toBe(400);
    }
    expect((await handleActivity(owner, sp(`h3=8&${SYDNEY}`))).status).toBe(400);
    // An res 8 cell id is not an area either.
    const cell8 = latLngToCell(PARRAMATTA[1], PARRAMATTA[0], 8);
    expect((await handleArea(owner, sp(`level=h3&id=${cell8}`))).status).toBe(404);
    expect((await handleActivityArea(owner, sp(`level=h3&id=${cell8}`))).status).toBe(404);
  });

  it("applies the thresholds for the executive and shows small adult numbers to the owner", async () => {
    const q = "level=sa2&bbox=112,-45,155,-9&brand=ftr&month=2024-12";
    const e = await ok<InfluenceT>(handleInfluence(exec, sp(q)));
    const o = await ok<InfluenceT>(handleInfluence(owner, sp(q)));
    const d = await ok<InfluenceT>(handleInfluence(data, sp(q)));
    expect(e.cells.length).toBe(o.cells.length);
    let small = 0;
    e.cells.forEach((c, i) => {
      const oc = o.cells[i]!;
      if (c.suppressed) {
        small++;
        expect(c.display).toBe("<10");
        expect(c.value).toBe(0);
        expect(c.newThisMonth.display).toMatch(/^<10$/);
        expect(c.trend.every((v) => v === 0 || v >= 10)).toBe(true);
        expect(oc.suppressed).toBe(true);
        expect(oc.display).toBe(String(oc.value));
      } else {
        expect(c.value).toBeGreaterThanOrEqual(10);
      }
      for (const t of c.trend) expect(t === 0 || t >= 10).toBe(true);
    });
    expect(small).toBeGreaterThan(100);
    expect(o.cells.some((c) => c.suppressed && c.value > 0)).toBe(true);
    expect(d.cells.filter((c) => c.suppressed).length).toBe(small);
  });

  it("scopes a brand lead to their brand, at every new level", async () => {
    for (const level of ["state", "sa4", "sa3"]) {
      expect((await handleInfluence(lead, sp(`level=${level}&brand=ftr`))).status).toBe(403);
      expect((await handleInfluence(lead, sp(`level=${level}&brand=all`))).status).toBe(403);
      expect((await handleInfluence(lead, sp(`level=${level}&brand=yourtal`))).status).toBe(200);
    }
    expect((await handleInfluence(lead, sp(`level=sa2&${SYDNEY}&brand=snapapp`))).status).toBe(403);
    expect((await handleInfluence(lead, sp(`level=h3&res=6&${SYDNEY}&brand=yourtal`))).status).toBe(200);
  });
});

describe("summary", () => {
  it("gives headline totals, a ranked list with sparklines, and the top movers", async () => {
    const s = await ok<SummaryT>(handleSummary(exec, sp("level=sa4&limit=10")));
    expect(s.headline.total.value).toBeGreaterThan(400_000);
    expect(s.headline.newThisMonth.value).toBeGreaterThan(0);
    expect(s.headline.growthPct).not.toBeNull();
    expect(s.headline.per1000).toBeGreaterThan(5);
    expect(s.areas).toHaveLength(10);
    s.areas.forEach((a, i) => {
      expect(a.rank).toBe(i + 1);
      expect(a.trend).toHaveLength(12);
      expect(a.name.length).toBeGreaterThan(1);
      if (i > 0) expect(a.value).toBeLessThanOrEqual(s.areas[i - 1]!.value);
    });
    expect(s.movers.length).toBeGreaterThan(0);
    expect(s.movers.length).toBeLessThanOrEqual(5);
    for (const m of s.movers) expect(m.change.suppressed).toBe(false);
    for (let i = 1; i < s.movers.length; i++) expect(s.movers[i]!.change.value).toBeLessThanOrEqual(s.movers[i - 1]!.change.value);
  });

  it("ranks per 1,000 by rate", async () => {
    const s = await ok<SummaryT>(handleSummary(exec, sp("level=sa3&measure=per1000&limit=20")));
    for (let i = 1; i < s.areas.length; i++) expect(s.areas[i]!.value).toBeLessThanOrEqual(s.areas[i - 1]!.value);
    for (const a of s.areas) if (!a.suppressed) expect(a.display).toMatch(/^\d+\.\d\d$/);
  });

  it("applies thresholds: hidden areas sort last by id, and show no growth figure", async () => {
    const q = "level=sa2&brand=ftr&month=2024-12&limit=100";
    const e = await ok<SummaryT>(handleSummary(exec, sp(q)));
    const o = await ok<SummaryT>(handleSummary(owner, sp(q)));
    const hiddenE = e.areas.filter((a) => a.suppressed);
    expect(hiddenE.length).toBeGreaterThan(0);
    for (const a of hiddenE) {
      expect(a.display).toBe("<10");
      expect(a.value).toBe(0);
    }
    for (const a of e.areas) if (a.change.suppressed) expect(a.changePct).toBeNull();
    const ids = hiddenE.map((a) => a.id);
    expect(ids).toEqual([...ids].sort());
    // The owner sees the exact small number, marked.
    expect(o.areas.some((a) => a.suppressed && a.value > 0 && a.value < 10)).toBe(true);
    // A suppressed area is never in the movers.
    for (const m of e.movers) expect(m.suppressed || !m.change.suppressed).toBe(true);
  });

  it("limits a brand lead to their own brand", async () => {
    expect((await handleSummary(lead, sp("brand=all"))).status).toBe(403);
    expect((await handleSummary(lead, sp("brand=ftr&level=sa4"))).status).toBe(403);
    const own = await ok<SummaryT>(handleSummary(lead, sp("brand=yourtal&level=sa4")));
    const all = await ok<SummaryT>(handleSummary(owner, sp("brand=all&level=sa4")));
    expect(own.headline.total.value).toBeLessThan(all.headline.total.value);
  });
});

describe("area detail", () => {
  it("describes an SA2: name, parent chain, population, series, brands, GOD, age mix, rank", async () => {
    const a = await ok<AreaT>(handleArea(exec, sp(`level=sa2&id=${SA2.id}`)));
    expect(a.area.name).toBe(SA2.name);
    expect(a.area.parent).toBe("Greater Sydney, NSW");
    expect(a.area.parents.map((p) => p.level)).toEqual(["sa3", "sa4", "state"]);
    expect(a.area.population).toBe(SA2.population);
    expect(a.series.months).toHaveLength(24);
    expect(a.series.values).toHaveLength(24);
    expect(a.series.values.at(-1)).toBe(a.selection.value.value);
    expect(a.brands.map((b) => b.brand)).toEqual(["yourtal", "snapapp", "ftr"]);
    expect(a.god).not.toBeNull();
    expect(a.selection.nationalPer1000).toBeGreaterThan(5);
    expect(a.selection.rank.of).toBeGreaterThan(1);
    expect(a.selection.rank.rank).toBeGreaterThanOrEqual(1);
    expect(a.selection.rank.within.length).toBeGreaterThan(1);
    expect(a.ageMix.map((x) => x.band)).toEqual(["13–17", "18–24", "25–34", "35–44", "45–54", "55–64", "65+"]);
    expect(a.ageMix[0]!.teen).toBe(true);
    expect(a.ageMix.slice(1).every((x) => !x.teen)).toBe(true);
  });

  it("describes a state, an SA4, and an h3 cell", async () => {
    const st = await ok<AreaT>(handleArea(exec, sp("level=state&id=NSW")));
    expect(st.area.name).toBe("New South Wales");
    expect(st.area.parent).toBe("Australia");
    expect(st.selection.rank.of).toBe(8);
    const sa4 = await ok<AreaT>(handleArea(exec, sp("level=sa4&id=125")));
    expect(sa4.area.parents.map((p) => p.level)).toEqual(["state"]);
    const cell = await ok<AreaT>(handleArea(exec, sp(`level=h3&id=${CELL7}`)));
    expect(cell.area.name).toBe("Parramatta");
    expect(cell.area.parent).toBe("Greater Sydney, NSW");
    expect(cell.area.parents[0]!.level).toBe("sa2");
    expect(cell.area.population).toBeGreaterThan(0);
  });

  it("is a 404 for an unknown area, and a 400 for a bad id or level", async () => {
    expect((await handleArea(exec, sp("level=sa2&id=999999999"))).status).toBe(404);
    expect((await handleArea(exec, sp("level=state&id=OT"))).status).toBe(404);
    expect((await handleArea(exec, sp("level=sa2&id=../etc"))).status).toBe(400);
    expect((await handleArea(exec, sp("level=street&id=1"))).status).toBe(400);
    expect((await handleArea(exec, sp("id=NSW"))).status).toBe(400);
  });

  it("hides a small count from the executive, with no per-1,000 and no rank, and shows it to the owner", async () => {
    // Find an SA2 with a few FTR people in December 2024.
    const s = await ok<SummaryT>(handleSummary(owner, sp("level=sa2&brand=ftr&month=2024-12&limit=100")));
    const tiny = s.areas.find((a) => a.suppressed && a.value > 0)!;
    expect(tiny).toBeDefined();
    const q = `level=sa2&id=${tiny.id}&brand=ftr&month=2024-12`;
    const e = await ok<AreaT>(handleArea(exec, sp(q)));
    const o = await ok<AreaT>(handleArea(owner, sp(q)));
    expect(e.selection.value).toEqual({ value: 0, display: "<10", suppressed: true });
    expect(e.selection.per1000).toBeNull();
    expect(e.selection.rank.rank).toBeNull();
    expect(e.series.values.every((v) => v === 0 || v >= 10)).toBe(true);
    expect(o.selection.value.value).toBe(tiny.value);
    expect(o.selection.value.suppressed).toBe(true);
    expect(o.selection.rank.rank).not.toBeNull();
    // Hidden shares: a suppressed band has no share, so it cannot be worked out from the others.
    for (const band of e.ageMix) if (band.people.suppressed) expect(band.share).toBeNull();
  });

  it("keeps teen figures at 20 or more", async () => {
    const q = `level=sa4&id=125&brand=snapapp`;
    const e = await ok<AreaT>(handleArea(exec, sp(q)));
    const teen = e.ageMix[0]!;
    expect(teen.teen).toBe(true);
    expect(teen.people.suppressed ? teen.people.display === "<20" : teen.people.value >= 20).toBe(true);
    // The owner gets no teen figure under 20 either.
    const small = await ok<AreaT>(handleArea(owner, sp("level=sa2&id=" + SA2.id + "&brand=ftr&month=2024-12")));
    const t = small.ageMix[0]!.people;
    if (t.suppressed) expect([t.display, t.value]).toEqual(["<20", 0]);
    else expect(t.value).toBeGreaterThanOrEqual(20);
    // FTR has no teens at all.
    const ftr = await ok<AreaT>(handleArea(owner, sp("level=state&id=NSW&brand=ftr")));
    expect(ftr.ageMix[0]!.people.display).toBe("<20");
  });

  it("shows a brand lead only their own brand, never the GOD total", async () => {
    expect((await handleArea(lead, sp("level=sa4&id=125&brand=all"))).status).toBe(403);
    expect((await handleArea(lead, sp("level=sa4&id=125&brand=snapapp"))).status).toBe(403);
    const a = await ok<AreaT>(handleArea(lead, sp("level=sa4&id=125&brand=yourtal")));
    expect(a.brands.map((b) => b.brand)).toEqual(["yourtal"]);
    expect(a.god).toBeNull();
    expect(JSON.stringify(a)).not.toMatch(/snapapp|"ftr"/);
  });

  it("returns no ageMix for a businesses-only selection", async () => {
    const a = await ok<AreaT>(handleArea(exec, sp("level=state&id=NSW&audience=businesses")));
    expect(a.ageMix).toEqual([]);
  });
});

describe("activity: heat names, hotspots and area detail", () => {
  it("names the heat cells for suburbs", async () => {
    const r = await ok<{ heat: { id: string; name: string; parent: string; centroid: [number, number] }[] }>(
      handleActivity(exec, sp(`h3=7&${SYDNEY}`)),
    );
    expect(r.heat.length).toBeGreaterThan(100);
    expect(r.heat.some((h) => h.name === "Parramatta")).toBe(true);
    for (const h of r.heat) {
      expect(h.name).not.toMatch(/\d+\.\d+[SN]/);
      expect(h.parent).toMatch(/, [A-Z]+$|^Rest of|Territory/);
    }
  });

  it("ranks the top activity areas with a suburb name and a category mix", async () => {
    const h = await ok<HotspotsT>(handleHotspots(exec, sp(`${SYDNEY}&limit=10`)));
    expect(h.hotspots).toHaveLength(10);
    h.hotspots.forEach((x, i) => {
      expect(x.rank).toBe(i + 1);
      expect(x.suppressed).toBe(false);
      expect(x.value).toBeGreaterThanOrEqual(10);
      expect(x.name.length).toBeGreaterThan(1);
      expect(x.parent).toBe("Greater Sydney, NSW");
      expect(x.mix.map((m) => m.category)).toEqual(["fuel", "groc", "cafe", "retail", "pharm", "ent"]);
      if (i > 0) expect(x.value).toBeLessThanOrEqual(h.hotspots[i - 1]!.value);
      for (const m of x.mix) if (m.suppressed) expect(m.share).toBeNull();
    });
    expect(h.hotspots.length).toBeLessThanOrEqual(50);
  });

  it("keeps teens at 20 or more and drops sensitive categories from teen hotspots", async () => {
    const h = await ok<HotspotsT>(handleHotspots(exec, sp("ageBand=13-17&limit=30")));
    expect(h.hotspots.length).toBeGreaterThan(0);
    for (const x of h.hotspots) {
      expect(x.value).toBeGreaterThanOrEqual(20);
      expect(x.mix.some((m) => m.category === "pharm")).toBe(false);
      for (const m of x.mix) expect(m.suppressed ? m.display === "<20" : (m.value ?? 0) >= 20).toBe(true);
    }
    expect((await handleHotspots(exec, sp("ageBand=13-17&category=pharm"))).status).toBe(400);
  });

  it("limits a brand lead's hotspots to people who also use their brand", async () => {
    const mine = await ok<HotspotsT>(handleHotspots(lead, sp(`${SYDNEY}&limit=5`)));
    const all = await ok<HotspotsT>(handleHotspots(owner, sp(`${SYDNEY}&limit=5`)));
    expect(mine.hotspots[0]!.value).toBeLessThan(all.hotspots[0]!.value);
  });

  it("describes one heat cell: category mix, age mix and top merchants", async () => {
    const a = await ok<ActivityAreaT>(handleActivityArea(exec, sp(`level=h3&id=${latLngToCell(-33.815, 151.0035, 6)}`)));
    expect(a.area.name.length).toBeGreaterThan(1);
    expect(a.area.parent).toBe("Greater Sydney, NSW");
    expect(a.total.value).toBeGreaterThan(10);
    expect(a.categoryMix.map((m) => m.category)).toEqual(["fuel", "groc", "cafe", "retail", "pharm", "ent"]);
    expect(a.ageMix.map((m) => m.band)).toEqual(["13–17", "18–24", "25–34", "35–44", "45–54", "55–64", "65+"]);
    expect(a.merchants.length).toBeGreaterThan(0);
    expect(a.merchants.length).toBeLessThanOrEqual(10);
    for (const m of a.merchants) expect(m.suburb.length).toBeGreaterThan(1);
    for (let i = 1; i < a.merchants.length; i++) {
      if (!a.merchants[i]!.suppressed && !a.merchants[i - 1]!.suppressed) {
        expect(a.merchants[i]!.value).toBeLessThanOrEqual(a.merchants[i - 1]!.value);
      }
    }
  });

  it("describes one SA2 the same way", async () => {
    const a = await ok<ActivityAreaT>(handleActivityArea(exec, sp(`level=sa2&id=${SA2.id}`)));
    expect(a.area.name).toBe(SA2.name);
    expect(a.categoryMix).toHaveLength(6);
    expect((await handleActivityArea(exec, sp("level=sa2&id=999999999"))).status).toBe(404);
    expect((await handleActivityArea(exec, sp("level=sa4&id=125"))).status).toBe(400);
  });

  it("applies the teen rules in area detail: no sensitive category, and the teen band never beside one", async () => {
    const cell = latLngToCell(-33.815, 151.0035, 6);
    const teen = await ok<ActivityAreaT>(handleActivityArea(exec, sp(`level=h3&id=${cell}&ageBand=13-17`)));
    expect(teen.categoryMix.some((m) => m.category === "pharm")).toBe(false);
    for (const m of teen.categoryMix) expect(m.people?.suppressed ? m.people.display === "<20" : (m.people?.value ?? 0) >= 20).toBe(true);
    expect(teen.total.suppressed ? teen.total.display === "<20" : teen.total.value >= 20).toBe(true);
    for (const shop of teen.merchants) expect(shop.category).not.toBe("pharm");
    const pharm = await ok<ActivityAreaT>(handleActivityArea(exec, sp(`level=h3&id=${cell}&category=pharm`)));
    expect(pharm.ageMix.some((m) => m.teen)).toBe(false);
    expect((await handleActivityArea(exec, sp(`level=h3&id=${cell}&ageBand=13-17&category=pharm`))).status).toBe(400);
  });

  it("limits a brand lead's activity area to people who also use their brand", async () => {
    const q = `level=h3&id=${latLngToCell(-33.815, 151.0035, 6)}`;
    const mine = await ok<ActivityAreaT>(handleActivityArea(lead, sp(q)));
    const all = await ok<ActivityAreaT>(handleActivityArea(owner, sp(q)));
    expect(mine.total.value).toBeLessThan(all.total.value);
  });
});

describe("no person-level data in any response", () => {
  it("has no person, profile or contact fields, and no lat/lon outside merchants", async () => {
    const bodies: unknown[] = [
      await ok(handleInfluence(owner, sp("level=state"))),
      await ok(handleInfluence(owner, sp(`level=sa2&${SYDNEY}`))),
      await ok(handleInfluence(owner, sp(`level=h3&res=7&${SYDNEY}`))),
      await ok(handleSummary(owner, sp("level=sa2"))),
      await ok(handleArea(owner, sp(`level=sa2&id=${SA2.id}`))),
      await ok(handleArea(owner, sp(`level=h3&id=${CELL7}`))),
      await ok(handleHotspots(owner, sp(`${SYDNEY}`))),
      await ok(handleActivityArea(owner, sp(`level=h3&id=${CELL7}`))),
      await ok(handleActivity(owner, sp(`h3=7&${SYDNEY}`))),
    ];
    const forbidden = ["person", "personId", "profile", "email", "phone", "userId", "mobile", "dob", "address"];
    for (const b of bodies) {
      const keys = keysOf(b);
      for (const f of forbidden) expect(keys.has(f), f).toBe(false);
    }
    // lat and lon exist only on merchants (businesses); everything else is a centroid of an area or an h3 cell.
    for (const b of bodies.slice(0, 8)) {
      const withoutMerchants = JSON.stringify(b, (k, v) => (k === "merchants" ? undefined : v));
      expect(withoutMerchants).not.toMatch(/"lat":|"lon":/);
    }
  });

  it("only ever returns areas the geography knows", async () => {
    const r = await ok<InfluenceT>(handleInfluence(owner, sp(`level=sa2&${SYDNEY}`)));
    for (const c of r.cells) expect(getArea("sa2", c.id)).toBeDefined();
    expect(areas("sa2").length).toBeGreaterThan(2400);
  });
});
