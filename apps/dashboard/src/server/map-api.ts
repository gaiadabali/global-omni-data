import { GEO_VERSION } from "@god/geo";
import { AGE_BANDS, CATEGORIES, CURRENT_MONTH, MONTHS, TEEN_BAND } from "@god/synthetic";
import { canQueryBrand, requireApi } from "./access";
import {
  DataAccessError,
  getDashboardData,
  type ActivityAreaQuery,
  type ActivityQuery,
  type AreaLevel,
  type AreaQuery,
  type BBox,
  type DashboardData,
  type H3Res,
  type HotspotQuery,
  type InfluenceQuery,
  type SummaryQuery,
} from "./data";
import { isBrandId, type Viewer } from "./types";

/**
 * The map API, as plain functions: GET /api/map/influence and GET /api/map/activity call these.
 * Order of work, always: check access, validate the query, check the viewer may ask about that brand, fetch,
 * threshold for the viewer (inside getDashboardData). A response never carries a person or a person-level point.
 */
export interface ApiResult {
  status: number;
  body: unknown;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

function parseMonth(raw: string | null): Parsed<string> {
  const m = raw ?? CURRENT_MONTH;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return bad("month must look like 2026-11");
  if (!MONTHS.includes(m)) return bad(`month must be between ${MONTHS[0]} and ${CURRENT_MONTH}`);
  return { ok: true, value: m };
}

function parseBBox(raw: string | null): Parsed<BBox | undefined> {
  if (raw === null || raw === "") return { ok: true, value: undefined };
  const parts = raw.split(",");
  if (parts.length !== 4) return bad("bbox must be west,south,east,north");
  const nums = parts.map((p) => (p.trim() === "" ? Number.NaN : Number(p)));
  if (nums.some((n) => !Number.isFinite(n))) return bad("bbox must be four numbers");
  const [w, s, e, n] = nums as [number, number, number, number];
  if (w < -180 || e > 180 || s < -90 || n > 90) return bad("bbox is outside the world");
  if (w >= e || s >= n) return bad("bbox must have west < east and south < north");
  return { ok: true, value: [w, s, e, n] };
}

const AREA_LEVELS: readonly AreaLevel[] = ["state", "sa4", "sa3", "sa2"];

/** brand, audience, measure and month: the same on every influence-style endpoint. */
function parseSelection(sp: URLSearchParams): Parsed<Pick<InfluenceQuery, "brand" | "audience" | "measure" | "month">> {
  const brand = sp.get("brand") ?? "all";
  if (brand !== "all" && !isBrandId(brand)) return bad("brand must be yourtal, snapapp, ftr or all");
  const audience = sp.get("audience") ?? "both";
  if (audience !== "businesses" && audience !== "people" && audience !== "both") {
    return bad("audience must be businesses, people or both");
  }
  const measure = sp.get("measure") ?? "count";
  if (measure !== "count" && measure !== "per1000") return bad("measure must be count or per1000");
  const month = parseMonth(sp.get("month"));
  if (!month.ok) return month;
  return { ok: true, value: { brand, audience, measure, month: month.value } };
}

export function parseInfluenceQuery(sp: URLSearchParams): Parsed<InfluenceQuery> {
  const sel = parseSelection(sp);
  if (!sel.ok) return sel;
  const bbox = parseBBox(sp.get("bbox"));
  if (!bbox.ok) return bbox;

  const levelRaw = sp.get("level") ?? "state";
  let level: InfluenceQuery["level"];
  if ((AREA_LEVELS as readonly string[]).includes(levelRaw)) {
    level = levelRaw as AreaLevel;
    if (level === "sa2" && !bbox.value) return bad("bbox is required at level sa2");
  } else if (levelRaw === "h3") {
    const res = Number(sp.get("res") ?? "6");
    if (res !== 6 && res !== 7) return bad("res must be 6 or 7 (the maps stop at suburb size)");
    if (!bbox.value) return bad("bbox is required at level h3");
    level = { h3: res as H3Res };
  } else {
    return bad("level must be state, sa4, sa3, sa2 or h3");
  }
  return { ok: true, value: { ...sel.value, level, ...(bbox.value ? { bbox: bbox.value } : {}) } };
}

export function parseSummaryQuery(sp: URLSearchParams): Parsed<SummaryQuery> {
  const sel = parseSelection(sp);
  if (!sel.ok) return sel;
  const level = sp.get("level") ?? "state";
  if (!(AREA_LEVELS as readonly string[]).includes(level)) return bad("level must be state, sa4, sa3 or sa2");
  const limit = Number(sp.get("limit") ?? "20");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return bad("limit must be a whole number from 1 to 100");
  return { ok: true, value: { ...sel.value, level: level as AreaLevel, limit } };
}

const ID_PATTERN = /^[A-Za-z0-9]{1,16}$/;

export function parseAreaQuery(sp: URLSearchParams): Parsed<Omit<AreaQuery, "visibleBrands" | "showGod">> {
  const sel = parseSelection(sp);
  if (!sel.ok) return sel;
  const level = sp.get("level");
  if (level === null || !([...AREA_LEVELS, "h3"] as string[]).includes(level)) {
    return bad("level must be state, sa4, sa3, sa2 or h3");
  }
  const id = sp.get("id");
  if (id === null || !ID_PATTERN.test(id)) return bad("id must be an area code or an h3 index");
  return {
    ok: true,
    value: {
      level: level as AreaQuery["level"],
      id,
      brand: sel.value.brand,
      audience: sel.value.audience,
      month: sel.value.month,
    },
  };
}

/** category and ageBand, shared by the activity endpoints. The teen band never goes with a sensitive category. */
function parseActivityFilters(sp: URLSearchParams): Parsed<{ category?: string; ageBand?: string }> {
  const category = sp.get("category");
  if (category !== null && !CATEGORIES.some((c) => c.id === category)) {
    return bad(`category must be one of ${CATEGORIES.map((c) => c.id).join(", ")}`);
  }
  // Accept a plain hyphen as well as the en dash used in the band names.
  const ageRaw = sp.get("ageBand")?.replace("-", "–") ?? null;
  if (ageRaw !== null && !(AGE_BANDS as readonly string[]).includes(ageRaw)) {
    return bad(`ageBand must be one of ${AGE_BANDS.join(", ")}`);
  }
  if (ageRaw === AGE_BANDS[TEEN_BAND] && category !== null && CATEGORIES.find((c) => c.id === category)?.sensitive) {
    return bad("sensitive categories never appear in teen figures");
  }
  return {
    ok: true,
    value: { ...(category !== null ? { category } : {}), ...(ageRaw !== null ? { ageBand: ageRaw } : {}) },
  };
}

export function parseHotspotQuery(sp: URLSearchParams): Parsed<HotspotQuery> {
  const month = parseMonth(sp.get("month"));
  if (!month.ok) return month;
  const bbox = parseBBox(sp.get("bbox"));
  if (!bbox.ok) return bbox;
  const f = parseActivityFilters(sp);
  if (!f.ok) return f;
  const limit = Number(sp.get("limit") ?? "10");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return bad("limit must be a whole number from 1 to 50");
  return { ok: true, value: { month: month.value, limit, ...f.value, ...(bbox.value ? { bbox: bbox.value } : {}) } };
}

export function parseActivityAreaQuery(sp: URLSearchParams): Parsed<ActivityAreaQuery> {
  const month = parseMonth(sp.get("month"));
  if (!month.ok) return month;
  const level = sp.get("level");
  if (level !== "h3" && level !== "sa2") return bad("level must be h3 or sa2");
  const id = sp.get("id");
  if (id === null || !ID_PATTERN.test(id)) return bad("id must be an SA2 code or an h3 index");
  const f = parseActivityFilters(sp);
  if (!f.ok) return f;
  return { ok: true, value: { level, id, month: month.value, ...f.value } };
}

export function parseActivityQuery(sp: URLSearchParams): Parsed<ActivityQuery> {
  const month = parseMonth(sp.get("month"));
  if (!month.ok) return month;
  const bbox = parseBBox(sp.get("bbox"));
  if (!bbox.ok) return bbox;
  const f = parseActivityFilters(sp);
  if (!f.ok) return f;
  const res = Number(sp.get("h3") ?? "7");
  if (![5, 6, 7].includes(res)) return bad("h3 must be 5, 6 or 7 (the maps stop at suburb size)");
  if (res >= 7 && !bbox.value) return bad("bbox is required at h3 resolution 7");
  return {
    ok: true,
    value: {
      month: month.value,
      h3: res as ActivityQuery["h3"],
      ...f.value,
      ...(bbox.value ? { bbox: bbox.value } : {}),
    },
  };
}

function refused(gate: { status: number; error: string }): ApiResult {
  return { status: gate.status, body: { error: gate.error } };
}

export async function handleInfluence(
  viewer: Viewer | null,
  sp: URLSearchParams,
  source?: DashboardData,
): Promise<ApiResult> {
  const gate = requireApi(viewer, "map.influence");
  if (!gate.ok) return refused(gate);
  const q = parseInfluenceQuery(sp);
  if (!q.ok) return { status: 400, body: { error: q.error } };
  if (!canQueryBrand(gate.viewer, q.value.brand)) {
    return { status: 403, body: { error: "Your role cannot see that brand" } };
  }
  const result = await getDashboardData(gate.viewer, source).influenceMap(q.value);
  return { status: 200, body: result };
}

export async function handleSummary(
  viewer: Viewer | null,
  sp: URLSearchParams,
  source?: DashboardData,
): Promise<ApiResult> {
  const gate = requireApi(viewer, "map.summary");
  if (!gate.ok) return refused(gate);
  const q = parseSummaryQuery(sp);
  if (!q.ok) return { status: 400, body: { error: q.error } };
  if (!canQueryBrand(gate.viewer, q.value.brand)) {
    return { status: 403, body: { error: "Your role cannot see that brand" } };
  }
  return { status: 200, body: await getDashboardData(gate.viewer, source).mapSummary(q.value) };
}

export async function handleArea(
  viewer: Viewer | null,
  sp: URLSearchParams,
  source?: DashboardData,
): Promise<ApiResult> {
  const gate = requireApi(viewer, "map.area");
  if (!gate.ok) return refused(gate);
  const q = parseAreaQuery(sp);
  if (!q.ok) return { status: 400, body: { error: q.error } };
  if (!canQueryBrand(gate.viewer, q.value.brand)) {
    return { status: 403, body: { error: "Your role cannot see that brand" } };
  }
  // A brand lead sees their own brand's totals only, and never the all-of-GOD total.
  const lead = gate.viewer.role === "brand_lead" && gate.viewer.brand ? gate.viewer.brand : null;
  const value: AreaQuery = {
    ...q.value,
    visibleBrands: lead ? [lead] : ["yourtal", "snapapp", "ftr"],
    showGod: lead === null,
  };
  const result = await getDashboardData(gate.viewer, source).mapArea(value);
  return result ? { status: 200, body: result } : { status: 404, body: { error: "Unknown area" } };
}

export async function handleActivity(
  viewer: Viewer | null,
  sp: URLSearchParams,
  source?: DashboardData,
): Promise<ApiResult> {
  const gate = requireApi(viewer, "map.activity");
  if (!gate.ok) return refused(gate);
  const q = parseActivityQuery(sp);
  if (!q.ok) return { status: 400, body: { error: q.error } };
  // A brand lead's activity map covers only people who use their own brand.
  const value: ActivityQuery =
    gate.viewer.role === "brand_lead" && gate.viewer.brand
      ? { ...q.value, audienceBrand: gate.viewer.brand }
      : q.value;
  try {
    const result = await getDashboardData(gate.viewer, source).activityMap(value);
    return { status: 200, body: result };
  } catch (e) {
    if (e instanceof DataAccessError) return { status: 403, body: { error: e.message } };
    throw e;
  }
}

export async function handleHotspots(
  viewer: Viewer | null,
  sp: URLSearchParams,
  source?: DashboardData,
): Promise<ApiResult> {
  const gate = requireApi(viewer, "map.hotspots");
  if (!gate.ok) return refused(gate);
  const q = parseHotspotQuery(sp);
  if (!q.ok) return { status: 400, body: { error: q.error } };
  const value: HotspotQuery =
    gate.viewer.role === "brand_lead" && gate.viewer.brand
      ? { ...q.value, audienceBrand: gate.viewer.brand }
      : q.value;
  try {
    return { status: 200, body: await getDashboardData(gate.viewer, source).activityHotspots(value) };
  } catch (e) {
    if (e instanceof DataAccessError) return { status: 403, body: { error: e.message } };
    throw e;
  }
}

export async function handleActivityArea(
  viewer: Viewer | null,
  sp: URLSearchParams,
  source?: DashboardData,
): Promise<ApiResult> {
  const gate = requireApi(viewer, "map.activityArea");
  if (!gate.ok) return refused(gate);
  const q = parseActivityAreaQuery(sp);
  if (!q.ok) return { status: 400, body: { error: q.error } };
  const value: ActivityAreaQuery =
    gate.viewer.role === "brand_lead" && gate.viewer.brand
      ? { ...q.value, audienceBrand: gate.viewer.brand }
      : q.value;
  try {
    const result = await getDashboardData(gate.viewer, source).activityArea(value);
    return result ? { status: 200, body: result } : { status: 404, body: { error: "Unknown area" } };
  } catch (e) {
    if (e instanceof DataAccessError) return { status: 403, body: { error: e.message } };
    throw e;
  }
}

/** Headers for every map API response: per-viewer data, never shared, never stored. */
export const API_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-cache",
  Vary: "Cookie",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

/**
 * What the map screens need to draw their controls: the months on offer, the age bands, and the categories with
 * their sensitive flag. It comes from here so the screens never hard-code a list the API validates against.
 */
export interface MapMeta {
  /** "YYYY-MM", oldest first. */
  months: string[];
  currentMonth: string;
  /** Age band names as the API spells them ("13–17", "18–24", ...). */
  ageBands: string[];
  /** Index into `ageBands` of the teen band. */
  teenBand: number;
  categories: { id: string; name: string; sensitive: boolean }[];
  /** The static boundary files (public/geo, generated from @god/geo). The URLs carry the data version and are immutable. */
  geo: { version: string; levels: Record<"state" | "sa4" | "sa3" | "sa2", string> };
}

export function mapMeta(): MapMeta {
  return {
    months: [...MONTHS],
    currentMonth: CURRENT_MONTH,
    ageBands: [...AGE_BANDS],
    teenBand: TEEN_BAND,
    categories: CATEGORIES.map((c) => ({ id: c.id, name: c.name, sensitive: c.sensitive })),
    geo: {
      version: GEO_VERSION,
      levels: {
        state: `/geo/state.json?v=${GEO_VERSION}`,
        sa4: `/geo/sa4.json?v=${GEO_VERSION}`,
        sa3: `/geo/sa3.json?v=${GEO_VERSION}`,
        sa2: `/geo/sa2.json?v=${GEO_VERSION}`,
      },
    },
  };
}
