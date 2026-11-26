/** Number and date formatting. No Intl, so the server and the browser always print the same text. */

export function fmtInt(n: number): string {
  const r = Math.round(n);
  const sign = r < 0 ? "-" : "";
  return sign + String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 1,284 under 10k, 12k, 1.2m. Lower case k and m, as in the approved design. */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}m`;
  if (a >= 1e4) return `${sign}${Math.floor(a / 1e3)}k`;
  if (a >= 1e3) return `${sign}${Math.floor(a / 100) / 10}k`;
  return `${sign}${Math.round(a)}`;
}

export function fmtAud(n: number): string {
  if (n >= 1e6) return `A$${(n / 1e6).toFixed(1)}m`;
  return `A$${fmtInt(n)}`;
}

export function fmtPct(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-11" gives "Nov". */
export function monthShort(ym: string): string {
  return MONTH_SHORT[Number(ym.slice(5, 7)) - 1] ?? ym;
}

/** "2026-11" gives "Nov 2026". */
export function monthLong(ym: string): string {
  return `${monthShort(ym)} ${ym.slice(0, 4)}`;
}

/** Percentage change as text with a sign, or null when there is nothing to compare with. */
export function deltaText(now: number, before: number): { text: string; up: boolean } | null {
  if (!before) return null;
  const d = (now - before) / before;
  return { text: `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`, up: d >= 0 };
}

/** Axis and tooltip labels for a list of "YYYY-MM" months: "Nov 26" and "Nov 2026". */
export function monthLabels(months: readonly string[]): { short: string[]; full: string[] } {
  return {
    short: months.map((m) => `${monthShort(m)} ${m.slice(2, 4)}`),
    full: months.map((m) => monthLong(m)),
  };
}
