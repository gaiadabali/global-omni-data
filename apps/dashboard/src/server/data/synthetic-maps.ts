import {
  areas,
  areasIn,
  getArea,
  isOtherTerritory,
  nationalPopulation,
  nearestSa2,
  nearestSuburb,
  parentChain,
  parentLabel,
  placeForCell,
  rollup,
  sa2IndexAt,
  warmGeo,
  type Area,
} from "@god/geo";
import {
  AGE_BANDS,
  BRAND_BIT,
  CATEGORIES,
  CURRENT_INDEX,
  MONTHS,
  TEEN_BAND,
  generateMerchants,
  getWorld,
  merchantReceipts,
  monthIndex,
  residentsInCell,
  type PointFilter,
  type World,
} from "@god/synthetic";
import { cellToLatLng, getResolution, isValidCell, latLngToCell } from "h3-js";
import type { CountKind } from "../privacy";
import type { BrandId } from "../types";
import {
  count,
  countSeries,
  type ActivityAreaQuery,
  type ActivityAreaRaw,
  type ActivityQuery,
  type ActivityRaw,
  type AreaLevel,
  type AreaQuery,
  type AreaRaw,
  type BBox,
  type H3Res,
  type HotspotQuery,
  type HotspotsRaw,
  type InfluenceQuery,
  type InfluenceRaw,
  type MixRaw,
  type SummaryQuery,
  type SummaryRaw,
} from "./types";

/**
 * The map half of the synthetic provider: influence, summary, area, activity, hotspots and activity-area. Exact
 * numbers in, thresholds applied later by ./present.ts. Geography is real (@god/geo); the people are the sample.
 */

const MAX_CELLS = 20_000;
/** A screen holds a few hundred to a few thousand H3 cells; these caps keep a whole-country request small. */
const MAX_CELLS_RES7 = 8_000;
const MAX_CELLS_RES6 = 5_000;
const TREND_MONTHS = 12;
const SERIES_MONTHS = 24;

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

function monthOrThrow(month: string): number {
  const i = monthIndex(month);
  if (i < 0) throw new RangeError(`month out of range: ${month}`);
  return i;
}

function inBox(lat: number, lon: number, b: BBox | undefined): boolean {
  return !b || (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]);
}

/* ---------------- keys: which area each sample point is in ---------------- */

const levelKeyCache = new WeakMap<World, Map<AreaLevel, ArrayLike<number>>>();

/** One key per point: the index of its area at the level (the SA2 index rolled up). */
function levelKeys(w: World, level: AreaLevel): ArrayLike<number> {
  if (level === "sa2") return w.sa2;
  let m = levelKeyCache.get(w);
  if (!m) levelKeyCache.set(w, (m = new Map()));
  let keys = m.get(level);
  if (!keys) {
    const up = rollup("sa2", level);
    const k = new Int32Array(w.n);
    for (let i = 0; i < w.n; i++) k[i] = up[w.sa2[i]!]!;
    m.set(level, (keys = k));
  }
  return keys;
}

/** The points whose key is `idx`: the sample points of one area. */
function pointsOf(keys: ArrayLike<number>, idx: number): Int32Array {
  let n = 0;
  for (let i = 0; i < keys.length; i++) if (keys[i] === idx) n++;
  const out = new Int32Array(n);
  let k = 0;
  for (let i = 0; i < keys.length; i++) if (keys[i] === idx) out[k++] = i;
  return out;
}

/** A key array that is 0 for the points whose key is `idx` and -1 for the rest, to aggregate one area. */
function only(keys: ArrayLike<number>, idx: number): Int8Array {
  const out = new Int8Array(keys.length).fill(-1);
  for (let i = 0; i < keys.length; i++) if (keys[i] === idx) out[i] = 0;
  return out;
}

const EVERY = new WeakMap<World, Int32Array>();
/** Every sample point, in order. */
function allPoints(w: World): Int32Array {
  let a = EVERY.get(w);
  if (!a) EVERY.set(w, (a = Int32Array.from({ length: w.n }, (_, i) => i)));
  return a;
}

const ALL = new WeakMap<World, Int8Array>();
function everyone(w: World): Int8Array {
  let a = ALL.get(w);
  if (!a) ALL.set(w, (a = new Int8Array(w.n)));
  return a;
}

const parentLabels = new Map<string, string>();
function parentOfArea(level: AreaLevel, id: string): string {
  const k = `${level}:${id}`;
  let v = parentLabels.get(k);
  if (v === undefined) parentLabels.set(k, (v = parentLabel(level, id)));
  return v;
}

