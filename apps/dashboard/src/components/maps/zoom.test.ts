import { describe, expect, it } from "vitest";
import {
  LEVEL_BREAKS,
  activityResolution,
  bboxContains,
  bboxParam,
  cellWidthPx,
  inBBox,
  influenceResolution,
  kmLabel,
  levelLabel,
  snapBBox,
  usesBBox,
  type BBox,
} from "./zoom";

describe("zoom to resolution", () => {
  it.each([
    [2, null],
    [3.7, null],
    [4.99, null],
    [5.0, 4],
    [6.39, 4],
    [6.4, 5],
    [7.79, 5],
    [7.8, 6],
    [9.19, 6],
    [9.2, 7],
    [10.59, 7],
    [10.6, 8],
    [14, 8],
  ])("zoom %s gives %s", (z, res) => {
    expect(influenceResolution(z)).toBe(res);
  });

  it("activity heat never goes coarser than resolution 5", () => {
    expect(activityResolution(3)).toBe(5);
    expect(activityResolution(5.5)).toBe(5);
    expect(activityResolution(7)).toBe(5);
    expect(activityResolution(8)).toBe(6);
    expect(activityResolution(12)).toBe(8);
  });

  it("asks for a box from resolution 6", () => {
    expect([null, 4, 5].map(usesBBox)).toEqual([false, false, false]);
    expect([6, 7, 8].map(usesBBox)).toEqual([true, true, true]);
  });

  it("keeps cells between about 18 and 52 px at every level", () => {
    const res = [4, 5, 6, 7, 8] as const;
    res.forEach((r, i) => {
      const start = LEVEL_BREAKS[i]!;
      const end = LEVEL_BREAKS[i + 1] ?? start + 1.4;
      expect(cellWidthPx(r, start)).toBeGreaterThan(18);
      expect(cellWidthPx(r, end)).toBeLessThan(52);
    });
  });

  it("labels the level in plain words", () => {
    expect(levelLabel(null)).toBe("States");
    expect(levelLabel(4)).toBe("Areas about 39 km across");
    expect(levelLabel(6)).toBe("Areas about 5.6 km across");
    expect(levelLabel(8)).toBe("Areas about 800 m across");
    expect(kmLabel(2.1)).toBe("2.1 km");
  });
});

describe("the query box", () => {
  const sydney: BBox = [150.9, -34.0, 151.4, -33.7];

  it("grows the visible box and snaps it to a grid", () => {
    const b = snapBBox(sydney, 9.6);
    expect(bboxContains(b, sydney)).toBe(true);
    // Step at zoom 9 is 180 / 512 degrees.
    const step = 180 / 512;
    for (const x of b) expect(Math.abs(x / step - Math.round(x / step))).toBeLessThan(1e-4);
    expect(b[2] - b[0]).toBeGreaterThan(sydney[2] - sydney[0]);
  });

  it("gives the same box for a one-pixel nudge, so the cache hits", () => {
    const nudged: BBox = [150.9005, -34.0004, 151.4003, -33.7002];
    expect(snapBBox(nudged, 9.6)).toEqual(snapBBox(sydney, 9.6));
  });

  it("keeps a small pan inside the box already fetched", () => {
    const fetched = snapBBox(sydney, 9.6);
    const panned: BBox = [sydney[0] + 0.05, sydney[1] + 0.05, sydney[2] + 0.05, sydney[3] + 0.05];
    expect(bboxContains(fetched, panned)).toBe(true);
    const far: BBox = [sydney[0] + 2, sydney[1], sydney[2] + 2, sydney[3]];
    expect(bboxContains(fetched, far)).toBe(false);
  });

  it("stays inside the world and in the order the API requires", () => {
    const b = snapBBox([-179.9, -84.9, 179.9, 84.9], 2);
    expect(b[0]).toBeGreaterThanOrEqual(-180);
    expect(b[2]).toBeLessThanOrEqual(180);
    expect(b[1]).toBeGreaterThanOrEqual(-85);
    expect(b[3]).toBeLessThanOrEqual(85);
    expect(b[0]).toBeLessThan(b[2]);
    expect(b[1]).toBeLessThan(b[3]);
  });

  it("prints w,s,e,n with no float noise", () => {
    expect(bboxParam([150.123456789, -34, 151.4, -33.7])).toBe("150.123457,-34,151.4,-33.7");
  });

  it("tests points against a box", () => {
    expect(inBBox(151.2, -33.87, sydney)).toBe(true);
    expect(inBBox(144.96, -37.81, sydney)).toBe(false);
  });
});
