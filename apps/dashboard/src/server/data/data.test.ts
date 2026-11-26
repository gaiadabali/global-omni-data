import { describe, expect, it } from "vitest";
import { viewerFromDevCookie } from "../viewer";
import type { Viewer } from "../types";
import { DataAccessError, getDashboardData } from "./index";
import type { InfluenceQuery } from "./types";

const viewer = (cookie: string): Viewer => {
  const v = viewerFromDevCookie(cookie);
  if (!v) throw new Error(cookie);
  return v;
};

const smallCells: InfluenceQuery = {
  brand: "ftr",
  audience: "both",
  measure: "count",
  month: "2024-12",
  level: { h3: 5 },
};

describe("presentation layer", () => {
  it("leaves no raw marker in anything a page receives", async () => {
    const d = getDashboardData(viewer("executive"));
    const all = JSON.stringify([
      await d.overview({ period: "month" }),
      await d.brand("yourtal", { period: "quarter" }),
      await d.brand("snapapp", { period: "ytd" }),
      await d.brand("ftr", { period: "week" }),
    ]);
    expect(all).not.toContain("__raw");
  });

  it("gives every count the shape { value, display, suppressed }", async () => {
    const o = await getDashboardData(viewer("executive")).overview({ period: "month" });
    expect(Object.keys(o.people).sort()).toEqual(["display", "suppressed", "value"]);
    expect(o.people.suppressed).toBe(false);
    expect(o.peopleSeries).toHaveLength(24);
    expect(o.growth.series).toHaveLength(4);
  });

  it("hides small cells from an executive and shows them to the owner and data team", async () => {
    const exec = await getDashboardData(viewer("executive")).influenceMap(smallCells);
    const owner = await getDashboardData(viewer("owner")).influenceMap(smallCells);
    const data = await getDashboardData(viewer("data")).influenceMap(smallCells);

    const execSmall = exec.cells.filter((c) => c.suppressed);
    expect(execSmall.length).toBeGreaterThan(0);
    for (const c of execSmall) {
      expect(c.display).toBe("<10");
      expect(c.value).toBe(0);
    }
    for (const c of exec.cells.filter((c) => !c.suppressed)) expect(c.value).toBeGreaterThanOrEqual(10);

    const ownerSmall = owner.cells.filter((c) => c.suppressed);
    expect(ownerSmall.length).toBe(execSmall.length);
    expect(ownerSmall.some((c) => c.value > 0 && c.value < 10)).toBe(true);
    for (const c of ownerSmall) expect(c.display).toBe(String(c.value));
    expect(data.cells.filter((c) => c.suppressed).length).toBe(ownerSmall.length);
  });

  it("starts every count legend with <10", async () => {
    for (const cookie of ["executive", "owner"]) {
      const r = await getDashboardData(viewer(cookie)).influenceMap(smallCells);
      expect(r.legend[0]?.label).toBe("<10");
      for (const c of r.cells) expect(c.band).toBeLessThan(r.legend.length);
    }
  });

  it("states: eight cells, with names", async () => {
    const r = await getDashboardData(viewer("executive")).influenceMap({
      brand: "all",
      audience: "both",
      measure: "count",
      month: "2026-11",
      level: "state",
    });
    expect(r.cells.map((c) => c.id)).toEqual(["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"]);
    expect(r.cells[0]?.label).toBe("New South Wales");
    expect(r.legend[0]?.label).toBe("<10");
    expect(r.legend.length).toBeGreaterThan(3);
  });

  it("per 1,000 has its own scale, with suppressed cells in band 0", async () => {
    const r = await getDashboardData(viewer("executive")).influenceMap({
      ...smallCells,
      measure: "per1000",
      month: "2026-11",
    });
    expect(r.unit).toBe("per 1,000");
    expect(r.legend[0]?.label.startsWith("<10")).toBe(true);
    for (const c of r.cells) {
      if (c.suppressed) {
        expect(c.band).toBe(0);
        expect(c.value).toBe(0);
      } else {
        expect(c.band).toBeGreaterThanOrEqual(1);
        expect(c.display).toMatch(/^\d+\.\d\d$/);
      }
    }
  });

  it("never carries person-level fields in a map response", async () => {
    const d = getDashboardData(viewer("executive"));
    const inf = await d.influenceMap({ ...smallCells, level: { h3: 8 }, bbox: [151.0, -34.0, 151.3, -33.7] });
    const act = await d.activityMap({ month: "2026-11", h3: 8, bbox: [151.0, -34.0, 151.3, -33.7] });
    const keys = new Set<string>();
    const collect = (o: unknown) => {
      if (Array.isArray(o)) o.forEach(collect);
      else if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o)) {
          keys.add(k);
          collect(v);
        }
      }
    };
    collect(inf);
    collect(act);
    for (const forbidden of ["person", "personId", "profile", "name_", "email", "phone", "age", "userId", "id_"]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(act.heat.length).toBeGreaterThan(0);
    expect(Object.keys(act.heat[0]!).sort()).toEqual(["band", "display", "id", "suppressed", "value"]);
    expect(Object.keys(act.merchants[0]!).sort()).toEqual([
      "category",
      "display",
      "id",
      "lat",
      "lon",
      "name",
      "suppressed",
      "value",
    ]);
  });

  it("thresholds teen activity at 20 and never includes sensitive categories", async () => {
    const owner = getDashboardData(viewer("owner"));
    const exec = getDashboardData(viewer("executive"));
    const q = { ageBand: "13–17", month: "2026-11", h3: 5 as const };
    const r = await exec.activityMap(q);
    expect(r.merchants.every((m) => m.category !== "pharm")).toBe(true);
    for (const m of r.merchants) if (m.suppressed) expect(m.display).toBe("<20");
    for (const h of r.heat) if (h.suppressed) expect(h.display).toBe("<20");
    expect(r.legend[0]?.label).toBe("<20");
    // No teen figure under 20 exists for anyone, Owner included (teen data standard, pack tab 3).
    const o = await owner.activityMap(q);
    expect(o.merchants.some((m) => m.suppressed)).toBe(true);
    for (const m of o.merchants) if (m.suppressed) expect([m.display, m.value]).toEqual(["<20", 0]);
    for (const h of o.heat) if (h.suppressed) expect([h.display, h.value]).toEqual(["<20", 0]);
    await expect(exec.activityMap({ ...q, category: "pharm" })).rejects.toThrow(/sensitive/);
  });

  it("marks sensitive merchants with the higher threshold", async () => {
    const r = await getDashboardData(viewer("executive")).activityMap({
      category: "pharm",
      month: "2024-12",
      h3: 5,
    });
    expect(r.merchants.length).toBeGreaterThan(0);
    for (const m of r.merchants) {
      expect(m.value === 0 || m.value >= 20).toBe(true);
      if (m.suppressed) expect(m.display).toBe("<20");
    }
  });
});

