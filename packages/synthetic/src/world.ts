import { cellToBoundary, cellToLatLng, cellToParent, getHexagonAreaAvg, latLngToCell, UNITS } from "h3-js";
import { areas, randomPointInSa2, sa2IndexAt } from "@god/geo";
import { getPlacement } from "./placement";
import { cumulative, mulberry32, pickCum, type Rng } from "./rng";

/* ---------------- shared vocabulary ---------------- */

export const BRANDS = ["yourtal", "snapapp", "ftr"] as const;
export type BrandId = (typeof BRANDS)[number];
export const BRAND_NAMES: Record<BrandId, string> = {
  yourtal: "YourTal",
  snapapp: "SnapApp",
  ftr: "Free Tax Returns",
};
export const BRAND_BIT: Record<BrandId, number> = { yourtal: 1, snapapp: 2, ftr: 4 };

/** 24 months to the current month, oldest first: "2024-12" ... "2026-11". */
export const CURRENT_MONTH = "2026-11";
export const MONTH_COUNT = 24;
export const MONTHS: readonly string[] = (() => {
  const out: string[] = [];
  for (let i = 0; i < MONTH_COUNT; i++) {
    const idx = 2024 * 12 + 11 + i; // month 0 is December 2024
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`);
  }
  return out;
})();
export const CURRENT_INDEX = MONTH_COUNT - 1;

/** Index of "YYYY-MM" in MONTHS, or -1. */
export function monthIndex(month: string): number {
  return MONTHS.indexOf(month);
}

/** Calendar month 1..12 of a month index. */
export function calendarMonth(index: number): number {
  return ((11 + index) % 12) + 1;
}

export const AGE_BANDS = ["13–17", "18–24", "25–34", "35–44", "45–54", "55–64", "65+"] as const;
export const TEEN_BAND = 0;

export interface Category {
  id: "fuel" | "groc" | "cafe" | "retail" | "pharm" | "ent";
  name: string;
  /** Sensitive categories use the higher threshold and never appear in teen figures. */
  sensitive: boolean;
}
export const CATEGORIES: readonly Category[] = [
  { id: "fuel", name: "Fuel", sensitive: false },
  { id: "groc", name: "Groceries", sensitive: false },
  { id: "cafe", name: "Cafés & takeaway", sensitive: false },
  { id: "retail", name: "Retail", sensitive: false },
  { id: "pharm", name: "Pharmacy & health", sensitive: true },
  { id: "ent", name: "Entertainment", sensitive: false },
];

/** Adult age mix per brand (bands 18-24 .. 65+). Teens are placed separately. */
const ADULT_AGE: Record<BrandId, readonly number[]> = {
  yourtal: [24, 27, 17, 11, 8, 5],
  snapapp: [12, 26, 26, 18, 10, 6],
  ftr: [26, 32, 18, 12, 8, 4],
};
/** Top spend category weights by age band [fuel, groc, cafe, retail, pharm, ent]. Teens never get pharmacy. */
export const CATEGORY_BY_AGE: readonly (readonly number[])[] = [
  [1, 4, 6, 8, 0, 10],
  [4, 8, 12, 10, 3, 10],
  [8, 14, 12, 10, 4, 7],
  [12, 16, 8, 9, 6, 6],
  [13, 16, 6, 8, 8, 4],
  [12, 16, 6, 7, 12, 3],
  [9, 16, 7, 6, 16, 2],
];
const BUSINESS_CATEGORY = [3, 4, 6, 7, 2, 3];

/* ---------------- the world ---------------- */

export const DEFAULT_SEED = 26112026;

/** [brand mask, people points, business points]. Masks: 1 YourTal, 2 SnapApp, 4 FTR. */
const GROUPS: readonly (readonly [number, number, number])[] = [
  [1, 112000, 2500],
  [2, 30800, 10000],
  [4, 18200, 0],
  [3, 15700, 850],
  [5, 4200, 0],
  [6, 1960, 0],
  [7, 1960, 0],
];

export type Audience = "people" | "businesses" | "both";

export interface PointFilter {
  audience: Audience;
  /** A brand, or "all" for anyone registered with at least one brand. */
  brand: BrandId | "all";
  /** Month index 0..23: registered up to and including this month. */
  month: number;
  /** Age band index 0..6 (people only). */
  ageBand?: number;
  /** Top spend category index (people only). */
  category?: number;
  /** Also require membership of this brand (used to limit an audience to one brand). */
  alsoBrand?: BrandId;
}

export type BrandSeries = Record<BrandId | "god", Float64Array>;

/** The finest h3 resolution (about 2 km across). The maps stop at suburb size: there is no res 8. */
export const FINEST_RES = 7;

/** Maps points to h3 cells. Res 7 is stored; coarser resolutions are derived from the res 7 dictionary. */
export class CellIndex {
  private readonly keyBase: Int32Array;
  private readonly idsBase: string[] = [];
  private readonly lookup = new Map<string, number>();
  private readonly parents = new Map<number, { ids: string[]; map: Int32Array }>();
  private readonly keys = new Map<number, Int32Array>();
  private readonly centreCache = new Map<number, { lat: Float32Array; lon: Float32Array }>();
  private readonly popCache = new Map<number, Float64Array>();

  constructor(n: number) {
    this.keyBase = new Int32Array(n).fill(-1);
  }

  add(i: number, lat: number, lon: number): void {
    const id = latLngToCell(lat, lon, FINEST_RES);
    let o = this.lookup.get(id);
    if (o === undefined) {
      o = this.idsBase.length;
      this.idsBase.push(id);
      this.lookup.set(id, o);
    }
    this.keyBase[i] = o;
  }

  private parent(res: number): { ids: string[]; map: Int32Array } {
    let p = this.parents.get(res);
    if (p) return p;
    const ids: string[] = [];
    const seen = new Map<string, number>();
    const map = new Int32Array(this.idsBase.length);
    for (let o = 0; o < this.idsBase.length; o++) {
      const parent = cellToParent(this.idsBase[o]!, res);
      let po = seen.get(parent);
      if (po === undefined) {
        po = ids.length;
        ids.push(parent);
        seen.set(parent, po);
      }
      map[o] = po;
    }
    p = { ids, map };
    this.parents.set(res, p);
    return p;
  }

  /** Cell ids at a resolution; the index of an id is the key used by `keysAt`. */
  idsAt(res: number): readonly string[] {
    if (res > FINEST_RES) throw new RangeError(`h3 resolution ${res} is finer than the finest (${FINEST_RES})`);
    return res === FINEST_RES ? this.idsBase : this.parent(res).ids;
  }

  /** One key per point (-1: the point has no cell). */
  keysAt(res: number): Int32Array {
    if (res === FINEST_RES) return this.keyBase;
    let k = this.keys.get(res);
    if (k) return k;
    const { map } = this.parent(res);
    k = new Int32Array(this.keyBase.length);
    for (let i = 0; i < k.length; i++) {
      const o = this.keyBase[i]!;
      k[i] = o < 0 ? -1 : map[o]!;
    }
    this.keys.set(res, k);
    return k;
  }

  centresAt(res: number): { lat: Float32Array; lon: Float32Array } {
    let c = this.centreCache.get(res);
    if (c) return c;
    const ids = this.idsAt(res);
    const lat = new Float32Array(ids.length);
    const lon = new Float32Array(ids.length);
    for (let o = 0; o < ids.length; o++) {
      const ll = cellToLatLng(ids[o]!);
      lat[o] = ll[0];
      lon[o] = ll[1];
    }
    c = { lat, lon };
    this.centreCache.set(res, c);
    return c;
  }

  /**
   * Residents in a cell, from the ABS estimate: the mean residents-per-km2 of the SA2s at the cell's centre and at
   * six points halfway to its corners (water counts as none), times the cell's area. Memoised per resolution.
   */
  populationAt(res: number, key: number): number {
    let pop = this.popCache.get(res);
    if (!pop) {
      pop = new Float64Array(this.idsAt(res).length).fill(-1);
      this.popCache.set(res, pop);
    }
    const hit = pop[key]!;
    if (hit >= 0) return hit;
    const c = this.centresAt(res);
    const lat0 = c.lat[key]!;
    const lon0 = c.lon[key]!;
    const sa2 = areas("sa2");
    const density = (lat: number, lon: number): number => {
      const i = sa2IndexAt(lon, lat);
      const a = i < 0 ? undefined : sa2[i];
      return a && a.areaKm2 > 0 ? a.population / a.areaKm2 : 0;
    };
    let sum = density(lat0, lon0);
    for (const [vlat, vlon] of cellToBoundary(this.idsAt(res)[key]!)) {
      sum += density(lat0 + (vlat - lat0) * 0.55, lon0 + (vlon - lon0) * 0.55);
    }
    const v = (sum / 7) * getHexagonAreaAvg(res, UNITS.km2);
    pop[key] = v;
    return v;
  }
}

export interface World {
  readonly seed: number;
  /** Number of sample points (people and businesses). */
  readonly n: number;
  readonly lat: Float32Array;
  readonly lon: Float32Array;
  /** State index 0..7, as in STATE_CODES. */
  readonly state: Int8Array;
  /** Brand membership bits: 1 YourTal, 2 SnapApp, 4 FTR. */
  readonly mask: Uint8Array;
  readonly isBusiness: Uint8Array;
  /** How many registered people a person point stands for (1..5). Businesses are 1. */
  readonly weight: Uint8Array;
  /** Age band 0..6 for people, 255 for businesses. */
  readonly age: Uint8Array;
  /** Top spend category 0..5. */
  readonly category: Uint8Array;
  /** Month index each brand was joined, 255 when not a member. Indexed by BRANDS order. */
  readonly join: readonly Uint8Array[];
  /** First month any brand was joined. */
  readonly joinAny: Uint8Array;
  /** Index of the SA2 each point is in (position in `areas("sa2")` of @god/geo). */
  readonly sa2: Uint16Array;
  /** Registered people by month (running total), per brand and for all GOD (counted once per person). */
  readonly peopleByMonth: BrandSeries;
  readonly businessesByMonth: BrandSeries;
  /** People by brand mask (index = mask 1..7) at the current month. */
  readonly peopleByMask: Float64Array;
  readonly teenPeople: number;
  readonly cells: CellIndex;
  /** h3 cells of where people spend (SnapApp people only; a jittered point near home, never home). */
  readonly activity: CellIndex;
  /** Sum of weights per key over the points that match the filter. */
  aggregate(filter: PointFilter, keys: ArrayLike<number>, size: number): Float64Array;
}

function seasonFactor(brand: number, month: number): number {
  const cal = calendarMonth(month);
  return brand === 2 && cal >= 7 && cal <= 10 ? 1.9 : 0;
}

/** Cumulative share of each brand's members that joined by month m. */
function joinCurves(): number[][] {
  const base = [0.12, 0.16, 0.1];
  const ramp = [0.07, 0.045, 0.025];
  return [0, 1, 2].map((b) => {
    const w: number[] = [];
    for (let m = 1; m < MONTH_COUNT; m++) w.push(1 + ramp[b]! * m + seasonFactor(b, m));
    const total = w.reduce((a, c) => a + c, 0);
    const cum: number[] = [base[b]!];
    for (const x of w) cum.push(cum[cum.length - 1]! + (x / total) * (1 - base[b]!));
    return cum;
  });
}

function build(seed: number): World {
  const rnd: Rng = mulberry32(seed);
  const curves = joinCurves();
  let n = 0;
  for (const g of GROUPS) n += g[1] + g[2];

  const lat = new Float32Array(n);
  const lon = new Float32Array(n);
  const state = new Int8Array(n);
  const mask = new Uint8Array(n);
  const isBusiness = new Uint8Array(n);
  const weight = new Uint8Array(n);
  const age = new Uint8Array(n).fill(255);
  const category = new Uint8Array(n);
  const join = [0, 1, 2].map(() => new Uint8Array(n).fill(255));
  const joinAny = new Uint8Array(n).fill(255);
  const sa2 = new Uint16Array(n);
  const placement = getPlacement();
  const activityLat = new Float32Array(n);
  const activityLon = new Float32Array(n);

  const adultCum = new Map<number, number[]>();
  for (let m = 1; m < 8; m++) {
    const v = [0, 0, 0, 0, 0, 0];
    for (let b = 0; b < 3; b++) {
      if (m & (1 << b)) ADULT_AGE[BRANDS[b]!].forEach((x, i) => (v[i] = v[i]! + x));
    }
    adultCum.set(m, cumulative(v));
  }
  const catCum = CATEGORY_BY_AGE.map((w) => cumulative(w));
  const bizCatCum = cumulative(BUSINESS_CATEGORY);

  let k = 0;
  const add = (m: number, biz: boolean) => {
    const firstBrand = m & 1 ? 0 : m & 2 ? 1 : 2;
    // An SA2 by real population (and the brand's affinity), then a random point inside its outline.
    const sa = pickCum(biz ? placement.bizCum : placement.brandCum[firstBrand]!, rnd());
    const [lo, la] = randomPointInSa2(sa, rnd);
    lat[k] = la;
    lon[k] = lo;
    state[k] = placement.sa2State[sa]!;
    sa2[k] = sa;
    mask[k] = m;
    isBusiness[k] = biz ? 1 : 0;
    let first = 255;
    for (let b = 0; b < 3; b++) {
      if (!(m & (1 << b))) continue;
      const u = rnd();
      const cv = curves[b]!;
      let jm = MONTH_COUNT - 1;
      for (let x = 0; x < MONTH_COUNT; x++) {
        if (u <= cv[x]!) {
          jm = x;
          break;
        }
      }
      join[b]![k] = jm;
      if (jm < first) first = jm;
    }
    joinAny[k] = first;
    if (biz) {
      weight[k] = 1;
      category[k] = pickCum(bizCatCum, rnd());
    } else {
      weight[k] = 1 + Math.floor(rnd() * 5);
      const teenAllowed = (m & 4) === 0;
      const a = teenAllowed && rnd() < placement.teenP[sa]! ? 0 : 1 + pickCum(adultCum.get(m)!, rnd());
      age[k] = a;
      category[k] = pickCum(catCum[a]!, rnd());
      if (m & 2) {
        const ang = rnd() * Math.PI * 2;
        const km = 1 + rnd() * 12;
        activityLat[k] = la + (Math.sin(ang) * km) / 110.57;
        activityLon[k] = lo + (Math.cos(ang) * km) / (111.32 * Math.cos((la * Math.PI) / 180));
      }
    }
    k++;
  };
  for (const [m, people, biz] of GROUPS) {
    for (let i = 0; i < people; i++) add(m, false);
    for (let i = 0; i < biz; i++) add(m, true);
  }

  // Running totals by month.
  const mk = () => new Float64Array(MONTH_COUNT);
  const peopleDelta: BrandSeries = { yourtal: mk(), snapapp: mk(), ftr: mk(), god: mk() };
  const bizDelta: BrandSeries = { yourtal: mk(), snapapp: mk(), ftr: mk(), god: mk() };
  const peopleByMask = new Float64Array(8);
  let teenPeople = 0;
  for (let i = 0; i < n; i++) {
    const target = isBusiness[i] ? bizDelta : peopleDelta;
    const w = weight[i]!;
    for (let b = 0; b < 3; b++) {
      const jm = join[b]![i]!;
      if (jm !== 255) target[BRANDS[b]!][jm] = target[BRANDS[b]!][jm]! + w;
    }
    target.god[joinAny[i]!] = target.god[joinAny[i]!]! + w;
    if (!isBusiness[i]) {
      peopleByMask[mask[i]!] = peopleByMask[mask[i]!]! + w;
      if (age[i] === 0) teenPeople += w;
    }
  }
  const prefix = (d: BrandSeries): BrandSeries => {
    for (const key of [...BRANDS, "god"] as const) {
      const a = d[key];
      for (let m = 1; m < MONTH_COUNT; m++) a[m] = a[m]! + a[m - 1]!;
    }
    return d;
  };

  // h3 indexes are built lazily (they cost about a second).
  let cells: CellIndex | null = null;
  let activity: CellIndex | null = null;
  const world: World = {
    seed,
    n,
    lat,
    lon,
    state,
    mask,
    isBusiness,
    weight,
    age,
    category,
    join,
    joinAny,
    sa2,
    peopleByMonth: prefix(peopleDelta),
    businessesByMonth: prefix(bizDelta),
    peopleByMask,
    teenPeople,
    get cells() {
      if (!cells) {
        cells = new CellIndex(n);
        for (let i = 0; i < n; i++) cells.add(i, lat[i]!, lon[i]!);
      }
      return cells;
    },
    get activity() {
      if (!activity) {
        activity = new CellIndex(n);
        for (let i = 0; i < n; i++) {
          if (!isBusiness[i] && (mask[i]! & 2) !== 0) activity.add(i, activityLat[i]!, activityLon[i]!);
        }
      }
      return activity;
    },
    aggregate(f, keys, size) {
      const out = new Float64Array(size);
      const wantPeople = f.audience !== "businesses";
      const wantBiz = f.audience !== "people";
      const bi = f.brand === "all" ? -1 : BRANDS.indexOf(f.brand);
      const jm = bi < 0 ? joinAny : join[bi]!;
      const alsoMask = f.alsoBrand ? BRAND_BIT[f.alsoBrand] : 0;
      const filtersPeople = f.ageBand !== undefined || f.category !== undefined;
      for (let i = 0; i < n; i++) {
        const biz = isBusiness[i] === 1;
        if (biz ? !wantBiz : !wantPeople) continue;
        if (jm[i]! > f.month) continue;
        if (alsoMask && (mask[i]! & alsoMask) === 0) continue;
        if (filtersPeople) {
          if (biz) continue;
          if (f.ageBand !== undefined && age[i] !== f.ageBand) continue;
          if (f.category !== undefined && category[i] !== f.category) continue;
        }
        const key = keys[i]!;
        if (key < 0) continue;
        out[key] = out[key]! + weight[i]!;
      }
      return out;
    },
  };
  return world;
}

const worlds = new Map<number, World>();

/** The synthetic world for a seed. Built once per process and memoised. */
export function getWorld(seed: number = DEFAULT_SEED): World {
  let w = worlds.get(seed);
  if (!w) {
    w = build(seed);
    worlds.set(seed, w);
  }
  return w;
}

/** Build without memoising. For tests that compare two builds of the same seed. */
export function buildWorld(seed: number = DEFAULT_SEED): World {
  return build(seed);
}
