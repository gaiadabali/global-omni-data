import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  AGE_BANDS,
  BRANDS,
  CITIES,
  CURRENT_INDEX,
  MONTHS,
  buildWorld,
  generateMerchants,
  generateProfiles,
  getWorld,
  monthIndex,
  stateAt,
  type World,
} from "./index";

function digest(w: World): string {
  const h = createHash("sha256");
  for (const a of [w.lat, w.lon, w.state, w.mask, w.isBusiness, w.weight, w.age, w.category, w.joinAny, ...w.join]) {
    h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  }
  return h.digest("hex");
}

describe("determinism", () => {
  it("gives identical output for the same seed and different output for another", () => {
    const a = buildWorld(123);
    const b = buildWorld(123);
    const c = buildWorld(124);
    expect(digest(a)).toBe(digest(b));
    expect(digest(a)).not.toBe(digest(c));
    expect(Array.from(a.peopleByMonth.god)).toEqual(Array.from(b.peopleByMonth.god));
  });

  it("gives identical merchants and profiles for the same seed", () => {
    expect(JSON.stringify(generateMerchants(77, 300))).toBe(JSON.stringify(generateMerchants(77, 300)));
    const w = getWorld();
    expect(JSON.stringify(generateProfiles(w))).toBe(JSON.stringify(generateProfiles(w)));
  });
});

describe("shape of the world", () => {
  const w = getWorld();

  it("is a sample of 150k to 250k weighted points", () => {
    expect(w.n).toBeGreaterThanOrEqual(150_000);
    expect(w.n).toBeLessThanOrEqual(250_000);
  });

  it("models about 100 population centres", () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(95);
    expect(CITIES.length).toBeLessThanOrEqual(115);
  });

  it("puts every point on land, in a state", () => {
    for (let i = 0; i < w.n; i += 97) expect(w.state[i]).toBeGreaterThanOrEqual(0);
  });

  it("finds states with geoContains", () => {
    expect(stateAt(-33.87, 151.21)).toBe(0);
    expect(stateAt(-37.81, 144.96)).toBe(1);
    expect(stateAt(-27.47, 153.03)).toBe(2);
    expect(stateAt(-31.95, 115.86)).toBe(3);
    expect(stateAt(-34.93, 138.6)).toBe(4);
    expect(stateAt(-42.88, 147.33)).toBe(5);
    expect(stateAt(-35.28, 149.13)).toBe(6);
    expect(stateAt(-12.46, 130.84)).toBe(7);
    expect(stateAt(-40, 160)).toBe(-1);
  });

  it("has teens at about 8% of people, on YourTal and SnapApp only", () => {
    let people = 0;
    let teens = 0;
    for (let i = 0; i < w.n; i++) {
      if (w.isBusiness[i]) continue;
      people += w.weight[i]!;
      if (w.age[i] === 0) {
        teens += w.weight[i]!;
        expect(w.mask[i]! & 4).toBe(0);
        expect(w.mask[i]! & 3).not.toBe(0);
        expect(w.category[i]).not.toBe(4); // never the sensitive category
      }
    }
    expect(teens / people).toBeGreaterThan(0.07);
    expect(teens / people).toBeLessThan(0.09);
    expect(w.teenPeople).toBe(teens);
  });

  it("has adoption curves over 24 months that only grow, ending at the totals", () => {
    expect(MONTHS).toHaveLength(24);
    expect(MONTHS[0]).toBe("2024-12");
    expect(MONTHS[23]).toBe("2026-11");
    expect(monthIndex("2026-11")).toBe(CURRENT_INDEX);
    for (const key of [...BRANDS, "god"] as const) {
      const a = w.peopleByMonth[key];
      for (let m = 1; m < 24; m++) expect(a[m]!).toBeGreaterThanOrEqual(a[m - 1]!);
      expect(a[23]!).toBeGreaterThan(a[0]!);
    }
    let byMask = 0;
    for (let m = 1; m < 8; m++) byMask += w.peopleByMask[m]!;
    expect(w.peopleByMonth.god[23]).toBe(byMask);
  });

  it("covers people in 1, 2 and 3 brands", () => {
    const one = w.peopleByMask[1]! + w.peopleByMask[2]! + w.peopleByMask[4]!;
    expect(one).toBeGreaterThan(0);
    expect(w.peopleByMask[7]).toBeGreaterThan(0);
  });

  it("conserves totals when aggregated into h3 cells", () => {
    const f = { audience: "both", brand: "all", month: CURRENT_INDEX } as const;
    const total = w.aggregate(f, w.state, 8).reduce((a, b) => a + b, 0);
    for (const res of [3, 6]) {
      const ids = w.cells.idsAt(res);
      const sum = w.aggregate(f, w.cells.keysAt(res), ids.length).reduce((a, b) => a + b, 0);
      expect(sum).toBe(total);
    }
  });
});

describe("merchants and profiles", () => {
  it("has the fictional chains", () => {
    const names = new Set(generateMerchants().map((m) => m.chain));
    for (const n of ["Southern Cross Fuel", "Harbour & Bean", "Kidzone Play", "Coastline Grocers"]) {
      expect(names.has(n)).toBe(true);
    }
  });

  it("makes about 200 pseudonymous profiles with no personal fields", () => {
    const ps = generateProfiles(getWorld());
    expect(ps.length).toBe(200);
    expect(new Set(ps.map((p) => p.id)).size).toBe(200);
    for (const p of ps) expect(p.id).toMatch(/^G-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    const json = JSON.stringify(ps);
    expect(json).not.toMatch(/@/);
    expect(json).not.toMatch(/"(name|email|phone|mobile)"/i);
    const teens = ps.filter((p) => p.teen);
    expect(teens.length).toBeGreaterThan(0);
    for (const t of teens) expect(Object.keys(t).sort()).toEqual(["id", "teen"]);
    for (const p of ps) if (!p.teen) expect(AGE_BANDS as readonly string[]).toContain(p.ageBand);
  });
});
