import { describe, expect, it } from "vitest";
import {
  activityUrl,
  influenceUrl,
  planActivity,
  planInfluence,
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

  it("asks for the whole country at resolution 4 and 5, with no box", () => {
    expect(planInfluence(controls, { z: 5.5, bbox: australia }, null)).toBe(
      "/api/map/influence?brand=all&audience=both&measure=count&month=2026-11&level=h3&res=4",
    );
    expect(planInfluence(controls, { z: 7, bbox: australia }, null)).toContain("res=5");
    expect(planInfluence(controls, { z: 7, bbox: australia }, null)).not.toContain("bbox");
  });

  it("asks for a box from resolution 6, and always at 7 and 8 (the API refuses them without)", () => {
    for (const [z, res] of [
      [8.4, 6],
      [9.6, 7],
      [11, 8],
    ] as const) {
      const url = planInfluence(controls, { z, bbox: sydney }, null);
      expect(url).toContain(`res=${res}`);
      expect(url).toContain("bbox=");
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
  });

  it("builds a plain state query", () => {
    expect(influenceUrl({ ...controls, brand: "yourtal", measure: "per1000" }, null)).toBe(
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

  it("sends a box from resolution 6", () => {
    const url = planActivity(filters, { z: 9.6, bbox: sydney }, null);
    expect(url).toContain("h3=7");
    expect(url).toContain("bbox=");
  });

  it("reuses the answer on screen for a small pan", () => {
    const url = planActivity(filters, { z: 9.6, bbox: sydney }, null);
    const query = { month: "2026-11", h3: 7, bbox: snapBBox(sydney, 9.6) };
    const panned: BBox = [sydney[0] + 0.1, sydney[1], sydney[2] + 0.1, sydney[3]];
    expect(planActivity(filters, { z: 9.6, bbox: panned }, { url, query })).toBe(url);
    expect(planActivity({ ...filters, ageBand: "13–17" }, { z: 9.6, bbox: sydney }, { url, query })).not.toBe(url);
  });
});