/* ---------------- names of H3 cells ---------------- */

const homeCellInfo = new Map<string, { name: string; parent: string }>();

/** The suburb at a home cell's centre, and where that is. The SA2 comes from the first sample point in the cell. */
function homeCell(w: World, res: number, key: number, lat: number, lon: number): { name: string; parent: string } {
  const id = w.cells.idsAt(res)[key]!;
  let hit = homeCellInfo.get(id);
  if (hit) return hit;
  const near = nearestSuburb(lon, lat);
  const sa2Index = w.cells.sa2sAt(res)[key] ?? -1;
  const sa2 = sa2Index >= 0 ? areas("sa2")[sa2Index] : (nearestSa2(lon, lat) ?? (near ? getArea("sa2", near.suburb.sa2) : undefined));
  hit = {
    name: near?.suburb.name ?? sa2?.name ?? "Remote area",
    parent: sa2 ? parentOfArea("sa2", sa2.id) : (near?.suburb.state ?? ""),
  };
  homeCellInfo.set(id, hit);
  return hit;
}

/* ---------------- influence ---------------- */

function newOf(series: Float64Array, o: number, L: number): number {
  return L >= 2 ? series[o + L - 1]! - series[o + L - 2]! : series[o]!;
}

export async function influenceMap(q: InfluenceQuery): Promise<InfluenceRaw> {
  const w = getWorld();
  const m = monthOrThrow(q.month);
  const L = Math.min(TREND_MONTHS, m + 1);
  const trendMonths = MONTHS.slice(m - L + 1, m + 1);
  const filter: PointFilter = { audience: q.audience, brand: q.brand, month: m };

  if (typeof q.level === "string") {
    const level = q.level;
    const keys = levelKeys(w, level);
    const size = areas(level).length;
    const counts = w.aggregate(filter, keys, size);
    const series = w.aggregateSeries(filter, keys, size, L);
    return {
      truncated: false,
      trendMonths,
      cells: areasIn(level, q.bbox).map((a) => ({
        id: a.id,
        name: a.name,
        parent: parentOfArea(level, a.id),
        centroid: a.centroid,
        count: count(counts[a.index]!),
        population: a.population,
        trend: countSeries(Array.from(series.subarray(a.index * L, a.index * L + L))),
        newThisMonth: count(newOf(series, a.index * L, L)),
      })),
    };
  }

  const res: H3Res = q.level.h3;
  const ids = w.cells.idsAt(res);
  const keys = w.cells.keysAt(res);
  const counts = w.aggregate(filter, keys, ids.length);
  const centres = w.cells.centresAt(res);
  const found: { o: number; n: number }[] = [];
  for (let o = 0; o < ids.length; o++) {
    const n = counts[o]!;
    if (n > 0 && inBox(centres.lat[o]!, centres.lon[o]!, q.bbox)) found.push({ o, n });
  }
  const cap = res === 7 ? MAX_CELLS_RES7 : MAX_CELLS_RES6;
  let truncated = false;
  if (found.length > cap) {
    found.sort((a, b) => b.n - a.n);
    found.length = cap;
    truncated = true;
  }
  const series = w.aggregateSeries(filter, keys, ids.length, L);
  return {
    truncated,
    trendMonths,
    cells: found.map(({ o, n }) => {
      const lat = centres.lat[o]!;
      const lon = centres.lon[o]!;
      const place = homeCell(w, res, o, lat, lon);
      return {
        id: ids[o]!,
        name: place.name,
        parent: place.parent,
        centroid: [round4(lon), round4(lat)] as [number, number],
        count: count(n),
        population: Math.round(w.cells.populationAt(res, o)),
        trend: countSeries(Array.from(series.subarray(o * L, o * L + L))),
        newThisMonth: count(newOf(series, o * L, L)),
      };
    }),
  };
}

/* ---------------- summary ---------------- */

