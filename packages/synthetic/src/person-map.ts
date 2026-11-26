import { areNeighborCells, cellToLatLng, cellsToMultiPolygon, gridDisk, latLngToCell } from "h3-js";
import { boundaryGeoJSON, getArea, getSuburb } from "@god/geo";

/**
 * Person 360: where one adult's receipts cluster. SUBURB PRECISION, by design (founder decision, 2026-11-27):
 *
 *  - an activity area is a fence: the union of the H3 res-7 cells (about 2 km across) that hold its receipts,
 *    plus one smoothing ring only where it fills a gap, or, for a home held as a declared postcode, that SA2's
 *    real boundary (an SA2 is about a suburb);
 *  - a receipt is shown at the centre of its H3 res-7 cell, or at its suburb's point inside a declared SA2.
 *    Exact shop coordinates never leave this file;
 *  - the context outlines are SA2s, simplified.
 *
 * Pure and deterministic: the same receipts give the same areas. Receipts here are non-sensitive categories only
 * (the caller never passes pharmacy or health).
 */

export const MAP_RES = 7;
/** The window the receipts cover, in days. */
export const MAP_DAYS = 90;
/** An area needs at least this many receipts at this many different shops (the plan). */
export const MIN_AREA_RECEIPTS = 5;
export const MIN_AREA_PLACES = 3;
/** Cells this many rings apart (or fewer) belong to one cluster: two rings is about 5 km. */
const LINK_RINGS = 2;
/** A declared home SA2 bigger than this is not drawn as the fence: it is no longer about a suburb. */
export const MAX_HOME_SA2_KM2 = 150;

export type AreaKind = "home" | "work" | "weekend";

/** One receipt, as the map builder takes it. The coordinates are the shop's: they stay inside this file. */
export interface MapReceipt {
  merchantId: string;
  /** The business name ("Harbour & Bean Parramatta"). Businesses are not people, so the name is shown. */
  merchant: string;
  suburb: string;
  suburbCode: string;
  state: string;
  sa2: string;
  category: string;
  categoryName: string;
  /** "YYYY-MM-DD" */
  date: string;
  lat: number;
  lon: number;
}

export type FenceGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface MapBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface AreaCategory {
  category: string;
  label: string;
  receipts: number;
  /** Share of the area's receipts, 0 to 1. */
  share: number;
}

export interface ActivityAreaDetail {
  kind: AreaKind;
  /** The area's name: its main suburb. (Called `label` so no field of a person's profile is named "name".) */
  label: string;
  /** All its suburbs, the busiest first. */
  suburbs: string[];
  /** "receipts": a fence of H3 cells. "declared": the home postcode's SA2 outline. */
  basis: "receipts" | "declared";
  receipts: number;
  /** Share of all this person's receipts in the window, 0 to 1. */
  share: number;
  categories: AreaCategory[];
  /** A point inside the fence, for its label. */
  centre: { lon: number; lat: number };
  fence: FenceGeometry;
}

/** A receipt dot: snapped to a cell centre (or a suburb point), and the receipts stacked on it. */
export interface ActivityPoint {
  area: AreaKind;
  lon: number;
  lat: number;
  receipts: number;
}

export interface ActivityOutlier {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  suburb: string;
  state: string;
  category: string;
  categoryName: string;
  merchant: string;
  /** Snapped to the H3 res-7 cell centre. */
  lon: number;
  lat: number;
  /** Distance to the nearest area, rounded (5 km steps under 50 km, 10 under 200, 50 above). */
  distanceKm: number;
  from: AreaKind | "home suburb";
  /** "120 km from home area" */
  distanceText: string;
}

export interface ContextOutline {
  code: string;
  geometry: FenceGeometry;
}

export interface ActivityMapDetail {
  days: number;
  totalReceipts: number;
  areas: ActivityAreaDetail[];
  points: ActivityPoint[];
  outliers: ActivityOutlier[];
  /** The box round the areas, and round the areas and outliers together. */
  view: { areas: MapBox; all: MapBox };
  /** Simplified SA2 outlines near the areas and near each outlier, for context. */
  context: ContextOutline[];
}

export interface HomeInput {
  lat: number;
  lon: number;
  /** The SA2 of a declared home postcode (adult, Free Tax Returns), or null. */
  declaredSa2: string | null;
  /** Leave the context outlines out (a search over many profiles does not need them). Default: include them. */
  skipContext?: boolean;
}

