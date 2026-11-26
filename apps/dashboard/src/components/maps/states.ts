/**
 * The Australian state outlines (public/geo/au-states.json) and the few fixed places the maps label. The file's own
 * `code` property is not the usual abbreviation ("QL", "VI"), so the state is found by name.
 */
export type Position = [number, number];

export interface StateFeature {
  type: "Feature";
  properties: { name: string; code?: string };
  geometry:
    | { type: "Polygon"; coordinates: Position[][] }
    | { type: "MultiPolygon"; coordinates: Position[][][] };
}

export interface StateCollection {
  type: "FeatureCollection";
  features: StateFeature[];
}

export const STATE_BY_NAME: Record<string, string> = {
  "New South Wales": "NSW",
  Victoria: "VIC",
  Queensland: "QLD",
  "Western Australia": "WA",
  "South Australia": "SA",
  Tasmania: "TAS",
  "Australian Capital Territory": "ACT",
  "Northern Territory": "NT",
  // Jervis Bay is part of the ACT's figures.
  "Jervis Bay Territory": "ACT",
};

export function stateCode(f: StateFeature): string | null {
  return STATE_BY_NAME[f.properties.name] ?? null;
}

/** Signed area and centroid of a ring (shoelace). Flat degrees are fine here: it only places a label. */
function ringCentroid(ring: Position[]): { area: number; x: number; y: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[i + 1]!;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (a === 0) return { area: 0, x: ring[0]?.[0] ?? 0, y: ring[0]?.[1] ?? 0 };
  return { area: Math.abs(a / 2), x: cx / (6 * (a / 2)), y: cy / (6 * (a / 2)) };
}

/** Where to put a state's label: the centre of its largest outer ring. */
export function labelPoint(f: StateFeature): Position {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best: { area: number; x: number; y: number } | null = null;
  for (const p of polys) {
    const outer = p[0];
    if (!outer) continue;
    const c = ringCentroid(outer);
    if (!best || c.area > best.area) best = c;
  }
  return best ? [best.x, best.y] : [134, -26];
}

export interface StateLabel {
  code: string;
  position: Position;
}

/** One label per state (the ACT is left out: it is too small to hold one at the national view). */
export function stateLabels(fc: StateCollection): StateLabel[] {
  const out: StateLabel[] = [];
  for (const f of fc.features) {
    const code = stateCode(f);
    if (!code || code === "ACT") continue;
    if (f.properties.name === "Jervis Bay Territory") continue;
    out.push({ code, position: labelPoint(f) });
  }
  return out;
}

export function stateBounds(fc: StateCollection, code: string): [number, number, number, number] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const f of fc.features) {
    if (stateCode(f) !== code || f.properties.name === "Jervis Bay Territory") continue;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) {
      for (const [x, y] of p[0] ?? []) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
    }
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/** Australia, for the first view (west, south, east, north). */
export const AUSTRALIA_BOUNDS: [number, number, number, number] = [112.5, -44.5, 154.5, -9.5];

/** The state capitals, labelled once the map is zoomed in far enough to show areas rather than states. */
export const CAPITALS: { name: string; position: Position }[] = [
  { name: "Sydney", position: [151.209, -33.869] },
  { name: "Melbourne", position: [144.963, -37.814] },
  { name: "Brisbane", position: [153.026, -27.47] },
  { name: "Perth", position: [115.857, -31.953] },
  { name: "Adelaide", position: [138.6, -34.929] },
  { name: "Hobart", position: [147.327, -42.882] },
  { name: "Canberra", position: [149.129, -35.282] },
  { name: "Darwin", position: [130.842, -12.463] },
];
