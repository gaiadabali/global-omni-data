import sa2TopoJson from "../data/sa2.topo.js";
import { parentLabel, parentChain } from "./areas";
import { getStore } from "./data";
import { pointInPolygon, ringArea, ringBBox } from "./shape";
import { decodeArcs, polygonsOf, type Topology } from "./topo";
import type { Area, BBox, Place, Suburb } from "./types";
import { cellToLatLng } from "h3-js";

/* ---------------- SA2 polygons and a grid over them ---------------- */

interface Part {
  sa2: number;
  rings: Float64Array[];
  bbox: BBox;
  /** Planar area of the outer ring minus holes, in square degrees. For choosing a part at random. */
  area: number;
}

interface SpatialIndex {
  parts: Part[];
  /** SA2 index -> its parts. */
  bySa2: Part[][];
  grid: Map<number, number[]>;
}

const CELL = 0.2; // degrees
const cellKey = (gx: number, gy: number) => gx * 100_000 + gy;

let spatial: SpatialIndex | null = null;

function index(): SpatialIndex {
  if (spatial) return spatial;
  const topo = sa2TopoJson as unknown as Topology;
  const arcs = decodeArcs(topo);
  const store = getStore();
  const parts: Part[] = [];
  const bySa2: Part[][] = store.levels.sa2.map(() => []);
  for (const g of topo.objects["areas"]!.geometries) {
    const sa2 = store.byId.sa2.get(String(g.id));
    if (!sa2) continue;
    for (const rings of polygonsOf(g, arcs)) {
      if (rings.length === 0 || rings[0]!.length < 8) continue; // a ring that collapsed to a line
      let area = Math.abs(ringArea(rings[0]!));
      for (let h = 1; h < rings.length; h++) area -= Math.abs(ringArea(rings[h]!));
      const part: Part = { sa2: sa2.index, rings, bbox: ringBBox(rings[0]!), area: Math.max(area, 0) };
      parts.push(part);
      bySa2[sa2.index]!.push(part);
    }
  }
  const grid = new Map<number, number[]>();
  parts.forEach((p, i) => {
    for (let gx = Math.floor(p.bbox[0] / CELL); gx <= Math.floor(p.bbox[2] / CELL); gx++) {
      for (let gy = Math.floor(p.bbox[1] / CELL); gy <= Math.floor(p.bbox[3] / CELL); gy++) {
        const k = cellKey(gx, gy);
        const l = grid.get(k);
        if (l) l.push(i);
        else grid.set(k, [i]);
      }
    }
  });
  spatial = { parts, bySa2, grid };
  return spatial;
}

/** Builds the polygon index now (about 100 ms). Called at server start so the first request does not pay for it. */
export function warmGeo(): void {
  index();
  suburbGrid();
}

/** The SA2 index (position in `areas("sa2")`) containing a point, or -1 (in the sea, or outside Australia). */
export function sa2IndexAt(lon: number, lat: number): number {
  const ix = index();
  const list = ix.grid.get(cellKey(Math.floor(lon / CELL), Math.floor(lat / CELL)));
  if (!list) return -1;
  for (const i of list) {
    const p = ix.parts[i]!;
    const b = p.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (pointInPolygon(lon, lat, p.rings)) return p.sa2;
  }
  return -1;
}

const KM_LAT = 110.57;
const KM_LON = 111.32;
function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dy = (lat2 - lat1) * KM_LAT;
  const dx = (lon2 - lon1) * KM_LON * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

/** The SA2 containing a point. */
export function pointToSa2(lon: number, lat: number): Area | null {
  const i = sa2IndexAt(lon, lat);
  return i < 0 ? null : getStore().levels.sa2[i]!;
}

/**
 * The SA2 containing a point, or, for a point just off the coast (the boundaries are simplified, so a coastal
 * point can land in the water), the SA2 whose boundary is nearest within `maxKm`.
 */
export function nearestSa2(lon: number, lat: number, maxKm = 5): Area | null {
  const inside = pointToSa2(lon, lat);
  if (inside) return inside;
  const ix = index();
  const reach = Math.ceil(maxKm / (CELL * KM_LON * Math.cos((lat * Math.PI) / 180))) + 1;
  const gx0 = Math.floor(lon / CELL);
  const gy0 = Math.floor(lat / CELL);
  let best = -1;
  let bd = maxKm;
  const seen = new Set<number>();
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (const i of ix.grid.get(cellKey(gx0 + dx, gy0 + dy)) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const p = ix.parts[i]!;
        for (const r of p.rings.slice(0, 1)) {
          for (let k = 0; k < r.length; k += 2) {
            const d = km(lat, lon, r[k + 1]!, r[k]!);
            if (d < bd) {
              bd = d;
              best = p.sa2;
            }
          }
        }
      }
    }
  }
  return best < 0 ? null : getStore().levels.sa2[best]!;
}

/**
 * A point inside an SA2, drawn with the given random source (a function returning [0, 1)). Uniform over the SA2's
 * area. Deterministic for a deterministic source.
 */
