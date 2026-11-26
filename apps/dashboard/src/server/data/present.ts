import { plottableCount, presentCount, toPNum, type CountKind, type PNum } from "../privacy";
import type { Viewer } from "../types";
import { countBand, countLegend, rateBand, rateLegend, type LegendBreak } from "./legend";
import type { BrandId } from "../types";
import {
  isRawCount,
  isRawSeries,
  type ActivityAreaQuery,
  type ActivityAreaRaw,
  type ActivityQuery,
  type ActivityRaw,
  type AreaQuery,
  type AreaRaw,
  type Change,
  type HotspotQuery,
  type HotspotsRaw,
  type InfluenceQuery,
  type InfluenceRaw,
  type MixRaw,
  type OverviewRaw,
  type Present,
  type RawCount,
  type RawSeries,
  type SummaryQuery,
  type SummaryRaw,
  type TextRaw,
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
    return value.values.map((n) => plottableCount(n, { kind: value.kind, viewer }));
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
  /** A state code ("NSW"), an ABS area code, or an h3 index. */
  id: string;
  /** A real place name; an h3 cell is named for the suburb at its centre. */
  name: string;
  /** The same as `name`, kept for older callers. */
  label: string;
  /** Where it is: "Greater Sydney, NSW". */
  parent: string;
  /** [lon, lat]: an area's label point or an h3 cell's centre. */
  centroid: [number, number];
  /** The number to colour by: a count, or a rate per 1,000 residents. 0 when suppressed for this viewer. */
  value: number;
  /** What to print: "1,240", "<10", or "12.40". */
  display: string;
  suppressed: boolean;
  population: number;
  /** Index into `legend`. */
  band: number;
  /** The running total for the last 12 months (counts, not rates), presented: 0 where suppressed for this viewer. */
  trend: number[];
  /** Joined in the query month, presented. */
  newThisMonth: PNum;
}

export interface PresentedInfluence {
  query: InfluenceQuery;
  unit: "people" | "per 1,000";
  /** The months `trend` covers, oldest first. */
  trendMonths: string[];
  cells: InfluenceCell[];
  legend: LegendBreak[];
  truncated: boolean;
}

const series = (s: RawSeries, viewer: V): number[] => s.values.map((n) => plottableCount(n, { kind: s.kind, viewer }));

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
      value = c.population > 0 ? Math.round((p.exact / c.population) * 1000 * 100) / 100 : 0;
      display = value.toFixed(2);
    }
    return {
      id: c.id,
      name: c.name,
      label: c.name,
      parent: c.parent,
      centroid: c.centroid,
      value,
      display,
      suppressed: p.suppressed,
      population: c.population,
      band: 0,
      trend: series(c.trend, viewer),
      newThisMonth: toPNum(c.newThisMonth.n, { kind: c.newThisMonth.kind, viewer }),
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
    trendMonths: raw.trendMonths,
    cells,
    legend,
    truncated: raw.truncated,
  };
}

/* ---------------- summary ---------------- */

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

export interface SummaryArea {
  rank: number;
  id: string;
  name: string;
  parent: string;
  centroid: [number, number];
  population: number;
  value: number;
  display: string;
  suppressed: boolean;
  /** New in the query month, presented. */
  change: PNum;
  /** The change over last month's total, in per cent. null while the change is suppressed for this viewer. */
  changePct: number | null;
  trend: number[];
}

export interface PresentedSummary {
  query: SummaryQuery;
  unit: "people" | "per 1,000";
  trendMonths: string[];
  headline: { total: PNum; newThisMonth: PNum; growthPct: number | null; per1000: number | null };
  areas: SummaryArea[];
  movers: SummaryArea[];
}

/** Growth in per cent, from exact numbers, only when the new count is not suppressed for the viewer. */
function pct(change: number, previous: number, visible: boolean): number | null {
  return visible && previous >= 10 ? round1((change / previous) * 100) : null;
}

