import { describe, expect, it } from "vitest";
import {
  activityAreaUrl,
  activityUrl,
  areaUrl,
  hotspotsUrl,
  influenceUrl,
  planActivity,
  planInfluence,
  summaryUrl,
  type InfluenceControls,
  type ShownInfluence,
} from "./plan";
import { snapBBox, type BBox } from "./zoom";

const controls: InfluenceControls = { brand: "all", audience: "both", measure: "count", month: "2026-11" };
const australia: BBox = [112, -44, 155, -9];
const sydney: BBox = [150.9, -34.0, 151.4, -33.7];

describe("influence requests", () => {
  it("asks for states at the national view", () => {
    expect(planInfluence(controls, { z: 3.7, bbox: australia }, null)).toBe(
      "/api/map/influence?brand=all&audience=both&measure=count&month=2026-11&level=state",
    );
  });

  it("asks for the whole country at SA4 and SA3, with no box", () => {
    expect(planInfluence(controls, { z: 5, bbox: australia }, null)).toBe(
      "/api/map/influence?brand=all&audience=both&measure=count&month=2026-11&level=sa4",
    );
    const sa3 = planInfluence(controls, { z: 6.2, bbox: australia }, null);
    expect(sa3).toContain("level=sa3");
    expect(sa3).not.toContain("bbox");
  });

  it("asks for a box at SA2 and at H3 res 6 and 7 (the API refuses them without)", () => {
    for (const [z, want] of [
      [7.2, "level=sa2"],
      [8.4, "level=h3&res=6"],
      [9.6, "level=h3&res=7"],
      [11.4, "level=h3&res=7"],
    ] as const) {
      const url = planInfluence(controls, { z, bbox: sydney }, null);
      expect(url).toContain(want);
      expect(url).toContain("bbox=");
    }
  });

  it("never asks for res 8: the map has no street level", () => {
    for (const z of [10.6, 11.4, 12, 14]) {
      expect(planInfluence(controls, { z, bbox: sydney }, null)).not.toContain("res=8");
    }
  });

  it("sends the same box for the same view, so the cache key repeats", () => {
    const a = planInfluence(controls, { z: 9.6, bbox: sydney }, null);
    const b = planInfluence(controls, { z: 9.6, bbox: [150.9004, -34.0003, 151.4002, -33.7001] }, null);
    expect(a).toBe(b);
  });

  it("makes no new request for a small pan inside the box on screen", () => {
    const url = planInfluence(controls, { z: 9.6, bbox: sydney }, null);
    const query: ShownInfluence = { ...controls, level: { h3: 7 }, bbox: snapBBox(sydney, 9.6) };
    const panned: BBox = [sydney[0] + 0.06, sydney[1] + 0.06, sydney[2] + 0.06, sydney[3] + 0.06];
    expect(planInfluence(controls, { z: 9.6, bbox: panned }, { url, query })).toBe(url);
  });

  it("does the same for an SA2 view", () => {
    const url = planInfluence(controls, { z: 7.2, bbox: sydney }, null);
    const query: ShownInfluence = { ...controls, level: "sa2", bbox: snapBBox(sydney, 7.2) };
    const panned: BBox = [sydney[0] + 0.06, sydney[1] + 0.06, sydney[2] + 0.06, sydney[3] + 0.06];
    expect(planInfluence(controls, { z: 7.2, bbox: panned }, { url, query })).toBe(url);
  });

  it("asks again after a pan that leaves the box", () => {
    const url = planInfluence(controls, { z: 9.6, bbox: sydney }, null);
    const query: ShownInfluence = { ...controls, level: { h3: 7 }, bbox: snapBBox(sydney, 9.6) };
    const far: BBox = [sydney[0] + 1.5, sydney[1], sydney[2] + 1.5, sydney[3]];
    expect(planInfluence(controls, { z: 9.6, bbox: far }, { url, query })).not.toBe(url);
  });

  it("asks again when a control changes or the level changes, even inside the box", () => {
    const url = planInfluence(controls, { z: 9.6, bbox: sydney }, null);
    const query: ShownInfluence = { ...controls, level: { h3: 7 }, bbox: snapBBox(sydney, 9.6) };
    const month = planInfluence({ ...controls, month: "2026-10" }, { z: 9.6, bbox: sydney }, { url, query });
    expect(month).not.toBe(url);
    expect(month).toContain("month=2026-10");
    expect(planInfluence(controls, { z: 8.4, bbox: sydney }, { url, query })).toContain("res=6");
    expect(planInfluence(controls, { z: 7.2, bbox: sydney }, { url, query })).toContain("level=sa2");
  });

  it("builds a plain state query", () => {
    expect(influenceUrl({ ...controls, brand: "yourtal", measure: "per1000" }, "state")).toBe(
      "/api/map/influence?brand=yourtal&audience=both&measure=per1000&month=2026-11&level=state",
    );
  });
});