export async function mapSummary(q: SummaryQuery): Promise<SummaryRaw> {
  const w = getWorld();
  const m = monthOrThrow(q.month);
  const L = Math.min(TREND_MONTHS, m + 1);
  const filter: PointFilter = { audience: q.audience, brand: q.brand, month: m };
  const keys = levelKeys(w, q.level);
  const list = areas(q.level);
  const series = w.aggregateSeries(filter, keys, list.length, L);
  const national = w.aggregateSeries(filter, everyone(w), 1, L);
  const prev = (s: Float64Array, o: number) => (L >= 2 ? s[o + L - 2]! : 0);
  return {
    trendMonths: MONTHS.slice(m - L + 1, m + 1),
    total: count(national[L - 1]!),
    newThisMonth: count(newOf(national, 0, L)),
    previous: count(prev(national, 0)),
    nationalPopulation: nationalPopulation(),
    areas: list
      .filter((a) => !isOtherTerritory(a))
      .map((a) => ({
        id: a.id,
        name: a.name,
        parent: parentOfArea(q.level, a.id),
        centroid: a.centroid,
        count: count(series[a.index * L + L - 1]!),
        population: a.population,
        change: count(newOf(series, a.index * L, L)),
        previous: count(prev(series, a.index * L)),
        trend: countSeries(Array.from(series.subarray(a.index * L, a.index * L + L))),
      })),
  };
}

/* ---------------- one area ---------------- */

function parentsOf(a: Area): { level: AreaLevel; id: string; name: string }[] {
  return parentChain(a.level, a.id)
    .slice(1)
    .map((x) => ({ level: x.level, id: x.id, name: x.name }));
}

export async function mapArea(q: AreaQuery): Promise<AreaRaw | null> {
  const w = getWorld();
  const m = monthOrThrow(q.month);
  const filter: PointFilter = { audience: q.audience, brand: q.brand, month: m };

  let points: Int32Array;
  let info: AreaRaw["area"];
  let rank: AreaRaw["rank"];

  if (q.level === "h3") {
    if (!isValidCell(q.id)) return null;
    const res = getResolution(q.id);
    if (res !== 6 && res !== 7) return null;
    const key = w.cells.indexOf(res, q.id);
    const keys = w.cells.keysAt(res);
    points = pointsOf(keys, key);
    const [lat, lon] = cellToLatLng(q.id);
    const sa2Index = key >= 0 ? (w.cells.sa2sAt(res)[key] ?? -1) : -1;
    const sa2 = sa2Index >= 0 ? areas("sa2")[sa2Index] : nearestSa2(lon, lat);
    const near = nearestSuburb(lon, lat);
    info = {
      level: "h3",
      id: q.id,
      name: near?.suburb.name ?? sa2?.name ?? "Remote area",
      parent: sa2 ? parentOfArea("sa2", sa2.id) : "",
      parents: sa2 ? [{ level: "sa2", id: sa2.id, name: sa2.name }, ...parentsOf(sa2)] : [],
      population: Math.round(residentsInCell(q.id)),
      centroid: [round4(lon), round4(lat)],
      areaKm2: null,
      res,
    };
    // Rank among the cells whose home SA2 is the same.
    const counts = w.aggregate(filter, keys, w.cells.idsAt(res).length);
    const homes = w.cells.sa2sAt(res);
    const mine = key >= 0 ? counts[key]! : 0;
    let of = 0;
    let better = 0;
    for (let o = 0; o < counts.length; o++) {
      if (counts[o]! <= 0 || homes[o] !== sa2Index) continue;
      of++;
      if (counts[o]! > mine) better++;
    }
    rank = { rank: better + 1, of: Math.max(of, 1), within: sa2?.name ?? "" };
  } else {
    const level = q.level;
    const area = getArea(level, q.id);
    if (!area || isOtherTerritory(area)) return null;
    const keys = levelKeys(w, level);
    points = pointsOf(keys, area.index);
    info = {
      level,
      id: area.id,
      name: area.name,
      parent: parentOfArea(level, area.id),
      parents: parentsOf(area),
      population: area.population,
      centroid: area.centroid,
      areaKm2: area.areaKm2,
    };
    const counts = w.aggregate(filter, keys, areas(level).length);
    const siblings = areas(level).filter((a) => a.parentId === area.parentId && !isOtherTerritory(a));
    let better = 0;
    for (const s of siblings) if (counts[s.index]! > counts[area.index]!) better++;
    const parent = area.parentId ? (getArea(level === "sa2" ? "sa3" : level === "sa3" ? "sa4" : "state", area.parentId) ?? null) : null;
    rank = {
      rank: better + 1,
      of: Math.max(siblings.length, 1),
      within: level === "state" ? "Australia" : (parent?.name ?? ""),
    };
  }

  const value = w.aggregateAt(filter, points);
  const Lm = Math.min(SERIES_MONTHS, m + 1);
  const series = w.aggregateSeriesAt(filter, points, Lm);
  const nationalValue = w.aggregateAt(filter, allPoints(w));
  const brandTotals = (b: BrandId | "all") => ({
    people: count(w.aggregateAt({ audience: "people", brand: b, month: m }, points)),
    businesses: count(w.aggregateAt({ audience: "businesses", brand: b, month: m }, points)),
  });
  const ageMix: AreaRaw["ageMix"] =
    q.audience === "businesses"
      ? []
      : AGE_BANDS.map((band, a) => ({
          band,
          teen: a === TEEN_BAND,
          people: count(
            w.aggregateAt({ audience: "people", brand: q.brand, month: m, ageBand: a }, points),
            a === TEEN_BAND ? "teen" : "adult",
          ),
        }));

  return {
    area: info,
    value: count(value),
    newThisMonth: count(newOf(series, 0, Lm)),
    previous: count(Lm >= 2 ? series[Lm - 2]! : 0),
    nationalPopulation: nationalPopulation(),
    nationalValue,
    rank,
    brands: q.visibleBrands.map((b) => ({ brand: b, ...brandTotals(b) })),
    god: q.showGod ? brandTotals("all") : null,
    seriesMonths: MONTHS.slice(m - Lm + 1, m + 1),
    series: countSeries(Array.from(series)),
    ageMix,
  };
}