export function presentSummary(raw: SummaryRaw, query: SummaryQuery, viewer: V): PresentedSummary {
  const perThousand = query.measure === "per1000";
  const total = presentCount(raw.total.n, { kind: "adult", viewer });
  const fresh = presentCount(raw.newThisMonth.n, { kind: "adult", viewer });
  const rows = raw.areas.map((a) => {
    const p = presentCount(a.count.n, { kind: a.count.kind, viewer });
    const ch = presentCount(a.change.n, { kind: a.change.kind, viewer });
    let value = p.exact ?? 0;
    let display = p.display;
    if (perThousand && p.exact !== null) {
      value = a.population > 0 ? round2((p.exact / a.population) * 1000) : 0;
      display = value.toFixed(2);
    }
    return { a, p, ch, value, display };
  });
  // Visible figures first, largest first. A suppressed one goes after them in id order, never by its hidden size.
  rows.sort((x, y) => {
    if (x.p.suppressed !== y.p.suppressed) return x.p.suppressed ? 1 : -1;
    if (!x.p.suppressed && x.value !== y.value) return y.value - x.value;
    return x.a.id < y.a.id ? -1 : 1;
  });
  const shape = (r: (typeof rows)[number], rank: number): SummaryArea => ({
    rank,
    id: r.a.id,
    name: r.a.name,
    parent: r.a.parent,
    centroid: r.a.centroid,
    population: r.a.population,
    value: r.value,
    display: r.display,
    suppressed: r.p.suppressed,
    change: { value: r.ch.exact ?? 0, display: r.ch.display, suppressed: r.ch.suppressed },
    changePct: pct(r.a.change.n, r.a.previous.n, r.ch.exact !== null && !r.ch.suppressed),
    trend: series(r.a.trend, viewer),
  });
  const movers = rows
    .filter((r) => !r.ch.suppressed)
    .sort((x, y) => y.a.change.n - x.a.change.n || (x.a.id < y.a.id ? -1 : 1))
    .slice(0, 5)
    .map((r, i) => shape(r, i + 1));
  return {
    query,
    unit: perThousand ? "per 1,000" : "people",
    trendMonths: raw.trendMonths,
    headline: {
      total: { value: total.exact ?? 0, display: total.display, suppressed: total.suppressed },
      newThisMonth: { value: fresh.exact ?? 0, display: fresh.display, suppressed: fresh.suppressed },
      growthPct: pct(raw.newThisMonth.n, raw.previous.n, !fresh.suppressed),
      per1000:
        total.suppressed || raw.nationalPopulation <= 0 ? null : round2((raw.total.n / raw.nationalPopulation) * 1000),
    },
    areas: rows.slice(0, query.limit).map((r, i) => shape(r, i + 1)),
    movers,
  };
}

/* ---------------- one area ---------------- */

interface MixShown {
  /** Category id, or age band. */
  key: string;
  name: string;
  sensitive: boolean;
  teen: boolean;
  people: PNum;
  /** Part of the figures the viewer can see (null for a suppressed row, so a hidden row cannot be worked out). */
  share: number | null;
}

function mix(rows: MixRaw[], viewer: V): MixShown[] {
  const shown = rows.map((r) => ({ r, p: presentCount(r.people.n, { kind: r.people.kind, viewer }) }));
  const visible = shown.reduce((sum, x) => sum + (x.p.suppressed ? 0 : x.p.exact!), 0);
  return shown.map(({ r, p }) => ({
    key: r.key,
    name: r.name,
    sensitive: r.sensitive,
    teen: r.teen,
    people: { value: p.exact ?? 0, display: p.display, suppressed: p.suppressed },
    share: p.suppressed || visible <= 0 ? null : Math.round((p.exact! / visible) * 1000) / 1000,
  }));
}

export interface PresentedArea {
  query: AreaQuery;
  area: AreaRaw["area"];
  selection: {
    unit: "people" | "businesses" | "people and businesses";
    value: PNum;
    /** Per 1,000 residents. null while the value is suppressed for this viewer. */
    per1000: number | null;
    nationalPer1000: number;
    newThisMonth: PNum;
    growthPct: number | null;
    rank: { rank: number | null; of: number; within: string };
  };
  brands: { brand: BrandId; name: string; people: PNum; businesses: PNum }[];
  god: { people: PNum; businesses: PNum } | null;
  series: { months: string[]; values: number[] };
  ageMix: { band: string; teen: boolean; people: PNum; share: number | null }[];
}

const BRAND_NAMES: Record<BrandId, string> = { yourtal: "YourTal", snapapp: "SnapApp", ftr: "Free Tax Returns" };

export function presentArea(raw: AreaRaw, query: AreaQuery, viewer: V): PresentedArea {
  const value = presentCount(raw.value.n, { kind: "adult", viewer });
  const fresh = presentCount(raw.newThisMonth.n, { kind: "adult", viewer });
  const p = (c: RawCount): PNum => toPNum(c.n, { kind: c.kind, viewer });
  return {
    query,
    area: raw.area,
    selection: {
      unit: query.audience === "both" ? "people and businesses" : query.audience,
      value: { value: value.exact ?? 0, display: value.display, suppressed: value.suppressed },
      per1000:
        value.exact === null || raw.area.population <= 0 ? null : round2((raw.value.n / raw.area.population) * 1000),
      nationalPer1000: raw.nationalPopulation > 0 ? round2((raw.nationalValue / raw.nationalPopulation) * 1000) : 0,
      newThisMonth: { value: fresh.exact ?? 0, display: fresh.display, suppressed: fresh.suppressed },
      growthPct: pct(raw.newThisMonth.n, raw.previous.n, !fresh.suppressed),
      // A rank would show where a hidden count sits among its neighbours (the Owner and Data team see the count, so the rank).
      rank: { rank: value.exact === null ? null : raw.rank.rank, of: raw.rank.of, within: raw.rank.within },
    },
    brands: raw.brands.map((b) => ({
      brand: b.brand,
      name: BRAND_NAMES[b.brand],
      people: p(b.people),
      businesses: p(b.businesses),
    })),
    god: raw.god ? { people: p(raw.god.people), businesses: p(raw.god.businesses) } : null,
    series: { months: raw.seriesMonths, values: series(raw.series, viewer) },
    ageMix: mix(
      raw.ageMix.map((a) => ({ key: a.band, name: a.band, sensitive: false, teen: a.teen, people: a.people })),
      viewer,
    ).map((r) => ({ band: r.key, teen: r.teen, people: r.people, share: r.share })),
  };
}

