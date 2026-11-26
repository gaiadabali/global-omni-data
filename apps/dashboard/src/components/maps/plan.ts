/**
 * Which API request a map view needs. Pure, so the rules are tested: the level follows the zoom, resolution 6 and
 * finer ask for the visible box (grown and snapped, so a small pan needs no new request), and a view already
 * covered by the answer on screen asks for nothing new.
 */
import {
  activityResolution,
  bboxContains,
  bboxParam,
  levelForView,
  snapBBox,
  usesBBox,
  type BBox,
  type InfluenceLevel,
} from "./zoom";

export interface ViewBox {
  z: number;
  /** The visible box. */
  bbox: BBox;
}

/* ---------------- influence ---------------- */

export interface InfluenceControls {
  brand: string;
  audience: string;
  measure: string;
  month: string;
}

/** What the API echoes back in `query`. */
export interface ShownInfluence {
  brand: string;
  audience: string;
  measure: string;
  month: string;
  level: "state" | "sa4" | "sa3" | "sa2" | { h3: number };
  bbox?: BBox;
}

/** The request for a level: an area level (SA2 needs a box) or an H3 resolution (always a box). */
export function influenceUrl(c: InfluenceControls, level: InfluenceLevel, bbox?: BBox): string {
  const p = new URLSearchParams({ brand: c.brand, audience: c.audience, measure: c.measure, month: c.month });
  if (typeof level === "number") {
    p.set("level", "h3");
    p.set("res", String(level));
  } else {
    p.set("level", level);
  }
  if (bbox && usesBBox(level)) p.set("bbox", bboxParam(bbox));
  return `/api/map/influence?${p.toString()}`;
}

function sameLevel(shown: ShownInfluence["level"], want: InfluenceLevel): boolean {
  return typeof shown === "object" ? shown.h3 === want : shown === want;
}

function sameInfluenceControls(a: ShownInfluence, c: InfluenceControls): boolean {
  return a.brand === c.brand && a.audience === c.audience && a.measure === c.measure && a.month === c.month;
}

export function planInfluence(
  c: InfluenceControls,
  view: ViewBox,
  shown: { url: string; query: ShownInfluence } | null,
  /** Hexagon mode: H3 cells from a lower zoom than the area levels reach them. */
  hexMode = false,
): string {
  const level = levelForView(view.z, hexMode);
  if (!usesBBox(level)) return influenceUrl(c, level);
  if (
    shown &&
    sameInfluenceControls(shown.query, c) &&
    sameLevel(shown.query.level, level) &&
    shown.query.bbox &&
    bboxContains(shown.query.bbox, view.bbox)
  ) {
    return shown.url;
  }
  return influenceUrl(c, level, snapBBox(view.bbox, view.z));
}

/* ---------------- activity ---------------- */

export interface ActivityControls {
  /** A category id, or "all". */
  category: string;
  /** An age band as the API spells it, or "all". */
  ageBand: string;
  month: string;
}

export interface ShownActivity {
  month: string;
  category?: string;
  ageBand?: string;
  h3: number;
  bbox?: BBox;
}

export function activityUrl(c: ActivityControls, res: 5 | 6 | 7 | 8, bbox?: BBox): string {
  const p = new URLSearchParams({ month: c.month, h3: String(res) });
  if (c.category !== "all") p.set("category", c.category);
  if (c.ageBand !== "all") p.set("ageBand", c.ageBand);
  if (bbox) p.set("bbox", bboxParam(bbox));
  return `/api/map/activity?${p.toString()}`;
}

function sameActivityControls(a: ShownActivity, c: ActivityControls): boolean {
  return a.month === c.month && (a.category ?? "all") === c.category && (a.ageBand ?? "all") === c.ageBand;
}

export function planActivity(
  c: ActivityControls,
  view: ViewBox,
  shown: { url: string; query: ShownActivity } | null,
): string {
  const res = activityResolution(view.z);
  if (res < 6) return activityUrl(c, res);
  if (
    shown &&
    sameActivityControls(shown.query, c) &&
    shown.query.h3 === res &&
    shown.query.bbox &&
    bboxContains(shown.query.bbox, view.bbox)
  ) {
    return shown.url;
  }
  return activityUrl(c, res, snapBBox(view.bbox, view.z));
}

/* ---------------- the panels' own requests ---------------- */

/** The levels the summary endpoint ranks (no box, no H3). */
export type SummaryLevel = "state" | "sa4" | "sa3" | "sa2";

/** The headline numbers, the ranked list and the movers for a level. The same controls as the map, no box. */
export function summaryUrl(
  c: { brand: string; audience: string; measure: string },
  month: string,
  level: SummaryLevel,
  limit = 5,
): string {
  const p = new URLSearchParams({
    brand: c.brand,
    audience: c.audience,
    measure: c.measure,
    month,
    level,
    limit: String(limit),
  });
  return `/api/map/summary?${p.toString()}`;
}

/** One area in detail. `level` is "h3" for a hexagon, whatever its resolution. */
export function areaUrl(
  c: { brand: string; audience: string },
  month: string,
  level: "state" | "sa4" | "sa3" | "sa2" | "h3",
  id: string,
): string {
  const p = new URLSearchParams({ level, id, brand: c.brand, audience: c.audience, month });
  return `/api/map/area?${p.toString()}`;
}

/** The busiest activity areas. With a box, those in it; without, the whole country. */
export function hotspotsUrl(c: ActivityControls, bbox: BBox | undefined, limit = 20): string {
  const p = new URLSearchParams({ month: c.month, limit: String(limit) });
  if (c.category !== "all") p.set("category", c.category);
  if (c.ageBand !== "all") p.set("ageBand", c.ageBand);
  if (bbox) p.set("bbox", bboxParam(bbox));
  return `/api/map/hotspots?${p.toString()}`;
}

/** One activity area (an H3 cell) in detail. */
export function activityAreaUrl(c: ActivityControls, id: string): string {
  const p = new URLSearchParams({ level: "h3", id, month: c.month });
  if (c.category !== "all") p.set("category", c.category);
  if (c.ageBand !== "all") p.set("ageBand", c.ageBand);
  return `/api/map/activity-area?${p.toString()}`;
}
