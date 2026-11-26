/**
 * Zoom, H3 resolution and the query box. Pure functions, no map library, so they are tested on their own.
 *
 * Aggregation follows the zoom: states at low zoom, then H3 resolution 4, 5, 6, 7 and 8. The breaks are chosen so
 * that a cell is about 19 px across (flat to flat) when its resolution starts and grows to about 50 px before the
 * next one takes over. Cell width in px = hex width (km) x 2^zoom / 65.7, which holds at about 33 degrees south
 * (the middle of the populated coast) on MapLibre's 512 px world.
 */
export type H3Resolution = 4 | 5 | 6 | 7 | 8;

/** Zoom at which each resolution starts. Below the first, the map shows states. */
export const LEVEL_BREAKS: readonly [number, number, number, number, number] = [5.0, 6.4, 7.8, 9.2, 10.6];
const RESOLUTIONS: readonly H3Resolution[] = [4, 5, 6, 7, 8];

/** Hexagon width, flat side to flat side, in kilometres (square root of 3 times H3's average edge length). */
export const HEX_WIDTH_KM: Record<H3Resolution, number> = { 4: 39.2, 5: 14.8, 6: 5.6, 7: 2.1, 8: 0.8 };

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 14;

/** null means states. */
export function influenceResolution(zoom: number): H3Resolution | null {
  let out: H3Resolution | null = null;
  LEVEL_BREAKS.forEach((b, i) => {
    if (zoom >= b) out = RESOLUTIONS[i]!;
  });
  return out;
}

/** Activity heat starts at resolution 5 (the API does not offer 4), so the first two levels share it. */
export function activityResolution(zoom: number): 5 | 6 | 7 | 8 {
  const r = influenceResolution(zoom);
  return r === null || r === 4 ? 5 : r;
}

/** Resolution 6 and finer ask for the visible box only: the whole country would be too many cells. */
export function usesBBox(res: number | null): boolean {
  return res !== null && res >= 6;
}

/** Approximate cell width on screen, in px, at a zoom (for tests and the level label). */
export function cellWidthPx(res: H3Resolution, zoom: number): number {
  return (HEX_WIDTH_KM[res] * 2 ** zoom) / 65.7;
}

export function kmLabel(km: number): string {
  return km < 1 ? `${Math.round(km * 10) * 100} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function levelLabel(res: H3Resolution | null): string {
  return res === null ? "States" : `Areas about ${kmLabel(HEX_WIDTH_KM[res])} across`;
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