/* ---------------- activity: hotspots and one area ---------------- */

export interface PresentedHotspots {
  query: HotspotQuery;
  hotspots: {
    rank: number;
    id: string;
    name: string;
    parent: string;
    centroid: [number, number];
    value: number;
    display: string;
    suppressed: boolean;
    mix: {
      category: string;
      name: string;
      sensitive: boolean;
      value: number;
      display: string;
      suppressed: boolean;
      share: number | null;
    }[];
  }[];
}

export function presentHotspots(raw: HotspotsRaw, query: HotspotQuery, viewer: V): PresentedHotspots {
  const out: PresentedHotspots["hotspots"] = [];
  for (const h of raw.hotspots) {
    const p = presentCount(h.people.n, { kind: h.people.kind, viewer });
    if (p.suppressed) continue; // a hotspot is an area with a visible figure
    out.push({
      rank: out.length + 1,
      id: h.id,
      name: h.name,
      parent: h.parent,
      centroid: h.centroid,
      value: p.exact!,
      display: p.display,
      suppressed: false,
      mix: mix(h.mix, viewer).map((m) => ({
        category: m.key,
        name: m.name,
        sensitive: m.sensitive,
        value: m.people.value,
        display: m.people.display,
        suppressed: m.people.suppressed,
        share: m.share,
      })),
    });
  }
  return { query, hotspots: out };
}

export interface PresentedActivityArea {
  query: ActivityAreaQuery;
  area: ActivityAreaRaw["area"];
  total: PNum;
  categoryMix: { category: string; name: string; sensitive: boolean; people: PNum; share: number | null }[];
  ageMix: { band: string; teen: boolean; people: PNum; share: number | null }[];
  merchants: (ActivityMerchant & { suburb: string })[];
}

export function presentActivityArea(
  raw: ActivityAreaRaw,
  query: ActivityAreaQuery,
  viewer: V,
): PresentedActivityArea {
  return {
    query,
    area: raw.area,
    total: toPNum(raw.total.n, { kind: raw.total.kind, viewer }),
    categoryMix: mix(raw.categoryMix, viewer).map((m) => ({
      category: m.key,
      name: m.name,
      sensitive: m.sensitive,
      people: m.people,
      share: m.share,
    })),
    ageMix: mix(raw.ageMix, viewer).map((m) => ({ band: m.key, teen: m.teen, people: m.people, share: m.share })),
    merchants: raw.merchants.map((m) => {
      const p = presentCount(m.receipts.n, { kind: m.receipts.kind, viewer });
      return {
        id: m.id,
        name: m.name,
        category: m.category,
        suburb: m.suburb,
        lat: m.lat,
        lon: m.lon,
        value: p.exact ?? 0,
        display: p.display,
        suppressed: p.suppressed,
      };
    }),
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
  /** The suburb at the cell's centre, where it is, and the centre as [lon, lat]. */
  name: string;
  parent: string;
  centroid: [number, number];
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
    return {
      id: h.id,
      name: h.name,
      parent: h.parent,
      centroid: h.centroid,
      value: p.exact ?? 0,
      display: p.display,
      suppressed: p.suppressed,
      band: 0,
    };
  });
  const legend = countLegend(
    heat.map((h) => h.value),
    kind === "adult" ? 10 : 20,
  );
  for (const h of heat) h.band = h.suppressed ? 0 : countBand(h.value, legend);
  return { query, merchants, heat, legend, truncated: raw.truncated };
}

/* ---------------- text with numbers in it ---------------- */

/**
 * Fills the {name} placeholders of a TextRaw with thresholded numbers, so a sentence cannot carry a raw count.
 * A small number the viewer may see exactly (Owner and Data team) is printed in full and tagged "(small number)",
 * the plain-text form of the small-number marker.
 */
export function fillText(t: TextRaw, viewer: V): string {
  return t.text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const c = t.counts[key];
    if (!c) throw new RangeError(`text placeholder {${key}} has no count`);
    const p = toPNum(c.n, { kind: c.kind, viewer });
    const exactSmall = p.suppressed && !p.display.startsWith("<");
    return exactSmall ? `${p.display} (small number)` : p.display;
  });
}

/** The overview as a page receives it: counts thresholded, and each "What changed" line printed as plain text. */
export type PresentedOverview = Present<Omit<OverviewRaw, "changes">> & {
  changes: { severity: Change["severity"]; title: string; detail: string; pageId: string }[];
};

export function presentOverview(raw: OverviewRaw, viewer: V): PresentedOverview {
  const { changes, ...rest } = raw;
  return {
    ...presentTree(rest, viewer),
    changes: changes.map((c) => ({
      severity: c.severity,
      title: fillText(c.title, viewer),
      detail: fillText(c.detail, viewer),
      pageId: c.pageId,
    })),
  };
}
