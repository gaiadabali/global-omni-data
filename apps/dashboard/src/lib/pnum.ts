import type { PNum } from "@/server/privacy";
import { fmtPct } from "./format";

/**
 * Small helpers for printing thresholded counts. A page gets PNums (value, display, suppressed). A count the
 * viewer must not see exactly is "hidden": its display is "<10" or "<20" and its value is 0.
 */

/** True when the viewer gets only "<10" / "<20" for this count. */
export function isHidden(p: PNum): boolean {
  return p.suppressed && p.value === 0 && p.display.startsWith("<");
}

/** True when the viewer sees the exact value of a count under its threshold (Owner and Data team, adults only). */
export function isExactSmall(p: PNum): boolean {
  return p.suppressed && !p.display.startsWith("<");
}

export interface ShareRows {
  labels: string[];
  /** Percent of the whole (0 to 100). 0 for a hidden count, so a bar never reveals it. */
  values: number[];
  /** What to print at the end of each bar: "34%", "<10", or "7 (small)". */
  valueLabels: string[];
}

/** The text for one part of a whole: its share when the viewer may see it, or the threshold text when not. */
export function shareText(part: PNum, whole: PNum, digits = 0): string {
  if (isHidden(part)) return part.display;
  if (isHidden(whole) || whole.value <= 0) return part.display;
  const pct = fmtPct(part.value / whole.value, digits);
  return isExactSmall(part) ? `${part.display} (small)` : pct;
}

/** Rows of { label, value } as the horizontal bar chart wants them, as shares of `whole`. */
export function shareRows(rows: { label: string; value: PNum }[], whole: PNum, digits = 0): ShareRows {
  return {
    labels: rows.map((r) => r.label),
    values: rows.map((r) => (isHidden(r.value) || whole.value <= 0 ? 0 : (r.value.value / whole.value) * 100)),
    valueLabels: rows.map((r) => shareText(r.value, whole, digits)),
  };
}
