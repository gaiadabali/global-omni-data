import { describe, expect, it } from "vitest";
import { buildAustralia, CITIES, inRing, MAP_H, MAP_W, onLand } from "./australia";

describe("Australia land test", () => {
  it("finds land inland and sea offshore", () => {
    expect(onLand(133, -25)).toBe(true); // near Alice Springs
    expect(onLand(147, -42)).toBe(true); // Tasmania
    expect(onLand(160, -30)).toBe(false); // Tasman Sea
    expect(onLand(133, -45)).toBe(false); // Southern Ocean
  });

  it("inRing works on a simple square", () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(inRing(5, 5, square)).toBe(true);
    expect(inRing(15, 5, square)).toBe(false);
  });
});

describe("buildAustralia", () => {
  const map = buildAustralia();

  it("is deterministic", () => {
    expect(buildAustralia()).toEqual(map);
  });

  it("draws a few thousand dots in a small number of path groups", () => {
    const dots = map.groups.reduce((n, g) => n + (g.d.match(/M/g)?.length ?? 0), 0);
    expect(dots).toBeGreaterThan(1500);
    expect(map.groups.length).toBeLessThan(120);
  });

  it("keeps every city inside the viewBox", () => {
    expect(map.cities).toHaveLength(CITIES.length);
    for (const c of map.cities) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(MAP_W);
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThan(MAP_H);
    }
  });

  it("labels the same eight cities as the prototype", () => {
    expect(map.cities.filter((c) => c.label).map((c) => c.name)).toEqual([
      "Sydney",
      "Melbourne",
      "Brisbane",
      "Perth",
      "Adelaide",
      "Canberra",
      "Hobart",
      "Darwin",
    ]);
  });
});
