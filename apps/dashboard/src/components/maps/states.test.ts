import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { labelPoint, stateBounds, stateCode, stateLabels, type StateCollection, type StateFeature } from "./states";

const square = (x: number, y: number, size: number): [number, number][] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

const feature = (name: string, rings: [number, number][][]): StateFeature => ({
  type: "Feature",
  properties: { name },
  geometry: { type: "MultiPolygon", coordinates: rings.map((r) => [r]) },
});

describe("label point", () => {
  it("is the centre of a square", () => {
    const p = labelPoint(feature("Victoria", [square(140, -39, 4)]));
    expect(p[0]).toBeCloseTo(142, 6);
    expect(p[1]).toBeCloseTo(-37, 6);
  });

  it("uses the largest outer ring, not an island", () => {
    const p = labelPoint(feature("Queensland", [square(150, -12, 0.2), square(141, -28, 10)]));
    expect(p[0]).toBeCloseTo(146, 6);
    expect(p[1]).toBeCloseTo(-23, 6);
  });
});

describe("the real state outlines", () => {
  const fc = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../public/geo/au-states.json", import.meta.url)), "utf8"),
  ) as StateCollection;

  it("covers all eight states and territories by name", () => {
    const codes = new Set(fc.features.map(stateCode));
    for (const c of ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"]) expect(codes.has(c)).toBe(true);
    expect(codes.has(null)).toBe(false);
  });

  it("labels seven states (not the ACT) with a point inside Australia", () => {
    const labels = stateLabels(fc);
    expect(labels.map((l) => l.code).sort()).toEqual(["NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]);
    for (const l of labels) {
      expect(l.position[0]).toBeGreaterThan(112);
      expect(l.position[0]).toBeLessThan(155);
      expect(l.position[1]).toBeGreaterThan(-45);
      expect(l.position[1]).toBeLessThan(-9);
    }
  });

  it("finds the bounds of a state", () => {
    const b = stateBounds(fc, "NSW");
    expect(b).not.toBeNull();
    expect(b![0]).toBeGreaterThan(140);
    expect(b![2]).toBeLessThan(154);
    expect(stateBounds(fc, "XX")).toBeNull();
  });
});