/* ---------------- activity ---------------- */

interface ActivityContext {
  w: World;
  month: number;
  cat: number | undefined;
  age: number | undefined;
  teen: boolean;
  factor: number;
  audienceShare: number;
  heatKind: CountKind;
}

function activityContext(q: {
  month: string;
  category?: string;
  ageBand?: string;
  audienceBrand?: BrandId;
}): ActivityContext {
  const w = getWorld();
  const month = monthOrThrow(q.month);
  const cat = q.category === undefined ? undefined : CATEGORIES.findIndex((c) => c.id === q.category);
  const age = q.ageBand === undefined ? undefined : AGE_BANDS.indexOf(q.ageBand as (typeof AGE_BANDS)[number]);
  if (cat !== undefined && cat < 0) throw new RangeError(`unknown category: ${q.category}`);
  if (age !== undefined && age < 0) throw new RangeError(`unknown age band: ${q.ageBand}`);
  const teen = age === TEEN_BAND;
  if (teen && cat !== undefined && CATEGORIES[cat]!.sensitive) {
    throw new RangeError("sensitive categories never appear in teen figures");
  }
  // Month factor: receipts that month relative to now, from SnapApp's growth.
  const sa = w.peopleByMonth.snapapp;
  const factor = sa[month]! / sa[CURRENT_INDEX]!;
  // Share of SnapApp people who also use the brand a brand lead is limited to.
  let audienceShare = 1;
  if (q.audienceBrand) {
    const bit = BRAND_BIT[q.audienceBrand];
    let both = 0;
    let saTotal = 0;
    for (let mask = 1; mask < 8; mask++) {
      if (!(mask & 2)) continue;
      saTotal += w.peopleByMask[mask]!;
      if (mask & bit) both += w.peopleByMask[mask]!;
    }
    audienceShare = saTotal ? both / saTotal : 0;
  }
  const heatKind: CountKind = teen ? "teen" : cat !== undefined && CATEGORIES[cat]!.sensitive ? "sensitive" : "adult";
  return { w, month, cat, age, teen, factor, audienceShare, heatKind };
}

function activityFilter(c: ActivityContext, brand?: BrandId): PointFilter {
  return {
    audience: "people",
    brand: "snapapp",
    month: c.month,
    ageBand: c.age,
    category: c.cat,
    alsoBrand: brand,
  };
}

