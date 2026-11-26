import { describe, expect, it } from "vitest";
import {
  LEVEL_BREAKS,
  MAX_ZOOM,
  MIN_ZOOM,
  activityResolution,
  bboxContains,
  bboxParam,
  cellWidthPx,
  finerLevel,
  inBBox,
  influenceLevel,
  kmLabel,
  levelLabel,
  levelStartZoom,
  snapBBox,
  usesBBox,
  type BBox,
} from "./zoom";

describe("zoom to level", () => {
  it.each([
    [2, "state"],
    [4.39, "state"],
    [4.4, "sa4"],
    [5.59, "sa4"],
    [5.6, "sa3"],
    [6.79, "sa3"],
    [6.8, "sa2"],
    [7.79, "sa2"],
    [7.8, 6],
    [9.19, 6],
    [9.2, 7],
    [MAX_ZOOM, 7],
  ])("zoom %s gives %s", (z, level) => {
    expect(influenceLevel(z)).toBe(level);
  });

  it("has no street level: the zoom stops at suburb size, with an SA2 or a res 7 cell the finest view", () => {
    expect(MAX_ZOOM).toBeLessThan(12);
    expect(influenceLevel(14)).toBe(7);
    expect(finerLevel(7)).toBe(7);
    // A res 7 cell is about 2 km across: at the cap it is still a sensible size on screen, not a street.
    expect(cellWidthPx(7, MAX_ZOOM)).toBeLessThan(100);
  });

  it("goes state, SA4, SA3, SA2, then H3 6 and 7", () => {
    expect(["state", "sa4", "sa3", "sa2", 6].map((l) => finerLevel(l as never))).toEqual(["sa4", "sa3", "sa2", 6, 7]);
    expect(levelStartZoom("sa4")).toBe(LEVEL_BREAKS[0]);
    expect(levelStartZoom(7)).toBe(LEVEL_BREAKS[4]);
    expect(levelStartZoom("state")).toBe(MIN_ZOOM);
  });

  it("activity heat never goes coarser than resolution 5, and never finer than 7", () => {
    expect(activityResolution(3)).toBe(5);
    expect(activityResolution(5.5)).toBe(5);
    expect(activityResolution(7)).toBe(5);
    expect(activityResolution(8)).toBe(6);
    expect(activityResolution(12)).toBe(7);
    expect(activityResolution(MAX_ZOOM)).toBe(7);
  });

  it("asks for a box from SA2 down, and for nothing finer than an H3 cell of res 7", () => {
    expect(["state", "sa4", "sa3"].map((l) => usesBBox(l as never))).toEqual([false, false, false]);
    expect([null, "sa2", 6, 7].map((l) => usesBBox(l as never))).toEqual([false, true, true, true]);
  });

  it("keeps H3 cells between about 18 and 52 px when their level starts and just before the next", () => {
    expect(cellWidthPx(6, LEVEL_BREAKS[3])).toBeGreaterThan(18);
    expect(cellWidthPx(6, LEVEL_BREAKS[4])).toBeLessThan(52);
    expect(cellWidthPx(7, LEVEL_BREAKS[4])).toBeGreaterThan(18);
  });

  it("labels the level in plain words", () => {
    expect(levelLabel(null)).toBe("States and territories");
    expect(levelLabel("sa4")).toBe("SA4 regions");
    expect(levelLabel("sa2")).toBe("SA2 areas");
    expect(levelLabel(6)).toBe("Areas about 5.6 km across");
    expect(levelLabel(7)).toBe("Areas about 2.1 km across");
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
