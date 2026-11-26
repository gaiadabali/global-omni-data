import { fmtInt } from "@/lib/format";
import type { Viewer } from "./types";

/**
 * THE PRIVACY SEAM. Every number that can reach an executive or a brand lead passes through presentCount.
 *
 *   adult figures:            under 10 shows as "<10"
 *   teen and sensitive:       under 20 shows as "<20"
 *   owner and data roles:     get the exact value of a small adult or sensitive count, with suppressed: true so
 *                             the UI can show a "small number" marker. Never a teen count under 20: those exist
 *                             for nobody (teen data standard, approved 2026-11-26)
 *
 * Brand roles never get the exact value below the threshold, not even in a JSON response (exact is null).
 */
export type CountKind = "adult" | "teen" | "sensitive";

export const THRESHOLDS: Record<CountKind, number> = { adult: 10, teen: 20, sensitive: 20 };

export interface PresentedCount {
  /** What to print: a formatted number, or "<10" / "<20". */
  display: string;
  /** The exact value, or null when the viewer must not have it. */
  exact: number | null;
  /** True when the count is under its threshold (the UI marks it, or hides it). */
  suppressed: boolean;
}

export function thresholdFor(kind: CountKind): number {
  return THRESHOLDS[kind];
}

/** Owner and Data team see exact small numbers; nobody else does. */
export function seesExactSmallNumbers(viewer: Pick<Viewer, "role">): boolean {
  return viewer.role === "owner" || viewer.role === "data";
}

export function presentCount(
  n: number,
  opts: { kind: CountKind; viewer: Pick<Viewer, "role"> },
): PresentedCount {
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`presentCount: not a count: ${n}`);
  const value = Math.round(n);
  const threshold = THRESHOLDS[opts.kind];
  if (value >= threshold) return { display: fmtInt(value), exact: value, suppressed: false };
  // Teen figures under 20 exist for nobody, Owner and Data team included (teen data standard, pack tab 3).
  if (opts.kind !== "teen" && seesExactSmallNumbers(opts.viewer)) {
    return { display: fmtInt(value), exact: value, suppressed: true };
  }
  return { display: `<${threshold}`, exact: null, suppressed: true };
}

/** For charts: the number to plot. A suppressed count is plotted as 0 for roles that must not see it. */
export function plottable(p: PresentedCount): number {
  return p.exact ?? 0;
}

/** A count ready for the UI: print `display`, plot `value`, mark small numbers when `suppressed` and exact. */
export interface PNum {
  value: number;
  display: string;
  suppressed: boolean;
}

export function toPNum(n: number, opts: { kind: CountKind; viewer: Pick<Viewer, "role"> }): PNum {
  const p = presentCount(n, opts);
  return { value: plottable(p), display: p.display, suppressed: p.suppressed };
}
