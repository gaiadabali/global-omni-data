import { plottable, presentCount, toPNum, type CountKind } from "../privacy";
import type { Viewer } from "../types";
import { countBand, countLegend, rateBand, rateLegend, type LegendBreak } from "./legend";
import {
  isRawCount,
  isRawSeries,
  type ActivityQuery,
  type ActivityRaw,
  type InfluenceQuery,
  type InfluenceRaw,
  type Present,
} from "./types";

/**
 * THE PRESENTATION LAYER. Turns the provider's exact numbers into what this viewer may see. Every RawCount
 * and RawSeries passes through presentCount here, so a page cannot receive an unthresholded count by mistake.
 */

type V = Pick<Viewer, "role">;

/** Walks any provider result and thresholds every raw count for the viewer. */
export function presentTree<T>(value: T, viewer: V): Present<T> {
  return walk(value, viewer) as Present<T>;
}

function walk(value: unknown, viewer: V): unknown {
  if (isRawCount(value)) return toPNum(value.n, { kind: value.kind, viewer });
  if (isRawSeries(value)) {
    return value.values.map((n) => plottable(presentCount(n, { kind: value.kind, viewer })));
  }
  if (Array.isArray(value)) return value.map((x) => walk(x, viewer));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, viewer);
    return out;
  }
  return value;
}

/* ---------------- maps ---------------- */

export interface InfluenceCell {
  id: string;
  label?: string;
  /** The number to colour by: a count, or a rate per 1,000 residents. 0 when suppressed for this viewer. */
  value: number;
  /** What to print: "1,240", "<10", or "12.40". */
  display: string;
  suppressed: boolean;
  population?: number;
  /** Index into `legend`. */
  band: number;
}

export interface PresentedInfluence {
  query: InfluenceQuery;
  unit: "people" | "per 1,000";
  cells: InfluenceCell[];
  legend: LegendBreak[];
  truncated: boolean;
}

export function presentInfluence(
  raw: InfluenceRaw,
  query: InfluenceQuery,
  viewer: V,
): PresentedInfluence {
  const perThousand = query.measure === "per1000";
  const cells: InfluenceCell[] = raw.cells.map((c) => {
    const p = presentCount(c.count.n, { kind: c.count.kind, viewer });
    let value = p.exact ?? 0;
    let display = p.display;
    if (perThousand && p.exact !== null) {
      const pop = c.population ?? 0;
      value = pop > 0 ? Math.round((p.exact / pop) * 1000 * 100) / 100 : 0;
      display = value.toFixed(2);
    }
    return {
      id: c.id,
      ...(c.label !== undefined ? { label: c.label } : {}),
      value,
      display,
      suppressed: p.suppressed,
      ...(c.population !== undefined ? { population: c.population } : {}),
      band: 0,
    };
  });

  let legend: LegendBreak[];
  if (perThousand) {
    legend = rateLegend(cells.filter((c) => !c.suppressed).map((c) => c.value));
    for (const c of cells) c.band = c.suppressed ? 0 : rateBand(c.value, legend);
  } else {
    legend = countLegend(cells.map((c) => c.value));
    for (const c of cells) c.band = c.suppressed ? 0 : countBand(c.value, legend);
  }
  return {
    query,
    unit: perThousand ? "per 1,000" : "people",
    cells,
    legend,
    truncated: raw.truncated,
  };
}

export interface ActivityMerchant {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  /** Receipts in the month. 0 when suppressed for this viewer. */
  value: number;
  display: string;
  suppressed: boolean;
}

export interface ActivityHeatCell {
  /** An h3 index. An aggregate, never a person-level point. */
  id: string;
  value: number;
  display: string;
  suppressed: boolean;
  band: number;
}

export interface PresentedActivity {
  query: ActivityQuery;
  merchants: ActivityMerchant[];
  heat: ActivityHeatCell[];
  legend: LegendBreak[];
  truncated: boolean;
}

export function presentActivity(raw: ActivityRaw, query: ActivityQuery, viewer: V): PresentedActivity {
  const merchants: ActivityMerchant[] = raw.merchants.map((m) => {
    const p = presentCount(m.receipts.n, { kind: m.receipts.kind, viewer });
    return {
      id: m.id,
      name: m.name,
      category: m.category,
      lat: m.lat,
      lon: m.lon,
      value: p.exact ?? 0,
      display: p.display,
      suppressed: p.suppressed,
    };
  });
  const kind: CountKind = raw.heat[0]?.people.kind ?? "adult";
  const heat: ActivityHeatCell[] = raw.heat.map((h) => {
    const p = presentCount(h.people.n, { kind: h.people.kind, viewer });
    return { id: h.id, value: p.exact ?? 0, display: p.display, suppressed: p.suppressed, band: 0 };
  });
  const legend = countLegend(
    heat.map((h) => h.value),
    kind === "adult" ? 10 : 20,
  );
  for (const h of heat) h.band = h.suppressed ? 0 : countBand(h.value, legend);
  return { query, merchants, heat, legend, truncated: raw.truncated };
}
