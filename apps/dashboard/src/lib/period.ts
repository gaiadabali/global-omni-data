import { PERIODS, PERIOD_LABELS, type Period } from "@/server/data/types";
import type { SegmentOption } from "@/components/ui/Segmented";

/** Reads ?period= from a page's searchParams. Anything unknown is "month". */
export function parsePeriod(value: string | string[] | undefined): Period {
  const v = Array.isArray(value) ? value[0] : value;
  return (PERIODS as readonly string[]).includes(v ?? "") ? (v as Period) : "month";
}

/** Options for a <Segmented> that switches the period by URL. */
export function periodOptions(basePath: string): SegmentOption[] {
  return PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p], href: `${basePath}?period=${p}` }));
}

const NOUN: Record<Period, string> = {
  week: "week",
  month: "month",
  quarter: "quarter",
  ytd: "year to date",
};

/** "week", "month", "quarter", "year to date": for "New this month" style labels. */
export function periodNoun(p: Period): string {
  return NOUN[p];
}