export async function activityMap(q: ActivityQuery): Promise<ActivityRaw> {
  const c = activityContext(q);
  const { w } = c;
  const merchants: ActivityRaw["merchants"] = [];
  for (const m of generateMerchants()) {
    if (!inBox(m.lat, m.lon, q.bbox)) continue;
    if (c.cat !== undefined && m.category !== c.cat) continue;
    const cat = CATEGORIES[m.category]!;
    if (c.teen && cat.sensitive) continue;
    const receipts = merchantReceipts(m, { factor: c.factor, ageBand: c.age, audienceShare: c.audienceShare });
    merchants.push({
      id: m.id,
      name: m.name,
      category: cat.id,
      lat: m.lat,
      lon: m.lon,
      receipts: count(receipts, c.teen ? "teen" : cat.sensitive ? "sensitive" : "adult"),
    });
  }

  const ids = w.activity.idsAt(q.h3);
  const counts = w.aggregate(activityFilter(c, q.audienceBrand), w.activity.keysAt(q.h3), ids.length);
  const centres = w.activity.centresAt(q.h3);
  const found: { o: number; n: number }[] = [];
  for (let o = 0; o < ids.length; o++) {
    const n = counts[o]!;
    if (n > 0 && inBox(centres.lat[o]!, centres.lon[o]!, q.bbox)) found.push({ o, n });
  }
  let truncated = false;
  const cap = q.h3 === 7 ? MAX_CELLS_RES7 : MAX_CELLS;
  if (found.length > cap) {
    found.sort((a, b) => b.n - a.n);
    found.length = cap;
    truncated = true;
  }
  return {
    truncated,
    merchants,
    heat: found.map(({ o, n }) => {
      const place = placeForCell(ids[o]!);
      return {
        id: ids[o]!,
        name: place.name,
        parent: place.parent,
        centroid: [round4(centres.lon[o]!), round4(centres.lat[o]!)] as [number, number],
        people: count(n, c.heatKind),
      };
    }),
  };
}

/** Category mix for the keys: every category the audience may see (teens: no sensitive ones). */
function categoryMix(c: ActivityContext, brand: BrandId | undefined, keys: ArrayLike<number>, size: number): Float64Array[] {
  return CATEGORIES.map((cat, i) =>
    c.teen && cat.sensitive
      ? new Float64Array(size)
      : c.w.aggregate({ ...activityFilter(c, brand), category: i }, keys, size),
  );
}

export async function activityHotspots(q: HotspotQuery): Promise<HotspotsRaw> {
  const c = activityContext(q);
  const { w } = c;
  const res = 7;
  const ids = w.activity.idsAt(res);
  const keys = w.activity.keysAt(res);
  const counts = w.aggregate(activityFilter(c, q.audienceBrand), keys, ids.length);
  const centres = w.activity.centresAt(res);
  const found: { o: number; n: number }[] = [];
  for (let o = 0; o < ids.length; o++) {
    const n = counts[o]!;
    if (n > 0 && inBox(centres.lat[o]!, centres.lon[o]!, q.bbox)) found.push({ o, n });
  }
  found.sort((a, b) => b.n - a.n || (ids[a.o]! < ids[b.o]! ? -1 : 1));
  const top = found.slice(0, q.limit);
  // The mix ignores the category filter: it shows what else happens in the area.
  const mixCounts = categoryMix({ ...c, cat: undefined }, q.audienceBrand, keys, ids.length);
  return {
    hotspots: top.map(({ o, n }) => {
      const place = placeForCell(ids[o]!);
      return {
        id: ids[o]!,
        name: place.name,
        parent: place.parent,
        centroid: [round4(centres.lon[o]!), round4(centres.lat[o]!)] as [number, number],
        people: count(n, c.heatKind),
        mix: CATEGORIES.flatMap((cat, i): MixRaw[] =>
          c.teen && cat.sensitive
            ? []
            : [
                {
                  key: cat.id,
                  name: cat.name,
                  sensitive: cat.sensitive,
                  teen: c.teen,
                  people: count(mixCounts[i]![o]!, c.teen ? "teen" : cat.sensitive ? "sensitive" : "adult"),
                },
              ],
        ),
      };
    }),
  };
}

const activitySa2Cache = new WeakMap<object, Int32Array>();
/** The SA2 holding each sample point's activity cell centre (-1: no activity cell, or in the sea). */
function activitySa2Keys(w: World): Int32Array {
  let k = activitySa2Cache.get(w.activity);
  if (k) return k;
  const keys = w.activity.keysAt(7);
  const centres = w.activity.centresAt(7);
  const cellSa2 = new Int32Array(w.activity.idsAt(7).length);
  for (let o = 0; o < cellSa2.length; o++) cellSa2[o] = sa2IndexAt(centres.lon[o]!, centres.lat[o]!);
  k = new Int32Array(w.n);
  for (let i = 0; i < w.n; i++) k[i] = keys[i]! < 0 ? -1 : cellSa2[keys[i]!]!;
  activitySa2Cache.set(w.activity, k);
  return k;
}