/* ---------------- small geometry ---------------- */

const KM_LAT = 110.57;
const KM_LON = 111.32;
function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dy = (lat2 - lat1) * KM_LAT;
  const dx = (lon2 - lon1) * KM_LON * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Douglas-Peucker on an open or closed coordinate list. Iterative, so a long coastline cannot overflow the stack. */
function simplify(pts: number[][], tol: number): number[][] {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let fd = tol;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const dx = bx! - ax!;
    const dy = by! - ay!;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!;
      let d: number;
      if (len2 === 0) d = Math.hypot(px! - ax!, py! - ay!);
      else {
        const t = Math.max(0, Math.min(1, ((px! - ax!) * dx + (py! - ay!) * dy) / len2));
        d = Math.hypot(px! - (ax! + t * dx), py! - (ay! + t * dy));
      }
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

function simplifyRing(ring: number[][], tol: number): number[][] | null {
  // A closed ring is cut at its farthest point from the start, so both halves simplify, then joined again.
  let out = simplify(ring, tol).map(([x, y]) => [round(x!, 4), round(y!, 4)]);
  out = out.filter((p, i) => i === 0 || p[0] !== out[i - 1]![0] || p[1] !== out[i - 1]![1]);
  if (out.length < 4) return null;
  const f = out[0]!;
  const l = out[out.length - 1]!;
  if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0]!, f[1]!]);
  return out.length >= 4 ? out : null;
}

function bboxOfRings(rings: number[][][]): MapBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      if (x! < west) west = x!;
      if (x! > east) east = x!;
      if (y! < south) south = y!;
      if (y! > north) north = y!;
    }
  return { west, south, east, north };
}

function polygonsOfGeometry(g: FenceGeometry): number[][][][] {
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

function toGeometry(polys: number[][][][]): FenceGeometry {
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0]! } : { type: "MultiPolygon", coordinates: polys };
}

export function geometryBox(g: FenceGeometry): MapBox {
  return bboxOfRings(polygonsOfGeometry(g).flatMap((p) => p));
}

function unionBox(boxes: MapBox[]): MapBox {
  return {
    west: Math.min(...boxes.map((b) => b.west)),
    south: Math.min(...boxes.map((b) => b.south)),
    east: Math.max(...boxes.map((b) => b.east)),
    north: Math.max(...boxes.map((b) => b.north)),
  };
}

/* ---------------- SA2 outlines (real, ABS) ---------------- */

interface Sa2Feature {
  code: string;
  polys: number[][][][];
  box: MapBox;
}
let sa2Cache: Sa2Feature[] | null = null;
function sa2Features(): Sa2Feature[] {
  if (sa2Cache) return sa2Cache;
  sa2Cache = boundaryGeoJSON("sa2").features.map((f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    return { code: String(f.properties["code"] ?? f.id), polys, box: bboxOfRings(polys.flatMap((p) => p)) };
  });
  return sa2Cache;
}

/** An SA2's outline with its rings simplified to about 0.8% of its size, tiny islands dropped. Null if none is left. */
function simplifiedSa2(f: Sa2Feature, minRingSize = 0): FenceGeometry | null {
  const size = Math.max(f.box.east - f.box.west, f.box.north - f.box.south);
  const tol = Math.max(0.0006, 0.005 * size);
  const polys: number[][][][] = [];
  for (const p of f.polys) {
    const outer = p[0];
    if (!outer) continue;
    const b = bboxOfRings([outer]);
    if (Math.max(b.east - b.west, b.north - b.south) < minRingSize) continue;
    const rings = p.map((r) => simplifyRing(r, tol)).filter((r): r is number[][] => r !== null);
    if (rings.length) polys.push(rings);
  }
  return polys.length ? toGeometry(polys) : null;
}

const touches = (a: MapBox, b: MapBox) => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;

function padBox(b: MapBox, fraction: number, min: number): MapBox {
  const px = Math.max(min, (b.east - b.west) * fraction);
  const py = Math.max(min, (b.north - b.south) * fraction);
  return { west: b.west - px, south: b.south - py, east: b.east + px, north: b.north + py };
}

/**
 * Simplified SA2 outlines meeting the boxes: the faint land under the fences. Each box keeps its nearest `cap`
 * outlines (by distance from the box centre), so a busy city cannot make the answer large.
 */
