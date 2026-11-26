/**
 * Zoom, area level and the query box. Pure functions, no map library, so they are tested on their own.
 *
 * Aggregation follows the zoom: states, then SA4, SA3 and SA2 (real ABS areas drawn as outlines), then H3 hexagons at
 * resolution 6 and 7. There is no street level: the map stops at suburb size, so the zoom is capped (MAX_ZOOM) and the
 * finest view is an SA2 outline or a resolution 7 cell (about 2.1 km across). The H3 breaks are chosen so that a cell is
 * about 19 px across (flat to flat) when its resolution starts. Cell width in px = hex width (km) x 2^zoom / 65.7,
 * which holds at about 33 degrees south (the middle of the populated coast) on MapLibre's 512 px world.
 */
export type H3Resolution = 6 | 7;
/** The real-area levels the API serves as outlines. */
export type AreaLevel = "state" | "sa4" | "sa3" | "sa2";
/** What a view asks for: an area level, or an H3 resolution (a number). */
export type InfluenceLevel = AreaLevel | H3Resolution;

/** Zoom at which each level starts, after states: SA4, SA3, SA2, H3 res 6, H3 res 7. Below the first, the map shows states. */
export const LEVEL_BREAKS: readonly [number, number, number, number, number] = [4.4, 5.6, 6.8, 7.8, 9.2];
const LEVELS: readonly InfluenceLevel[] = ["sa4", "sa3", "sa2", 6, 7];

/** Hexagon width, flat side to flat side, in kilometres (square root of 3 times H3's average edge length). */
export const HEX_WIDTH_KM: Record<number, number> = { 5: 14.8, 6: 5.6, 7: 2.1 };

export const MIN_ZOOM = 2;
/** No street view: the finest level is an SA2 outline or a resolution 7 cell, so the map is not allowed in further. */
export const MAX_ZOOM = 11.4;

export function influenceLevel(zoom: number): InfluenceLevel {
  let out: InfluenceLevel = "state";
  LEVEL_BREAKS.forEach((b, i) => {
    if (zoom >= b) out = LEVELS[i]!;
  });
  return out;
}

/** The zoom at which a level starts (a state starts at the minimum zoom). */
export function levelStartZoom(level: InfluenceLevel): number {
  const i = LEVELS.indexOf(level);
  return i < 0 ? MIN_ZOOM : LEVEL_BREAKS[i]!;
}

/** The next finer level, or the same one at the finest. */
export function finerLevel(level: InfluenceLevel): InfluenceLevel {
  const all: readonly InfluenceLevel[] = ["state", ...LEVELS];
  return all[Math.min(all.length - 1, all.indexOf(level) + 1)]!;
}

/** The H3 resolution of a level, or null when it is a real-area level. */
export function h3Of(level: InfluenceLevel): H3Resolution | null {
  return typeof level === "number" ? level : null;
}

/** Activity heat starts at resolution 5 (coarser would be the whole country), then 6 and 7 as for influence. */
export function activityResolution(zoom: number): 5 | 6 | 7 {
  if (zoom >= LEVEL_BREAKS[4]) return 7;
  if (zoom >= LEVEL_BREAKS[3]) return 6;
  return 5;
}

/** The API refuses these levels without a box: SA2 (2,454 areas) and H3. */
export function usesBBox(level: InfluenceLevel | null): boolean {
  return level === "sa2" || typeof level === "number";
}

/** Approximate cell width on screen, in px, at a zoom (for tests and the level label). */
export function cellWidthPx(res: H3Resolution | 5, zoom: number): number {
  return (HEX_WIDTH_KM[res]! * 2 ** zoom) / 65.7;
}

export function kmLabel(km: number): string {
  return km < 1 ? `${Math.round(km * 10) * 100} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

const AREA_LEVEL_LABEL: Record<AreaLevel, string> = {
  state: "States and territories",
  sa4: "SA4 regions",
  sa3: "SA3 areas",
  sa2: "SA2 areas",
};

export function levelLabel(level: InfluenceLevel | null): string {
  if (level === null) return AREA_LEVEL_LABEL.state;
  return typeof level === "number" ? `Areas about ${kmLabel(HEX_WIDTH_KM[level]!)} across` : AREA_LEVEL_LABEL[level];
}

/* ---------------- the query box ---------------- */

export type BBox = [west: number, south: number, east: number, north: number];

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * The box to ask the API for: the visible box, grown by one step on every side and snapped outward to a grid
 * whose step shrinks as you zoom in. A small pan then stays inside the box already fetched (no new request), and
 * boxes that differ by a pixel share one cache key.
 */
export function snapBBox(view: BBox, zoom: number): BBox {
  const step = 180 / 2 ** Math.max(0, Math.floor(zoom));
  const [w, s, e, n] = view;
  const out: BBox = [
    Math.max(-180, round6(Math.floor(w / step) * step - step)),
    Math.max(-85, round6(Math.floor(s / step) * step - step)),
    Math.min(180, round6(Math.ceil(e / step) * step + step)),
    Math.min(85, round6(Math.ceil(n / step) * step + step)),
  ];
  return out;
}

/** True when `inner` lies wholly inside `outer`. */
export function bboxContains(outer: BBox, inner: BBox): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

/** "w,s,e,n" as the API reads it. */
export function bboxParam(b: BBox): string {
  return b.map((x) => String(round6(x))).join(",");
}

/** True when a point lies inside a box. */
export function inBBox(lon: number, lat: number, b: BBox): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}
