/**
 * Which API request a map view needs. Pure, so the rules are tested: the level follows the zoom, resolution 6 and
 * finer ask for the visible box (grown and snapped, so a small pan needs no new request), and a view already
 * covered by the answer on screen asks for nothing new.
 */
import {
  activityResolution,
  bboxContains,
  bboxParam,
  influenceResolution,
  snapBBox,
  usesBBox,
  type BBox,
  type H3Resolution,
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
  level: "state" | { h3: number };
  bbox?: BBox;
}

export function influenceUrl(c: InfluenceControls, res: H3Resolution | null, bbox?: BBox): string {
  const p = new URLSearchParams({ brand: c.brand, audience: c.audience, measure: c.measure, month: c.month });
  if (res === null) {
    p.set("level", "state");
  } else {
    p.set("level", "h3");
    p.set("res", String(res));
    if (bbox) p.set("bbox", bboxParam(bbox));
  }
  return `/api/map/influence?${p.toString()}`;
}

function sameInfluenceControls(a: ShownInfluence, c: InfluenceControls): boolean {
  return a.brand === c.brand && a.audience === c.audience && a.measure === c.measure && a.month === c.month;
}

export function planInfluence(
  c: InfluenceControls,
  view: ViewBox,
  shown: { url: string; query: ShownInfluence } | null,
): string {
  const res = influenceResolution(view.z);
  if (!usesBBox(res)) return influenceUrl(c, res);
  if (
    shown &&
    sameInfluenceControls(shown.query, c) &&
    typeof shown.query.level === "object" &&
    shown.query.level.h3 === res &&
    shown.query.bbox &&
    bboxContains(shown.query.bbox, view.bbox)
  ) {
    return shown.url;
  }
  return influenceUrl(c, res, snapBBox(view.bbox, view.z));
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
  if (!usesBBox(res)) return activityUrl(c, res);
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
