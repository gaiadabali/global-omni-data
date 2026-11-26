import { AGE_BANDS, CATEGORIES, CURRENT_MONTH, MONTHS, TEEN_BAND } from "@god/synthetic";
import { canQueryBrand, requireApi } from "./access";
import {
  DataAccessError,
  getDashboardData,
  type ActivityQuery,
  type BBox,
  type DashboardData,
  type H3Res,
  type InfluenceQuery,
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

export function parseInfluenceQuery(sp: URLSearchParams): Parsed<InfluenceQuery> {
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
  const bbox = parseBBox(sp.get("bbox"));
  if (!bbox.ok) return bbox;

  const levelRaw = sp.get("level") ?? "state";
  let level: InfluenceQuery["level"];
  if (levelRaw === "state") {
    level = "state";
  } else if (levelRaw === "h3") {
    const res = Number(sp.get("res") ?? "5");
    if (!Number.isInteger(res) || res < 3 || res > 8) return bad("res must be a whole number from 3 to 8");
    if (res >= 7 && !bbox.value) return bad("bbox is required at h3 resolution 7 and 8");
    level = { h3: res as H3Res };
  } else {
    return bad("level must be state or h3");
  }
  return {
    ok: true,
    value: {
      brand,
      audience,
      measure,
      month: month.value,
      level,
      ...(bbox.value ? { bbox: bbox.value } : {}),
    },
  };
}

export function parseActivityQuery(sp: URLSearchParams): Parsed<ActivityQuery> {
  const month = parseMonth(sp.get("month"));
  if (!month.ok) return month;
  const bbox = parseBBox(sp.get("bbox"));
  if (!bbox.ok) return bbox;

  const category = sp.get("category");
  if (category !== null && !CATEGORIES.some((c) => c.id === category)) {
    return bad(`category must be one of ${CATEGORIES.map((c) => c.id).join(", ")}`);
  }
  // Accept a plain hyphen as well as the en dash used in the band names.
  const ageRaw = sp.get("ageBand")?.replace("-", "–") ?? null;
  if (ageRaw !== null && !(AGE_BANDS as readonly string[]).includes(ageRaw)) {
    return bad(`ageBand must be one of ${AGE_BANDS.join(", ")}`);
  }
  const res = Number(sp.get("h3") ?? "7");
  if (![5, 6, 7, 8].includes(res)) return bad("h3 must be 5, 6, 7 or 8");
  if (res >= 7 && !bbox.value) return bad("bbox is required at h3 resolution 7 and 8");

  const teen = ageRaw === AGE_BANDS[TEEN_BAND];
  if (teen && category !== null && CATEGORIES.find((c) => c.id === category)?.sensitive) {
    return bad("sensitive categories never appear in teen figures");
  }
  return {
    ok: true,
    value: {
      month: month.value,
      h3: res as ActivityQuery["h3"],
      ...(category !== null ? { category } : {}),
      ...(ageRaw !== null ? { ageBand: ageRaw } : {}),
      ...(bbox.value ? { bbox: bbox.value } : {}),
    },
  };
}

export async function handleInfluence(
  viewer: Viewer | null,
  sp: URLSearchParams,
  source?: DashboardData,
): Promise<ApiResult> {
  const gate = requireApi(viewer, "map.influence");
  if (!gate.ok) return { status: gate.status, body: { error: gate.error } };
  const q = parseInfluenceQuery(sp);
  if (!q.ok) return { status: 400, body: { error: q.error } };
  if (!canQueryBrand(gate.viewer, q.value.brand)) {
    return { status: 403, body: { error: "Your role cannot see that brand" } };
  }
  const result = await getDashboardData(gate.viewer, source).influenceMap(q.value);
  return { status: 200, body: result };
}

export async function handleActivity(
  viewer: Viewer | null,
  sp: URLSearchParams,
  source?: DashboardData,
): Promise<ApiResult> {
  const gate = requireApi(viewer, "map.activity");
  if (!gate.ok) return { status: gate.status, body: { error: gate.error } };
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
}

export function mapMeta(): MapMeta {
  return {
    months: [...MONTHS],
    currentMonth: CURRENT_MONTH,
    ageBands: [...AGE_BANDS],
    teenBand: TEEN_BAND,
    categories: CATEGORIES.map((c) => ({ id: c.id, name: c.name, sensitive: c.sensitive })),
  };
}
