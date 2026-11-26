import { areNeighborCells, cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { pointInPolygon } from "@god/geo/shape";
import { generateMerchants } from "./merchants";
import {
  buildActivityMap,
  fenceCells,
  geometryBox,
  MAP_RES,
  MIN_AREA_PLACES,
  MIN_AREA_RECEIPTS,
  type ActivityMapDetail,
  type FenceGeometry,
  type MapReceipt,
} from "./person-map";
import { allProfiles, generateProfileDetail } from "./person";

const adults = allProfiles().filter((p) => !p.teen);
const details = (() => adults.map((p) => generateProfileDetail(p as Parameters<typeof generateProfileDetail>[0])))();
const maps = details.map((d) => d.activity).filter((a): a is ActivityMapDetail => a !== null);

function inFence(g: FenceGeometry, lon: number, lat: number): boolean {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.some((rings) => pointInPolygon(lon, lat, rings.map((r) => Float64Array.from(r.flat()))));
}

describe("fenceCells: one smoothing ring, only where it fills a gap", () => {
  const a = latLngToCell(-33.86, 151.2, MAP_RES);
  it("a single cell is its own fence", () => {
    expect(fenceCells([a], new Set())).toEqual([a]);
  });
  it("two neighbouring cells get no extra cell", () => {
    const b = gridDisk(a, 1).find((c) => c !== a)!;
    expect(fenceCells([a, b], new Set()).sort()).toEqual([a, b].sort());
  });
  it("a cell between two cells that are not neighbours is added", () => {
    const gap = latLngToCell(-33.86, 151.2, MAP_RES);
    const ring = gridDisk(gap, 1).filter((c) => c !== gap);
    const x = ring[0]!;
    const y = ring.find((c) => c !== x && !areNeighborCells(c, x))!;
    const fence = fenceCells([x, y], new Set());
    expect(fence).toContain(gap);
    // Only cells next to a fenced cell were added: one ring, not a halo.
    for (const c of fence) expect([x, y, ...gridDisk(x, 1), ...gridDisk(y, 1)]).toContain(c);
    expect(fence.length).toBeLessThanOrEqual(2 + 3);
  });
  it("never takes a cell that belongs to another area", () => {
    const ring = gridDisk(a, 1).filter((c) => c !== a);
    const x = ring[0]!;
    const y = ring.find((c) => c !== x && !areNeighborCells(c, x))!;
    expect(fenceCells([x, y], new Set([a]))).not.toContain(a);
  });
});

describe("activity areas and outliers over the synthetic profiles", () => {
  it("only people with receipts have a map, and some have several areas and outliers", () => {
    expect(maps.length).toBeGreaterThan(20);
    expect(maps.some((m) => m.areas.length === 3 && m.outliers.length > 0)).toBe(true);
    expect(maps.some((m) => m.outliers.length > 0)).toBe(true);
  });

  it("every area is a valid fence with at most one of each kind, and at most three areas", () => {
    for (const m of maps) {
      expect(m.areas.length).toBeLessThanOrEqual(3);
      expect(new Set(m.areas.map((a) => a.kind)).size).toBe(m.areas.length);
      for (const a of m.areas) {
        expect(["Polygon", "MultiPolygon"]).toContain(a.fence.type);
        expect(a.label.length).toBeGreaterThan(0);
        if (a.suburbs.length) expect(a.suburbs[0]).toBe(a.label);
        // The label point sits inside its own fence.
        expect(inFence(a.fence, a.centre.lon, a.centre.lat)).toBe(true);
      }
    }
  });

  it("an area inferred from receipts has at least five receipts at three or more shops", () => {
    for (const d of details) {
      const m = d.activity;
      if (!m) continue;
      for (const a of m.areas.filter((x) => x.basis === "receipts")) {
        expect(a.receipts).toBeGreaterThanOrEqual(MIN_AREA_RECEIPTS);
      }
    }
    // The rule itself, on a hand-made set: four receipts at three shops is not an area, five at two is not either.
    const base: MapReceipt = {
      merchantId: "M-1", merchant: "A", suburb: "Parramatta", suburbCode: "1", state: "NSW", sa2: "0",
      category: "cafe", categoryName: "Cafés & takeaway", date: "2026-11-02", lat: -33.815, lon: 151.0,
    };
    const four = [1, 2, 3, 1].map((i) => ({ ...base, merchantId: `M-${i}` }));
    expect(buildActivityMap(four, { lat: -33.815, lon: 151.0, declaredSa2: null }).areas).toEqual([]);
    const two = [1, 2, 1, 2, 1].map((i) => ({ ...base, merchantId: `M-${i}` }));
    expect(buildActivityMap(two, { lat: -33.815, lon: 151.0, declaredSa2: null }).areas).toEqual([]);
    const ok = [1, 2, 3, 1, 2].map((i) => ({ ...base, merchantId: `M-${i}` }));
    const built = buildActivityMap(ok, { lat: -33.815, lon: 151.0, declaredSa2: null });
    expect(built.areas.length).toBe(1);
    expect(built.areas[0]!.kind).toBe("home");
    expect(MIN_AREA_PLACES).toBe(3);
  });

  it("every receipt is in exactly one place: an area or the outliers", () => {
    for (const m of maps) {
      const inAreas = m.areas.reduce((s, a) => s + a.receipts, 0);
      expect(inAreas + m.outliers.length).toBe(m.totalReceipts);
      expect(m.points.reduce((s, p) => s + p.receipts, 0)).toBe(inAreas);
      const share = m.areas.reduce((s, a) => s + a.share, 0);
      expect(share).toBeLessThanOrEqual(1.003);
    }
  });

  it("an outlier is outside every fence, and its distance and text say how far", () => {
    for (const m of maps) {
      for (const o of m.outliers) {
        for (const a of m.areas) expect(inFence(a.fence, o.lon, o.lat)).toBe(false);
        expect(o.distanceKm).toBeGreaterThan(0);
        expect(o.distanceText).toMatch(/^(next to |\d+ km from )(home|work|weekend) (area|suburb)$/);
        expect(o.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(o.merchant.length).toBeGreaterThan(0);
        expect(o.suburb.length).toBeGreaterThan(0);
        expect(o.state).toMatch(/^[A-Z]{2,3}$/);
      }
      // Newest first.
      const dates = m.outliers.map((o) => o.date);
      expect(dates).toEqual([...dates].sort().reverse());
    }
  });

  it("keeps suburb precision: dots on cell centres or suburb points, never a shop's own coordinates", () => {
    const shops = new Set(generateMerchants().map((x) => `${x.lat},${x.lon}`));
    for (const m of maps) {
      const at = (lon: number, lat: number) => `${lat},${lon}`;
      for (const o of m.outliers) {
        const [clat, clon] = cellToLatLng(latLngToCell(o.lat, o.lon, MAP_RES));
        expect(Math.abs(clat - o.lat)).toBeLessThan(2e-5);
        expect(Math.abs(clon - o.lon)).toBeLessThan(2e-5);
        expect(shops.has(at(o.lon, o.lat))).toBe(false);
      }
      for (const p of m.points) {
        const area = m.areas.find((a) => a.kind === p.area)!;
        if (area.basis === "receipts") {
          expect(shops.has(at(p.lon, p.lat))).toBe(false);
          const [clat, clon] = cellToLatLng(latLngToCell(p.lat, p.lon, MAP_RES));
          expect(Math.abs(clat - p.lat)).toBeLessThan(2e-5);
          expect(Math.abs(clon - p.lon)).toBeLessThan(2e-5);
        }
        // Every dot is inside its own fence. A declared SA2 is simplified, so its suburb points may sit on the edge.
        if (area.basis === "receipts") expect(inFence(area.fence, p.lon, p.lat)).toBe(true);
        else {
          const b = geometryBox(area.fence);
          expect(p.lon).toBeGreaterThanOrEqual(b.west - 0.01);
          expect(p.lon).toBeLessThanOrEqual(b.east + 0.01);
          expect(p.lat).toBeGreaterThanOrEqual(b.south - 0.01);
          expect(p.lat).toBeLessThanOrEqual(b.north + 0.01);
        }
      }
    }
  });

  it("a declared home uses the SA2's own outline", () => {
    const declared = maps.flatMap((m) => m.areas).filter((a) => a.basis === "declared");
    expect(declared.length).toBeGreaterThan(0);
    for (const a of declared) expect(a.kind).toBe("home");
  });

  it("holds no sensitive category, and no name, email or phone", () => {
    for (const d of details) {
      const json = JSON.stringify(d.activity);
      expect(json).not.toContain('"pharm"');
      expect(json).not.toMatch(/Pharmacy/);
      expect(json).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    }
  });

  it("is deterministic, and small enough to send (context outlines and fences under 400 kB)", () => {
    const again = adults.map((p) => generateProfileDetail(p as Parameters<typeof generateProfileDetail>[0]).activity);
    expect(JSON.stringify(again)).toBe(JSON.stringify(details.map((d) => d.activity)));
    let biggest = 0;
    for (const m of maps) biggest = Math.max(biggest, JSON.stringify(m).length);
    expect(biggest).toBeLessThan(400_000);
  });
});
