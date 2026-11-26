/**
 * Dates for the dashboard. No Intl and no locale, so the server and the browser print the same text. Times are
 * shown in Australian Eastern time (a fixed +11:00, which is where the approved design sits in November).
 */

/** "Today" for the synthetic phase: the date every figure is "as of". */
export const TODAY = "2026-11-26";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const OFFSET_MS = 11 * 3_600_000;

/** "2026-11-24" gives "24 Nov 2026". Anything else comes back unchanged. */
export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

/** An ISO instant gives "26 Nov 2026, 09:12" in Australian Eastern time. */
export function fmtDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

/** True for a real calendar date written "YYYY-MM-DD". */
export function isIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Start and end (as epoch ms) of a day written "YYYY-MM-DD", in Australian Eastern time. */
export function dayRange(iso: string): { start: number; end: number } | null {
  if (!isIsoDate(iso)) return null;
  const start = Date.parse(`${iso}T00:00:00+11:00`);
  return { start, end: start + 86_400_000 - 1 };
}
