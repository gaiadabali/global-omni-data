/**
 * Legend breaks for the maps, computed from the values that are actually returned.
 * Log-rounded bands that always start with "<10": <10, 10–24, 25–99, 100–499, 500–1.9k, 2k+ ... Bands are added
 * as values grow, so a quiet area does not show empty bands.
 */
export interface LegendBreak {
  band: number;
  label: string;
  /** Inclusive lower bound. */
  min: number;
  /** Exclusive upper bound, or null for the last band. */
  max: number | null;
}

const COUNT_BREAKS_10 = [10, 25, 100, 500, 2000, 10000, 50000, 250000];
const COUNT_BREAKS_20 = [20, 50, 200, 1000, 5000, 25000, 100000];
const RATE_BREAKS = [0.5, 1, 2, 5, 10, 20, 50, 100];

/** 999 stays 999, 1,900 is 1.9k, 12,400 is 12k. */
export function shortBound(x: number): string {
  if (x < 1000) return String(x);
  if (x < 10000) return `${x % 1000 === 0 ? x / 1000 : Math.floor(x / 100) / 10}k`;
  return `${Math.floor(x / 1000)}k`;
}

export function countLegend(values: readonly number[], minG: 10 | 20 = 10): LegendBreak[] {
  const all = minG === 20 ? COUNT_BREAKS_20 : COUNT_BREAKS_10;
  let top = 0;
  for (const v of values) if (v > top) top = v;
  const breaks = all.filter((b) => b <= top);
  const out: LegendBreak[] = [{ band: 0, label: `<${minG}`, min: 0, max: breaks[0] ?? null }];
  breaks.forEach((lo, i) => {
    const hi = breaks[i + 1];
    out.push({
      band: i + 1,
      label: hi === undefined ? `${shortBound(lo)}+` : `${shortBound(lo)}–${shortBound(hi - 1)}`,
      min: lo,
      max: hi ?? null,
    });
  });
  return out;
}

/**
 * Per-1,000 scale. Band 0 is the suppressed cells ("<10 people"); the rest are rates, computed from the rates
 * of the cells that are not suppressed.
 */
export function rateLegend(rates: readonly number[], minG: 10 | 20 = 10): LegendBreak[] {
  let top = 0;
  for (const v of rates) if (v > top) top = v;
  const breaks = RATE_BREAKS.filter((b) => b <= top);
  const out: LegendBreak[] = [{ band: 0, label: `<${minG} people`, min: 0, max: null }];
  out.push({
    band: 1,
    label: breaks.length ? `<${breaks[0]}` : "all",
    min: 0,
    max: breaks[0] ?? null,
  });
  breaks.forEach((lo, i) => {
    const hi = breaks[i + 1];
    out.push({
      band: i + 2,
      label: hi === undefined ? `${lo}+` : `${lo}–${hi}`,
      min: lo,
      max: hi ?? null,
    });
  });
  return out;
}

/** The band a count falls in (count legends only). */
export function countBand(value: number, legend: readonly LegendBreak[]): number {
  for (const b of legend) {
    if (value >= b.min && (b.max === null || value < b.max)) return b.band;
  }
  return legend.length - 1;
}

/** The band a per-1,000 rate falls in (rate legends only; band 0 is for suppressed cells). */
export function rateBand(rate: number, legend: readonly LegendBreak[]): number {
  for (const b of legend) {
    if (b.band === 0) continue;
    if (rate >= b.min && (b.max === null || rate < b.max)) return b.band;
  }
  return legend.length - 1;
}
