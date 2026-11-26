import { describe, expect, it } from "vitest";
import { coordName, topBy } from "./top";

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
  it("names a place by its coordinates", () => {
    expect(coordName(-33.87, 151.21)).toBe("Area near 33.9 S, 151.2 E");
    expect(coordName(10.04, -3.5)).toBe("Area near 10.0 N, 3.5 W");
  });
});