const merchantCellCache = new Map<number, string[]>();
function merchantCells(res: number): string[] {
  let l = merchantCellCache.get(res);
  if (!l) {
    l = generateMerchants().map((m) => latLngToCell(m.lat, m.lon, res));
    merchantCellCache.set(res, l);
  }
  return l;
}

export async function activityArea(q: ActivityAreaQuery): Promise<ActivityAreaRaw | null> {
  const c = activityContext(q);
  const { w } = c;
  let target: Int8Array;
  let info: ActivityAreaRaw["area"];
  let inArea: (i: number) => boolean;
  const merchants = generateMerchants();

  if (q.level === "h3") {
    if (!isValidCell(q.id)) return null;
    const res = getResolution(q.id);
    if (res < 5 || res > 7) return null;
    target = only(w.activity.keysAt(res), w.activity.indexOf(res, q.id));
    const place = placeForCell(q.id);
    const [lat, lon] = cellToLatLng(q.id);
    info = { level: "h3", id: q.id, name: place.name, parent: place.parent, centroid: [round4(lon), round4(lat)] };
    const cells = merchantCells(res);
    inArea = (i) => cells[i] === q.id;
  } else {
    const area = getArea("sa2", q.id);
    if (!area || isOtherTerritory(area)) return null;
    target = only(activitySa2Keys(w), area.index);
    info = {
      level: "sa2",
      id: area.id,
      name: area.name,
      parent: parentOfArea("sa2", area.id),
      centroid: area.centroid,
    };
    inArea = (i) => merchants[i]!.sa2 === area.id;
  }

  const total = w.aggregate(activityFilter(c, q.audienceBrand), target, 1)[0]!;
  const catCounts = categoryMix({ ...c, cat: undefined }, q.audienceBrand, target, 1);
  const categoryMixRows: MixRaw[] = CATEGORIES.flatMap((cat, i): MixRaw[] =>
    c.teen && cat.sensitive
      ? []
      : [
          {
            key: cat.id,
            name: cat.name,
            sensitive: cat.sensitive,
            teen: c.teen,
            people: count(catCounts[i]![0]!, c.teen ? "teen" : cat.sensitive ? "sensitive" : "adult"),
          },
        ],
  );
  // The age mix ignores the age filter. The teen band never appears next to a sensitive category.
  const sensitiveCat = c.cat !== undefined && CATEGORIES[c.cat]!.sensitive;
  const ageMixRows: MixRaw[] = AGE_BANDS.flatMap((band, a): MixRaw[] => {
    if (a === TEEN_BAND && sensitiveCat) return [];
    const n = w.aggregate({ ...activityFilter(c, q.audienceBrand), ageBand: a }, target, 1)[0]!;
    const kind: CountKind = a === TEEN_BAND ? "teen" : sensitiveCat ? "sensitive" : "adult";
    return [{ key: band, name: band, sensitive: false, teen: a === TEEN_BAND, people: count(n, kind) }];
  });

  const shops: ActivityAreaRaw["merchants"] = [];
  merchants.forEach((m, i) => {
    if (!inArea(i)) return;
    if (c.cat !== undefined && m.category !== c.cat) return;
    const cat = CATEGORIES[m.category]!;
    if (c.teen && cat.sensitive) return;
    const receipts = merchantReceipts(m, { factor: c.factor, ageBand: c.age, audienceShare: c.audienceShare });
    shops.push({
      id: m.id,
      name: m.name,
      category: cat.id,
      suburb: m.suburb,
      lat: m.lat,
      lon: m.lon,
      receipts: count(receipts, c.teen ? "teen" : cat.sensitive ? "sensitive" : "adult"),
    });
  });
  shops.sort((a, b) => b.receipts.n - a.receipts.n || (a.id < b.id ? -1 : 1));

  return {
    area: info,
    total: count(total, c.heatKind),
    categoryMix: categoryMixRows,
    ageMix: ageMixRows,
    merchants: shops.slice(0, 10),
  };
}

/** Builds the geography and every index the map queries use, ahead of the first request. */
export function warmMaps(): void {
  warmGeo();
  const w = getWorld();
  for (const res of [3, 4, 5, 6, 7]) {
    w.cells.keysAt(res);
    w.cells.centresAt(res);
    w.cells.sa2sAt(res);
  }
  for (const res of [5, 6, 7]) {
    w.activity.keysAt(res);
    w.activity.centresAt(res);
  }
  levelKeys(w, "state");
  levelKeys(w, "sa4");
  levelKeys(w, "sa3");
  generateMerchants();
}