describe("defence in depth in the data layer", () => {
  it("refuses a brand lead who asks for another brand or the whole group", async () => {
    const sam = getDashboardData(viewer("brand_lead_yourtal"));
    await expect(sam.influenceMap({ ...smallCells, brand: "snapapp" })).rejects.toBeInstanceOf(DataAccessError);
    await expect(sam.influenceMap({ ...smallCells, brand: "all" })).rejects.toBeInstanceOf(DataAccessError);
    await expect(sam.brand("ftr", { period: "month" })).rejects.toBeInstanceOf(DataAccessError);
    await expect(sam.overview({ period: "month" })).rejects.toBeInstanceOf(DataAccessError);
    await expect(sam.influenceMap({ ...smallCells, brand: "yourtal" })).resolves.toBeDefined();
    await expect(sam.brand("yourtal", { period: "month" })).resolves.toBeDefined();
  });

  it("limits a brand lead's activity map to their own brand's audience", async () => {
    const q = { month: "2026-11", h3: 5 as const };
    const sam = getDashboardData(viewer("brand_lead_yourtal"));
    await expect(sam.activityMap(q)).rejects.toBeInstanceOf(DataAccessError);
    const own = await sam.activityMap({ ...q, audienceBrand: "yourtal" });
    const all = await getDashboardData(viewer("owner")).activityMap(q);
    const sum = (r: typeof all) => r.heat.reduce((a, h) => a + (h.suppressed ? 0 : h.value), 0);
    expect(sum(own)).toBeLessThan(sum(all));
  });
});
