import { latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import {
  AGE_GROUP_LABELS,
  BAND_LABELS,
  areas,
  areasIn,
  bandResidents,
  boundaryGeoJSON,
  displayName,
  findSuburbs,
  fullLabel,
  getArea,
  getSuburb,
  nationalPopulation,
  nearestSa2,
  nearestSuburb,
  parentChain,
  parentLabel,
  placeAt,
  placeForCell,
  pointToSa2,
  randomPointInSa2,
  rollup,
  sa2IndexAt,
  suburbs,
  ageGroupCounts,
} from "./index";
import { mulberry } from "./test-rng";

/** Known points, as [lon, lat]. */
const SYDNEY_CBD: [number, number] = [151.2093, -33.8688];
const PARRAMATTA: [number, number] = [151.0035, -33.815];
const ALICE: [number, number] = [133.8807, -23.698];
const HOBART: [number, number] = [147.3272, -42.8821];

describe("the data", () => {
  it("has the ASGS 2021 counts", () => {
    expect(areas("state").length).toBe(9); // eight states and territories, plus Other Territories
    expect(areas("sa4").length).toBeGreaterThanOrEqual(85);
    expect(areas("sa3").length).toBeGreaterThanOrEqual(330);
    expect(areas("sa2").length).toBeGreaterThanOrEqual(2400);
    expect(suburbs().length).toBeGreaterThan(15000);
  });

  it("is sorted by id and every area has an index equal to its position", () => {
    for (const level of ["state", "sa4", "sa3", "sa2"] as const) {
      const list = areas(level);
      list.forEach((a, i) => expect(a.index).toBe(i));
      const ids = list.map((a) => a.id);
      expect(ids).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("gives every area a parent one level up, and names without damaged text", () => {
    for (const a of areas("sa2")) expect(getArea("sa3", a.parentId!)).toBeDefined();
    for (const a of areas("sa3")) expect(getArea("sa4", a.parentId!)).toBeDefined();
    for (const a of areas("sa4")) expect(getArea("state", a.parentId!)).toBeDefined();
    for (const level of ["state", "sa4", "sa3", "sa2"] as const) {
      for (const a of areas(level)) {
        expect(a.name).not.toMatch(/�/);
        expect(a.name.length).toBeGreaterThan(1);
      }
    }
    for (const s of suburbs()) {
      expect(s.name).not.toMatch(/�/);
      expect(s.name).not.toMatch(/\)$/); // the ABS "(Vic.)" suffix is taken off
      expect(getArea("sa2", s.sa2)).toBeDefined();
    }
  });

  it("puts every area's centroid inside its bounding box", () => {
    for (const a of areas("sa2")) {
      expect(a.centroid[0]).toBeGreaterThanOrEqual(a.bbox[0] - 0.001);
      expect(a.centroid[0]).toBeLessThanOrEqual(a.bbox[2] + 0.001);
      expect(a.centroid[1]).toBeGreaterThanOrEqual(a.bbox[1] - 0.001);
      expect(a.centroid[1]).toBeLessThanOrEqual(a.bbox[3] + 0.001);
      expect(a.areaKm2).toBeGreaterThan(0);
    }
  });
});

describe("lookups and the parent chain", () => {
  it("finds an area by code and names it", () => {
    expect(getArea("state", "NSW")?.name).toBe("New South Wales");
    expect(displayName("state", "WA")).toBe("Western Australia");
    expect(getArea("sa4", "125")?.name).toBe("Sydney - Parramatta");
    expect(getArea("sa2", "000000000")).toBeUndefined();
    expect(displayName("sa4", "nope")).toBe("nope");
  });

  it("walks the chain from an SA2 up to its state", () => {
    const sa2 = pointToSa2(...PARRAMATTA)!;
    const chain = parentChain("sa2", sa2.id);
    expect(chain.map((a) => a.level)).toEqual(["sa2", "sa3", "sa4", "state"]);
    expect(chain[2]!.name).toBe("Sydney - Parramatta");
    expect(chain[3]!.id).toBe("NSW");
    expect(parentChain("state", "NSW").map((a) => a.id)).toEqual(["NSW"]);
    expect(parentChain("sa2", "nope")).toEqual([]);
  });

  it("rolls SA2 indexes up to every coarser level consistently", () => {
    const toState = rollup("sa2", "state");
    const viaSa3 = rollup("sa2", "sa3");
    const sa3ToState = rollup("sa3", "state");
    areas("sa2").forEach((a, i) => {
      expect(areas("state")[toState[i]!]!.id).toBe(a.state);
      expect(sa3ToState[viaSa3[i]!]).toBe(toState[i]);
    });
    expect(Array.from(rollup("sa4", "sa4"))).toEqual(areas("sa4").map((_, i) => i));
    expect(() => rollup("state", "sa2")).toThrow();
  });

  it("labels where an area is", () => {
    const sa2 = pointToSa2(...PARRAMATTA)!;
    expect(parentLabel("sa2", sa2.id)).toBe("Greater Sydney, NSW");
    expect(parentLabel("sa4", "125")).toBe("Greater Sydney, NSW");
    expect(parentLabel("state", "NSW")).toBe("Australia");
    const alice = pointToSa2(...ALICE)!;
    expect(parentLabel("sa2", alice.id)).toMatch(/, NT$/);
    expect(fullLabel("sa2", sa2.id)).toBe(`${sa2.name}, Greater Sydney, NSW`);
    const hobart = pointToSa2(...HOBART)!;
    expect(parentLabel("sa2", hobart.id)).toBe("Greater Hobart, TAS");
  });

  it("finds areas whose box meets a box, never the Other Territories", () => {
    const box: [number, number, number, number] = [150.6, -34.2, 151.5, -33.5];
    const inBox = areasIn("sa2", box);
    expect(inBox.length).toBeGreaterThan(100);
    expect(inBox.length).toBeLessThan(900);
    expect(areasIn("state").map((a) => a.id)).not.toContain("OT");
    expect(areasIn("state").length).toBe(8);
  });
});

describe("point to SA2", () => {
  it("puts Sydney CBD in a Sydney SA2 in Greater Sydney", () => {
    const a = pointToSa2(...SYDNEY_CBD)!;
    expect(a.name).toMatch(/Sydney|Haymarket|Rocks/);
    expect(a.state).toBe("NSW");
    expect(parentLabel("sa2", a.id)).toBe("Greater Sydney, NSW");
  });

  it("puts Parramatta in an SA2 named for Parramatta, in the Parramatta SA4", () => {
    const a = pointToSa2(...PARRAMATTA)!;
    expect(a.name).toMatch(/Parramatta/);
    expect(parentChain("sa2", a.id)[2]!.name).toBe("Sydney - Parramatta");
  });

  it("puts Alice Springs in the Northern Territory", () => {
    const a = pointToSa2(...ALICE)!;
    expect(a.state).toBe("NT");
    expect(parentChain("sa2", a.id).map((x) => x.name).join("|")).toMatch(/Alice Springs/);
  });

  it("puts Hobart in Tasmania", () => {
    const a = pointToSa2(...HOBART)!;
    expect(a.state).toBe("TAS");
    expect(parentChain("sa2", a.id)[2]!.name).toBe("Hobart");
  });

  it("finds nothing in the sea, and snaps a coastal point to the nearest SA2", () => {
    expect(pointToSa2(160, -35)).toBeNull();
    expect(sa2IndexAt(160, -35)).toBe(-1);
    expect(nearestSa2(160, -35)).toBeNull();
    // Just off Bondi beach.
    const snapped = nearestSa2(151.285, -33.8915, 5);
    expect(snapped?.state).toBe("NSW");
  });

  it("draws random points that fall inside their own SA2", () => {
    const rnd = mulberry(7);
    const list = areas("sa2");
    let tried = 0;
    let inside = 0;
    for (let k = 0; k < 150; k++) {
      const i = Math.floor(rnd() * list.length);
      for (let t = 0; t < 8; t++) {
        const [x, y] = randomPointInSa2(i, rnd);
        tried++;
        if (sa2IndexAt(x, y) === i) inside++;
      }
    }
    expect(inside / tried).toBeGreaterThan(0.97);
  });

  it("draws the same points for the same random source", () => {
    const a = mulberry(5);
    const b = mulberry(5);
    for (let i = 0; i < 50; i++) expect(randomPointInSa2(i * 17, a)).toEqual(randomPointInSa2(i * 17, b));
  });
});

describe("suburbs", () => {
  it("names the suburb at a point", () => {
    expect(nearestSuburb(...PARRAMATTA)!.suburb.name).toBe("Parramatta");
    expect(nearestSuburb(...ALICE)!.suburb.name).toBe("Alice Springs");
    expect(nearestSuburb(...HOBART)!.suburb.name).toBe("Hobart");
    expect(nearestSuburb(...PARRAMATTA)!.suburb.state).toBe("NSW");
  });

  it("returns nothing far from every suburb", () => {
    expect(nearestSuburb(160, -35, 50)).toBeNull();
  });

  it("finds suburbs by name and state, and by code", () => {
    expect(findSuburbs("richmond").length).toBeGreaterThan(2);
    expect(findSuburbs("Richmond", "VIC").length).toBeGreaterThanOrEqual(1);
    const s = findSuburbs("Parramatta", "NSW")[0]!;
    expect(getSuburb(s.code)).toBe(s);
  });

  it("gives a place for a point and for an H3 cell", () => {
    const p = placeAt(...PARRAMATTA);
    expect(p.name).toBe("Parramatta");
    expect(p.parent).toBe("Greater Sydney, NSW");
    expect(p.sa2?.name).toMatch(/Parramatta/);
    // The res 7 cell over Parramatta CBD.
    const id = latLngToCell(PARRAMATTA[1], PARRAMATTA[0], 7);
    const cell = placeForCell(id);
    expect(cell.name).toBe("Parramatta");
    expect(cell.parent).toBe("Greater Sydney, NSW");
    expect(placeForCell(id)).toBe(cell);
  });
});

describe("population", () => {
  it("adds up to about the ABS national estimate (27.6 million at 30 June 2025)", () => {
    const n = nationalPopulation();
    expect(n).toBeGreaterThan(27_000_000);
    expect(n).toBeLessThan(28_200_000);
  });

  it("rolls up exactly: SA2s add to their SA3, SA4 and state", () => {
    for (const level of ["sa3", "sa4", "state"] as const) {
      const map = rollup("sa2", level);
      const sums = new Float64Array(areas(level).length);
      areas("sa2").forEach((a, i) => (sums[map[i]!] = sums[map[i]!]! + a.population));
      areas(level).forEach((a, i) => expect(sums[i]).toBe(a.population));
    }
  });

  it("has 18 age groups that add up to the total, and seven bands for 13 and over", () => {
    expect(AGE_GROUP_LABELS).toHaveLength(18);
    const counts = ageGroupCounts("state", "NSW")!;
    expect(counts).toHaveLength(19);
    let sum = 0;
    for (let i = 1; i < 19; i++) sum += counts[i]!;
    expect(sum).toBe(counts[0]);
    const bands = bandResidents(counts);
    expect(bands).toHaveLength(BAND_LABELS.length);
    const adultPlus = bands.reduce((a, b) => a + b, 0);
    expect(adultPlus).toBeLessThan(counts[0]!);
    // 13 to 17 is a few per cent of everyone.
    expect(bands[0]! / counts[0]!).toBeGreaterThan(0.04);
    expect(bands[0]! / counts[0]!).toBeLessThan(0.08);
  });
});

describe("boundaries", () => {
  it("gives GeoJSON for every level, with closed rings", () => {
    for (const [level, min] of [["state", 8], ["sa4", 85], ["sa3", 330]] as const) {
      const fc = boundaryGeoJSON(level);
      expect(fc.features.length).toBeGreaterThanOrEqual(min);
      for (const f of fc.features) {
        expect(f.id).toBe(f.properties["code"]);
        const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const poly of polys) {
          for (const ring of poly) {
            expect(ring.length).toBeGreaterThanOrEqual(4);
            expect(ring[0]).toEqual(ring[ring.length - 1]);
          }
        }
      }
    }
    expect(boundaryGeoJSON("sa2").features.length).toBeGreaterThanOrEqual(2400);
  });
});