export function randomPointInSa2(sa2Index: number, rnd: () => number): [number, number] {
  const ix = index();
  const parts = ix.bySa2[sa2Index]!;
  if (parts.length === 0) return getStore().levels.sa2[sa2Index]!.centroid;
  let part = parts[0]!;
  if (parts.length > 1) {
    let total = 0;
    for (const p of parts) total += p.area;
    let u = rnd() * total;
    for (const p of parts) {
      u -= p.area;
      if (u <= 0) {
        part = p;
        break;
      }
    }
  }
  const [w, s, e, n] = part.bbox;
  for (let t = 0; t < 60; t++) {
    const x = w + rnd() * (e - w);
    const y = s + rnd() * (n - s);
    if (pointInPolygon(x, y, part.rings)) return [x, y];
  }
  return getStore().levels.sa2[sa2Index]!.centroid;
}

/* ---------------- suburbs ---------------- */

const SCELL = 0.1; // degrees, about 11 km
/** A suburb is treated as a disc of its own area, up to this radius: so a point in a small suburb beats a big one. */
const MAX_RADIUS_KM = 4;

let sgrid: Map<number, Suburb[]> | null = null;
function suburbGrid(): Map<number, Suburb[]> {
  if (sgrid) return sgrid;
  const g = new Map<number, Suburb[]>();
  for (const s of getStore().suburbs) {
    const k = cellKey(Math.floor(s.lon / SCELL), Math.floor(s.lat / SCELL));
    const l = g.get(k);
    if (l) l.push(s);
    else g.set(k, [s]);
  }
  sgrid = g;
  return g;
}

export interface NearSuburb {
  suburb: Suburb;
  /** Kilometres from the point to the suburb's label point. */
  distanceKm: number;
}

/**
 * The suburb (ABS locality) a point is most likely in. The suburb files carry one point per suburb, not outlines,
 * so each suburb counts as a disc of its own area (capped at 4 km radius) and the point goes to the suburb whose disc
 * edge is nearest. Returns null beyond `maxKm` of every suburb (the outback).
 */
export function nearestSuburb(lon: number, lat: number, maxKm = 80): NearSuburb | null {
  const g = suburbGrid();
  const gx0 = Math.floor(lon / SCELL);
  const gy0 = Math.floor(lat / SCELL);
  // A cell is at least this wide, in kilometres (longitude cells narrow towards the south of Tasmania).
  const kmLon = KM_LON * Math.cos((lat * Math.PI) / 180);
  const cellKm = SCELL * kmLon;
  const maxRing = Math.ceil(maxKm / cellKm) + 1;
  let best: NearSuburb | null = null;
  let bestScore = Infinity;
  for (let ring = 0; ring <= maxRing; ring++) {
    // Every suburb not yet seen is at least (ring - 1) cells away, so its score is at least that minus the radius cap.
    if (best && (ring - 1) * cellKm - MAX_RADIUS_KM > bestScore) break;
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const list = g.get(cellKey(gx0 + dx, gy0 + dy));
        if (!list) continue;
        for (const s of list) {
          const dy = (s.lat - lat) * KM_LAT;
          const dx = (s.lon - lon) * kmLon;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > maxKm) continue;
          const radius = Math.min(MAX_RADIUS_KM, Math.sqrt(s.areaKm2 / Math.PI));
          const score = d - radius;
          if (score < bestScore) {
            bestScore = score;
            best = { suburb: s, distanceKm: d };
          }
        }
      }
    }
  }
  return best;
}

/** Suburbs with this name, case-insensitive, optionally in one state. */
export function findSuburbs(name: string, state?: string): readonly Suburb[] {
  const l = getStore().suburbsByName.get(name.trim().toLowerCase()) ?? [];
  return state ? l.filter((s) => s.state === state) : l;
}

export function getSuburb(code: string): Suburb | undefined {
  return getStore().suburbByCode.get(code);
}

export function suburbs(): readonly Suburb[] {
  return getStore().suburbs;
}

/* ---------------- places ---------------- */

/** What is at a point: its suburb, SA2 and a "Greater Sydney, NSW" style parent label. */
export function placeAt(lon: number, lat: number): Place {
  const near = nearestSuburb(lon, lat);
  // A point in the sea has no SA2 of its own: its suburb's SA2 gives the label.
  const sa2 = nearestSa2(lon, lat) ?? (near ? (getStore().byId.sa2.get(near.suburb.sa2) ?? null) : null);
  const parent = sa2 ? parentLabel("sa2", sa2.id) : near ? `${near.suburb.state}` : "";
  const name = near?.suburb.name ?? sa2?.name ?? "Remote area";
  return { name, suburb: near?.suburb ?? null, sa2, parent };
}

const cellCache = new Map<string, Place>();

/** `placeAt` for the centre of an H3 cell. Memoised: the sample uses a fixed set of cells. */
export function placeForCell(cell: string): Place {
  const hit = cellCache.get(cell);
  if (hit) return hit;
  const [lat, lon] = cellToLatLng(cell);
  const p = placeAt(lon, lat);
  cellCache.set(cell, p);
  return p;
}

/** The suburb name for a point or an H3 cell: "Parramatta". */
export function suburbNameAt(lon: number, lat: number): string {
  return placeAt(lon, lat).name;
}

/** The SA2 chain of a point, [SA2, SA3, SA4, state], or an empty list in the sea. */
export function chainAt(lon: number, lat: number): Area[] {
  const sa2 = nearestSa2(lon, lat);
  return sa2 ? parentChain("sa2", sa2.id) : [];
}