export function contextOutlines(boxes: { box: MapBox; cap: number }[]): ContextOutline[] {
  const out: ContextOutline[] = [];
  const seen = new Set<string>();
  for (const { box, cap } of boxes) {
    const cx = (box.west + box.east) / 2;
    const cy = (box.south + box.north) / 2;
    const near = sa2Features()
      .filter((f) => touches(f.box, box))
      .map((f) => ({ f, d: Math.hypot((f.box.west + f.box.east) / 2 - cx, (f.box.south + f.box.north) / 2 - cy) }))
      .sort((a, b) => a.d - b.d || a.f.code.localeCompare(b.f.code))
      .slice(0, cap);
    for (const { f } of near) {
      if (seen.has(f.code)) continue;
      const g = simplifiedSa2(f, 0.002);
      if (!g) continue;
      seen.add(f.code);
      out.push({ code: f.code, geometry: g });
    }
  }
  return out;
}

/* ---------------- clustering ---------------- */

interface Cluster {
  receipts: MapReceipt[];
  cells: Map<string, MapReceipt[]>;
}

function weekdayShare(rs: readonly MapReceipt[]): number {
  if (!rs.length) return 0;
  let wd = 0;
  for (const r of rs) {
    const d = new Date(`${r.date}T00:00:00Z`).getUTCDay();
    if (d !== 0 && d !== 6) wd++;
  }
  return wd / rs.length;
}

function clusterCells(rs: readonly MapReceipt[]): Cluster[] {
  const byCell = new Map<string, MapReceipt[]>();
  for (const r of rs) {
    const c = latLngToCell(r.lat, r.lon, MAP_RES);
    const l = byCell.get(c);
    if (l) l.push(r);
    else byCell.set(c, [r]);
  }
  const cells = [...byCell.keys()].sort();
  const parent = new Map(cells.map((c) => [c, c] as const));
  const find = (c: string): string => {
    let p = parent.get(c)!;
    while (p !== parent.get(p)!) p = parent.get(p)!;
    parent.set(c, p);
    return p;
  };
  for (const c of cells) {
    for (const n of gridDisk(c, LINK_RINGS)) {
      if (n === c || !byCell.has(n)) continue;
      const a = find(c);
      const b = find(n);
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    }
  }
  const groups = new Map<string, Cluster>();
  for (const c of cells) {
    const root = find(c);
    let g = groups.get(root);
    if (!g) {
      g = { receipts: [], cells: new Map() };
      groups.set(root, g);
    }
    g.cells.set(c, byCell.get(c)!);
    g.receipts.push(...byCell.get(c)!);
  }
  return [...groups.values()];
}

function qualifies(rs: readonly MapReceipt[]): boolean {
  return rs.length >= MIN_AREA_RECEIPTS && new Set(rs.map((r) => r.merchantId)).size >= MIN_AREA_PLACES;
}

/**
 * The cells of a fence: every cell holding a receipt, plus one ring only where it fills a gap: an empty cell with
 * three or more fenced neighbours, or two that are not neighbours of each other (it bridges them). One pass, and
 * never a cell that already belongs to another area.
 */
export function fenceCells(occupied: readonly string[], taken: ReadonlySet<string>): string[] {
  const set = new Set(occupied);
  const add = new Set<string>();
  const candidates = new Set<string>();
  for (const c of occupied) for (const n of gridDisk(c, 1)) if (!set.has(n)) candidates.add(n);
  for (const c of [...candidates].sort()) {
    if (taken.has(c)) continue;
    const nb = gridDisk(c, 1).filter((n) => n !== c && set.has(n));
    if (nb.length >= 3) add.add(c);
    else if (nb.length === 2 && !areNeighborCells(nb[0]!, nb[1]!)) add.add(c);
  }
  return [...set, ...add].sort();
}

function cellsGeometry(cells: readonly string[]): FenceGeometry {
  const polys = cellsToMultiPolygon([...cells], true).map((p) => p.map((r) => r.map(([x, y]) => [round(x!, 5), round(y!, 5)])));
  return toGeometry(polys);
}

function cellCentre(c: string): { lon: number; lat: number } {
  const [lat, lon] = cellToLatLng(c);
  return { lon: round(lon, 5), lat: round(lat, 5) };
}

/* ---------------- the builder ---------------- */

