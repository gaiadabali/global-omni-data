/**
 * Small pure helpers for the map pages' panels: which level an id belongs to, bubble sizes, the name search, the
 * wording of a change. No React and no map library, so they are tested on their own.
 */
import { fmtInt } from "@/lib/format";
import type { InfluenceLevel } from "./zoom";

export type IdLevel = "state" | "sa4" | "sa3" | "sa2" | "h3";

/** The level an area id belongs to, from its shape: NSW, 125, 12504, 125041717 or an h3 index. null for anything else. */
export function levelOfId(id: string): IdLevel | null {
  if (/^[A-Z]{2,3}$/.test(id)) return "state";
  if (/^\d{3}$/.test(id)) return "sa4";
  if (/^\d{5}$/.test(id)) return "sa3";
  if (/^\d{9}$/.test(id)) return "sa2";
  if (/^[0-9a-f]{15}$/.test(id)) return "h3";
  return null;
}

/** 1 gives "1st", 12 gives "12th", 23 gives "23rd". */
export function ordinal(n: number): string {
  const r = Math.abs(Math.round(n));
  const tens = r % 100;
  if (tens >= 11 && tens <= 13) return `${r}th`;
  switch (r % 10) {
    case 1:
      return `${r}st`;
    case 2:
      return `${r}nd`;
    case 3:
      return `${r}rd`;
    default:
      return `${r}th`;
  }
}

/** "+1.7%" with a real minus sign, or null when there is nothing to compare with. */
export function signedPct(p: number | null | undefined): string | null {
  if (p === null || p === undefined || !Number.isFinite(p)) return null;
  return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`;
}

/** The month before `month` in the list, or null at the start. */
export function monthBefore(months: readonly string[], month: string): string | null {
  const i = months.indexOf(month);
  return i > 0 ? (months[i - 1] ?? null) : null;
}

/* ---------------- bubbles ---------------- */

/** The biggest bubble in pixels, by level: states are few and large, suburb-size cells are many and small. */
export function bubbleMaxPx(level: InfluenceLevel): number {
  if (level === 6) return 16;
  if (level === 7) return 12;
  switch (level) {
    case "state":
      return 44;
    case "sa4":
      return 32;
    case "sa3":
      return 26;
    default:
      return 22;
  }
}

const MIN_BUBBLE = 3;

/**
 * Bubble radius in pixels. Area, not width, follows the value: r is proportional to the square root. `ref` is the value
 * that gets the biggest bubble (kept the same across months, so a time-lapse shows growth). Nothing to draw for 0.
 */
export function bubbleRadius(value: number, ref: number, maxPx: number): number {
  if (!(value > 0)) return 0;
  if (!(ref > 0)) return MIN_BUBBLE;
  return Math.max(MIN_BUBBLE, Math.min(maxPx, maxPx * Math.sqrt(value / ref)));
}

/** The value a legend band stands for when its bubble is drawn: the middle of a log band, half of the first rate band. */
export function bandValue(band: { band: number; min: number; max: number | null }): number {
  if (band.band === 0) return 0;
  if (band.max === null) return band.min * 1.5;
  if (band.min <= 0) return band.max / 2;
  return Math.sqrt(band.min * band.max);
}

/* ---------------- lists ---------------- */

/** Rows whose name or parent holds every word of the search, in any order and any case. An empty search keeps all. */
export function matchRows<T extends { name: string; parent: string }>(rows: readonly T[], search: string): T[] {
  const words = search
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return [...rows];
  return rows.filter((r) => {
    const hay = `${r.name} ${r.parent}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/* ---------------- counts ---------------- */

export interface CountLike {
  value: number;
  display: string;
  suppressed: boolean;
}

/**
 * The count as a number to size a bar with, or null when the viewer must not have it. A suppressed count is exact only
 * for roles that see small numbers (their display is then a plain number, not "<10").
 */
export function visibleCount(n: CountLike): number | null {
  return !n.suppressed || !n.display.startsWith("<") ? n.value : null;
}

/** "+1,240" for a change, or the API's own "<10" text with "new" after it. */
export function changeText(n: CountLike): string {
  return n.display.startsWith("<") ? `${n.display} new` : `+${n.display}`;
}

/** Share as text: 0.236 gives "24%", under 1% gives "<1%". null stays null. */
export function shareText(share: number | null): string | null {
  if (share === null || !Number.isFinite(share)) return null;
  const p = share * 100;
  if (p > 0 && p < 1) return "<1%";
  return `${Math.round(p)}%`;
}

/** How far this area's rate is from the national one, in words. */
export function versusText(rate: number, national: number): string {
  if (!(national > 0)) return "No national figure to compare with";
  const d = ((rate - national) / national) * 100;
  if (Math.abs(d) < 1) return "In line with Australia";
  return `${fmtInt(Math.abs(d))}% ${d > 0 ? "above" : "below"} Australia`;
}
