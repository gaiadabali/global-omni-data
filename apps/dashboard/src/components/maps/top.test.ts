import { describe, expect, it } from "vitest";
import { coordName, distanceKm, nearCapital, topBy } from "./top";

interface Row {
  id: string;
  v: number;
}

describe("topBy", () => {
  const rows: Row[] = Array.from({ length: 15 }, (_, i) => ({ id: `r${String(i).padStart(2, "0")}`, v: (i * 7) % 11 }));

  it("returns the 10 largest visible values, largest first", () => {
    const out = topBy(rows, (r) => r.v, (r) => r.id, () => true);
    expect(out).toHaveLength(10);
    const values = out.map((r) => r.v);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    const cut = values.at(-1)!;
    expect(rows.filter((r) => !out.includes(r)).every((r) => r.v <= cut)).toBe(true);
  });

  it("looks only at what is visible", () => {
    const out = topBy(rows, (r) => r.v, (r) => r.id, (r) => r.id < "r05");
    expect(out).toHaveLength(5);
    expect(out.every((r) => r.id < "r05")).toBe(true);
  });

  it("keeps ties in name order, so the list is stable", () => {
    const tied: Row[] = [
      { id: "b", v: 5 },
      { id: "a", v: 5 },
      { id: "c", v: 9 },
    ];
    expect(topBy(tied, (r) => r.v, (r) => r.id, () => true).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("copes with nothing to show", () => {
    expect(topBy([], (r: Row) => r.v, (r) => r.id, () => true)).toEqual([]);
  });
});

describe("coordName", () => {
  it("names an area by the capital it is near and its coordinates", () => {
    expect(coordName(-33.91, 151.21)).toBe("Sydney area, 33.91S 151.21E");
    expect(coordName(-37.8, 145.0)).toBe("Melbourne area, 37.80S 145.00E");
  });

  it("gives areas in the same city different names", () => {
    expect(coordName(-33.91, 151.21)).not.toBe(coordName(-33.87, 151.19));
  });

  it("leaves the capital out far from any", () => {
    expect(coordName(-23.7, 133.88)).toBe("Area at 23.70S 133.88E");
    expect(coordName(10.04, -3.5)).toBe("Area at 10.04N 3.50W");
  });
});

describe("distance", () => {
  it("is about 713 km from Sydney to Melbourne", () => {
    expect(Math.round(distanceKm(-33.869, 151.209, -37.814, 144.963))).toBeGreaterThan(700);
    expect(Math.round(distanceKm(-33.869, 151.209, -37.814, 144.963))).toBeLessThan(725);
  });
  it("finds the nearest capital within 150 km", () => {
    expect(nearCapital(-34.4, 150.9)).toBe("Sydney");
    expect(nearCapital(-35.3, 149.1)).toBe("Canberra");
    expect(nearCapital(-23.7, 133.88)).toBeNull();
  });
});