function describe(
  kind: AreaKind,
  rs: readonly MapReceipt[],
  total: number,
  basis: ActivityAreaDetail["basis"],
  centre: { lon: number; lat: number },
  fence: FenceGeometry,
  fallbackName: string,
): ActivityAreaDetail {
  const bySuburb = new Map<string, number>();
  const byCat = new Map<string, { name: string; n: number }>();
  for (const r of rs) {
    bySuburb.set(r.suburb, (bySuburb.get(r.suburb) ?? 0) + 1);
    const c = byCat.get(r.category) ?? { name: r.categoryName, n: 0 };
    c.n++;
    byCat.set(r.category, c);
  }
  const suburbs = [...bySuburb.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  const categories = [...byCat.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([category, v]) => ({ category, label: v.name, receipts: v.n, share: round(v.n / Math.max(1, rs.length), 3) }));
  return {
    kind,
    label: suburbs[0] ?? fallbackName,
    suburbs: suburbs.slice(0, 8),
    basis,
    receipts: rs.length,
    share: round(rs.length / Math.max(1, total), 3),
    categories,
    centre,
    fence,
  };
}

function roundKm(d: number): number {
  if (d < 10) return Math.max(1, Math.round(d));
  if (d < 50) return 5 * Math.round(d / 5);
  if (d < 200) return 10 * Math.round(d / 10);
  return 50 * Math.round(d / 50);
}

interface Placed {
  area: ActivityAreaDetail;
  receipts: MapReceipt[];
  /** Points to measure the distance from: fenced cell centres, or the outline's vertices. */
  anchors: { lon: number; lat: number }[];
  points: ActivityPoint[];
}

/**
 * Areas, receipt dots and outliers from one person's receipts. See the file comment for the precision rules.
 * `receipts` are the non-sensitive receipts of the last 90 days.
 */
export function buildActivityMap(receipts: readonly MapReceipt[], home: HomeInput): ActivityMapDetail {
  const total = receipts.length;
  const placed: Placed[] = [];
  let rest = [...receipts];

  // A declared home: the SA2's real outline is the fence, whatever the receipts say.
  const declared = home.declaredSa2 ? sa2Features().find((f) => f.code === home.declaredSa2) : undefined;
  const declaredArea = declared ? getArea("sa2", declared.code) : undefined;
  const declaredFence = declared && declaredArea && declaredArea.areaKm2 <= MAX_HOME_SA2_KM2 ? simplifiedSa2(declared) : null;
  if (declared && declaredArea && declaredFence) {
    const fence = declaredFence;
    const mine = rest.filter((r) => r.sa2 === declared.code);
    rest = rest.filter((r) => r.sa2 !== declared.code);
    const bySub = new Map<string, { lon: number; lat: number; n: number }>();
    for (const r of mine) {
      const s = getSuburb(r.suburbCode);
      const key = r.suburbCode;
      const at = s ? { lon: s.lon, lat: s.lat } : { lon: declaredArea.centroid[0], lat: declaredArea.centroid[1] };
      const hit = bySub.get(key);
      if (hit) hit.n++;
      else bySub.set(key, { lon: round(at.lon, 4), lat: round(at.lat, 4), n: 1 });
    }
    placed.push({
      area: describe("home", mine, total, "declared", { lon: declaredArea.centroid[0], lat: declaredArea.centroid[1] }, fence, declaredArea.name),
      receipts: mine,
      anchors: polygonsOfGeometry(fence).flatMap((p) => p[0]!.map(([x, y]) => ({ lon: x!, lat: y! }))),
      points: [...bySub.values()].map((v) => ({ area: "home" as const, lon: v.lon, lat: v.lat, receipts: v.n })),
    });
  }

  // Everything else clusters on H3 cells.
  const clusters = clusterCells(rest)
    .filter((c) => qualifies(c.receipts))
    .sort((a, b) => b.receipts.length - a.receipts.length || [...a.cells.keys()][0]!.localeCompare([...b.cells.keys()][0]!));
  const kindOf = new Map<Cluster, AreaKind>();
  const free = [...clusters];
  const centroidOf = (c: Cluster) => {
    let la = 0;
    let lo = 0;
    for (const r of c.receipts) {
      la += r.lat;
      lo += r.lon;
    }
    return { lat: la / c.receipts.length, lon: lo / c.receipts.length };
  };
  if (!placed.length && free.length) {
    // Home is the cluster nearest the home suburb, if one is within 12 km.
    const near = free
      .map((c) => ({ c, d: km(home.lat, home.lon, centroidOf(c).lat, centroidOf(c).lon) }))
      .sort((a, b) => a.d - b.d)[0]!;
    if (near.d <= 12) {
      kindOf.set(near.c, "home");
      free.splice(free.indexOf(near.c), 1);
    }
  }
  const slots = 3 - placed.length - kindOf.size;
  const kept = free.slice(0, Math.max(0, slots));
  // Work is the weekday-heavy cluster, weekend the one that leans to Saturday and Sunday.
  const byWeekday = [...kept].sort((a, b) => weekdayShare(b.receipts) - weekdayShare(a.receipts) || b.receipts.length - a.receipts.length);
  const work = byWeekday.find((c) => weekdayShare(c.receipts) >= 0.6);
  if (work) kindOf.set(work, "work");
  const weekend = kept.filter((c) => c !== work).sort((a, b) => weekdayShare(a.receipts) - weekdayShare(b.receipts) || b.receipts.length - a.receipts.length)[0];
  if (weekend) kindOf.set(weekend, "weekend");

  const order: AreaKind[] = ["home", "work", "weekend"];
  const assigned = [...kindOf.entries()].sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]));
  const taken = new Set<string>();
  for (const [c] of assigned) for (const k of c.cells.keys()) taken.add(k);
  for (const [c, kind] of assigned) {
    const cells = fenceCells([...c.cells.keys()], taken);
    for (const x of cells) taken.add(x);
    const best = [...c.cells.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0]![0];
    const area = describe(kind, c.receipts, total, "receipts", cellCentre(best), cellsGeometry(cells), "Nearby");
    placed.push({
      area,
      receipts: c.receipts,
      anchors: cells.map(cellCentre),
      points: [...c.cells.entries()].map(([cell, rs]) => ({ area: kind, ...cellCentre(cell), receipts: rs.length })),
    });
  }
  placed.sort((a, b) => order.indexOf(a.area.kind) - order.indexOf(b.area.kind));

  // Outliers: every receipt that is in no area.
  const inArea = new Set<MapReceipt>(placed.flatMap((p) => p.receipts));
  const homeCell = cellCentre(latLngToCell(home.lat, home.lon, MAP_RES));
  const outliers: ActivityOutlier[] = receipts
    .filter((r) => !inArea.has(r))
    .map((r) => {
      const at = cellCentre(latLngToCell(r.lat, r.lon, MAP_RES));
      let best = Infinity;
      let from: ActivityOutlier["from"] = "home suburb";
      if (placed.length) {
        for (const p of placed)
          for (const a of p.anchors) {
            const d = km(at.lat, at.lon, a.lat, a.lon);
            if (d < best) {
              best = d;
              from = p.area.kind;
            }
          }
      } else best = km(at.lat, at.lon, homeCell.lat, homeCell.lon);
      const distanceKm = roundKm(best);
      const where = from === "home suburb" ? "home suburb" : `${from} area`;
      return {
        id: "",
        date: r.date,
        suburb: r.suburb,
        state: r.state,
        category: r.category,
        categoryName: r.categoryName,
        merchant: r.merchant,
        lon: at.lon,
        lat: at.lat,
        distanceKm,
        from,
        distanceText: best < 3 ? `next to ${where}` : `${distanceKm} km from ${where}`,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.merchant.localeCompare(b.merchant))
    .map((o, i) => ({ ...o, id: `o${i + 1}` }));

  // The views.
  const areaBoxes = placed.map((p) => geometryBox(p.area.fence));
  const outlierBoxes = outliers.map((o) => ({ west: o.lon, south: o.lat, east: o.lon, north: o.lat }));
  const homeBox = { west: homeCell.lon, south: homeCell.lat, east: homeCell.lon, north: homeCell.lat };
  const areasBox = areaBoxes.length ? unionBox(areaBoxes) : outlierBoxes.length ? unionBox([homeBox, ...outlierBoxes]) : homeBox;
  const allBox = unionBox([areasBox, ...outlierBoxes]);
  const context = home.skipContext
    ? []
    : contextOutlines([
        { box: padBox(areasBox, 1, 0.15), cap: 150 },
        ...outlierBoxes.map((b) => ({ box: padBox(b, 0, 0.4), cap: 40 })),
      ]);

  return {
    days: MAP_DAYS,
    totalReceipts: total,
    areas: placed.map((p) => p.area),
    points: placed.flatMap((p) => p.points),
    outliers,
    view: { areas: areasBox, all: allBox },
    context,
  };
}