describe("activity requests", () => {
  const filters = { category: "all", ageBand: "all", month: "2026-11" };

  it("never goes coarser than resolution 5, and leaves out filters that are 'all'", () => {
    expect(planActivity(filters, { z: 3.7, bbox: australia }, null)).toBe("/api/map/activity?month=2026-11&h3=5");
  });

  it("sends category and the age band in the API's spelling", () => {
    const url = activityUrl({ category: "cafe", ageBand: "13–17", month: "2026-11" }, 5);
    expect(url).toBe("/api/map/activity?month=2026-11&h3=5&category=cafe&ageBand=13%E2%80%9317");
    expect(new URL(url, "http://x").searchParams.get("ageBand")).toBe("13–17");
  });

  it("sends a box from resolution 6, and never asks for res 8", () => {
    const url = planActivity(filters, { z: 9.6, bbox: sydney }, null);
    expect(url).toContain("h3=7");
    expect(url).toContain("bbox=");
    expect(planActivity(filters, { z: 11.4, bbox: sydney }, null)).not.toContain("h3=8");
  });

  it("reuses the answer on screen for a small pan", () => {
    const url = planActivity(filters, { z: 9.6, bbox: sydney }, null);
    const query = { month: "2026-11", h3: 7, bbox: snapBBox(sydney, 9.6) };
    const panned: BBox = [sydney[0] + 0.1, sydney[1], sydney[2] + 0.1, sydney[3]];
    expect(planActivity(filters, { z: 9.6, bbox: panned }, { url, query })).toBe(url);
    expect(planActivity({ ...filters, ageBand: "13–17" }, { z: 9.6, bbox: sydney }, { url, query })).not.toBe(url);
  });
});

describe("hexagon mode", () => {
  it("asks for H3 cells from zoom 6, where the area levels would still be SA3", () => {
    const area = planInfluence(controls, { z: 6.3, bbox: sydney }, null);
    expect(area).toContain("level=sa3");
    const hex = planInfluence(controls, { z: 6.3, bbox: sydney }, null, true);
    expect(hex).toContain("level=h3&res=6");
    expect(hex).toContain("bbox=");
  });
  it("keeps the area levels below zoom 6, and res 7 from 9.2", () => {
    expect(planInfluence(controls, { z: 5, bbox: australia }, null, true)).toContain("level=sa4");
    expect(planInfluence(controls, { z: 9.6, bbox: sydney }, null, true)).toContain("res=7");
  });
});

describe("the panels' requests", () => {
  it("builds the summary, area, hotspots and activity-area queries", () => {
    expect(summaryUrl(controls, "2026-11", "sa3")).toBe(
      "/api/map/summary?brand=all&audience=both&measure=count&month=2026-11&level=sa3&limit=5",
    );
    expect(areaUrl(controls, "2026-11", "h3", "87be0e9a4ffffff")).toBe(
      "/api/map/area?level=h3&id=87be0e9a4ffffff&brand=all&audience=both&month=2026-11",
    );
    const act = { category: "cafe", ageBand: "25–34", month: "2026-11" };
    expect(hotspotsUrl(act, undefined)).toContain("category=cafe");
    expect(hotspotsUrl(act, undefined)).not.toContain("bbox");
    expect(hotspotsUrl({ category: "all", ageBand: "all", month: "2026-11" }, sydney, 10)).toBe(
      "/api/map/hotspots?month=2026-11&limit=10&bbox=150.9%2C-34%2C151.4%2C-33.7",
    );
    expect(activityAreaUrl({ category: "all", ageBand: "13–17", month: "2026-11" }, "abc")).toContain("ageBand=13%E2%80%9317");
  });
});
