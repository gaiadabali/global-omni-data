/**
 * The map views live in the query string, so a view can be shared and the screenshot tool can open a given view:
 *
 *   /map?brand=yourtal&audience=people&measure=per1000&month=2026-05&z=9.6&lat=-33.87&lon=151.2&sel=NSW
 *   /activity?category=cafe&ageBand=13-17&month=2026-05&heat=0&off=fuel,ent&z=9&lat=-37.81&lon=144.96
 *
 * Parsing never throws: anything missing or not valid falls back to the default, so a hand-edited URL still opens.
 * Serialising leaves out values equal to their default, so the URL stays short.
 */
import { MAX_ZOOM, MIN_ZOOM } from "./zoom";

export type SearchInput = URLSearchParams | Record<string, string | string[] | undefined>;

function get(input: SearchInput, key: string): string | undefined {
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
  const v = input[key];
  return Array.isArray(v) ? v[0] : v;
}

export interface MapMetaLike {
  months: readonly string[];
  currentMonth: string;
  ageBands: readonly string[];
  teenBand: number;
  categories: readonly { id: string; name: string; sensitive: boolean }[];
  /** The boundary files for the SA4, SA3 and SA2 levels (same-origin, versioned URLs). */
  geo?: { levels: Readonly<Record<"state" | "sa4" | "sa3" | "sa2", string>> };
}

/* ---------------- the view ---------------- */

export interface ViewState {
  z: number;
  lat: number;
  lon: number;
}

function num(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** All three of z, lat and lon, or null (then the map fits Australia). */
export function parseView(input: SearchInput): ViewState | null {
  const z = num(get(input, "z"));
  const lat = num(get(input, "lat"));
  const lon = num(get(input, "lon"));
  if (z === null || lat === null || lon === null) return null;
  if (lat < -85 || lat > 85 || lon < -180 || lon > 180) return null;
  return { z: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)), lat, lon };
}

export function viewParams(v: ViewState | null, out: URLSearchParams): void {
  if (!v) return;
  out.set("z", String(Math.round(v.z * 100) / 100));
  out.set("lat", String(Math.round(v.lat * 1000) / 1000));
  out.set("lon", String(Math.round(v.lon * 1000) / 1000));
}

function monthOf(raw: string | undefined, meta: MapMetaLike): string {
  return raw !== undefined && meta.months.includes(raw) ? raw : meta.currentMonth;
}

function pick<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  return raw !== undefined && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/* ---------------- influence map ---------------- */

export const BRAND_CHOICES = ["all", "yourtal", "snapapp", "ftr"] as const;
export type BrandChoice = (typeof BRAND_CHOICES)[number];
export const AUDIENCES = ["both", "businesses", "people"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const MEASURES = ["count", "per1000"] as const;
export type Measure = (typeof MEASURES)[number];

export interface InfluenceState {
  brand: BrandChoice;
  audience: Audience;
  measure: Measure;
  month: string;
  view: ViewState | null;
  /** The selected area: a state code or an h3 index. */
  sel: string | null;
}

/** A state code or an h3 index: letters and digits only, so nothing odd is ever put back into a request. */
function parseSel(raw: string | undefined): string | null {
  return raw !== undefined && /^[A-Za-z0-9]{2,16}$/.test(raw) ? raw : null;
}

export function parseInfluenceState(
  input: SearchInput,
  meta: MapMetaLike,
  lockedBrand?: BrandChoice,
): InfluenceState {
  return {
    brand: lockedBrand ?? pick(get(input, "brand"), BRAND_CHOICES, "all"),
    audience: pick(get(input, "audience"), AUDIENCES, "both"),
    measure: pick(get(input, "measure"), MEASURES, "count"),
    month: monthOf(get(input, "month"), meta),
    view: parseView(input),
    sel: parseSel(get(input, "sel")),
  };
}

export function serialiseInfluenceState(s: InfluenceState, meta: MapMetaLike): string {
  const p = new URLSearchParams();
  if (s.brand !== "all") p.set("brand", s.brand);
  if (s.audience !== "both") p.set("audience", s.audience);
  if (s.measure !== "count") p.set("measure", s.measure);
  if (s.month !== meta.currentMonth) p.set("month", s.month);
  viewParams(s.view, p);
  if (s.sel) p.set("sel", s.sel);
  return p.toString();
}

/* ---------------- activity map ---------------- */

export interface ActivityState {
  /** A category id, or "all". */
  category: string;
  /** An age band name, or "all". */
  ageBand: string;
  month: string;
  /** Show the activity-area layer. */
  heat: boolean;
  /** Category ids switched off in the dot legend. */
  off: string[];
  view: ViewState | null;
  /** The selected merchant id ("M-0012") or heat cell (an h3 index). */
  sel: string | null;
}

/** "13-17" and "13–17" both name the teen band. Returns the API's spelling, or null. */
export function normaliseAgeBand(raw: string | undefined, meta: MapMetaLike): string | null {
  if (raw === undefined) return null;
  const dashed = raw.replace(/[-–−]/g, "–").trim();
  return meta.ageBands.find((a) => a === dashed) ?? null;
}

export function isTeenBand(ageBand: string, meta: MapMetaLike): boolean {
  return ageBand === meta.ageBands[meta.teenBand];
}

export function isSensitive(category: string, meta: MapMetaLike): boolean {
  return meta.categories.some((c) => c.id === category && c.sensitive);
}

export function parseActivityState(input: SearchInput, meta: MapMetaLike): ActivityState {
  const ids = meta.categories.map((c) => c.id);
  const ageBand = normaliseAgeBand(get(input, "ageBand"), meta) ?? "all";
  let category = pick(get(input, "category"), ["all", ...ids], "all");
  // The API refuses a sensitive category for teens, so a URL asking for it opens on all categories instead.
  if (isTeenBand(ageBand, meta) && isSensitive(category, meta)) category = "all";
  const off = (get(input, "off") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x, i, all) => ids.includes(x) && all.indexOf(x) === i);
  const sel = get(input, "sel");
  return {
    category,
    ageBand,
    month: monthOf(get(input, "month"), meta),
    heat: get(input, "heat") !== "0",
    off,
    view: parseView(input),
    sel: sel !== undefined && /^[A-Za-z0-9-]{2,20}$/.test(sel) ? sel : null,
  };
}

export function serialiseActivityState(s: ActivityState, meta: MapMetaLike): string {
  const p = new URLSearchParams();
  if (s.category !== "all") p.set("category", s.category);
  if (s.ageBand !== "all") p.set("ageBand", s.ageBand.replace(/–/g, "-"));
  if (s.month !== meta.currentMonth) p.set("month", s.month);
  if (!s.heat) p.set("heat", "0");
  if (s.off.length) p.set("off", s.off.join(","));
  viewParams(s.view, p);
  if (s.sel) p.set("sel", s.sel);
  return p.toString();
}
