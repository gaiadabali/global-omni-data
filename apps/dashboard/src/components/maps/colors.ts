/**
 * Colour for the maps. The scales are built from the app's theme tokens (--map-base, --yt, --heat ...), read from
 * the page at run time, so both themes follow the app. Pure functions: no DOM here except `readTokens`, which is
 * given the element to read from.
 */
export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

/** "#0c158e", "#fff" or "rgb(12, 21, 142)" as numbers, or null. */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const v = parseInt(m[1]!, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return [parseInt(m[1]! + m[1]!, 16), parseInt(m[2]! + m[2]!, 16), parseInt(m[3]! + m[3]!, 16)];
  const r = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(s);
  if (r) return [Math.round(+r[1]!), Math.round(+r[2]!), Math.round(+r[3]!)];
  return null;
}

/** `top` laid over `base` at `pct` percent (like CSS color-mix(in srgb, top pct%, base)). */
export function mix(base: RGB, top: RGB, pct: number): RGB {
  const t = Math.max(0, Math.min(100, pct)) / 100;
  return [
    Math.round(base[0] * (1 - t) + top[0] * t),
    Math.round(base[1] * (1 - t) + top[1] * t),
    Math.round(base[2] * (1 - t) + top[2] * t),
  ];
}

export function withAlpha(c: RGB, alpha: number): RGBA {
  return [c[0], c[1], c[2], Math.round(Math.max(0, Math.min(1, alpha)) * 255)];
}

export function rgbCss(c: RGB): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * How much of the brand colour a band gets, in percent. Band 0 (the "<10" band, which is also where cells under
 * the threshold go) is a faint tint, never empty: blank land means nobody is registered there, "<10" means a few.
 * The other bands step evenly from 22 to 90. `bands` is the length of the API's legend.
 */
export function fillPct(band: number, bands: number): number {
  if (band <= 0) return 9;
  if (bands <= 2) return 60;
  const b = Math.min(band, bands - 1);
  return Math.round(22 + ((b - 1) / (bands - 2)) * 68);
}

/** The fill colour of a band on the sequential scale from `base` (the map's empty colour) to `brand`. */
export function bandColor(band: number, bands: number, base: RGB, brand: RGB): RGB {
  return mix(base, brand, fillPct(band, bands));
}

/** Activity-area opacity by band: very faint under the threshold, then rising with the square root. */
export function heatAlpha(band: number, bands: number): number {
  if (band <= 0) return 0.06;
  if (bands <= 2) return 0.6;
  const t = Math.min(band, bands - 1) - 1;
  return Math.round((0.16 + 0.72 * Math.sqrt(t / (bands - 2))) * 100) / 100;
}

/* ---------------- tokens ---------------- */

export interface MapTokens {
  bg: RGB;
  land: RGB;
  line: RGB;
  base: RGB;
  ink: RGB;
  heat: RGB;
  info: RGB;
  brands: Record<"yourtal" | "snapapp" | "ftr" | "all", RGB>;
  categories: Record<string, RGB>;
  dark: boolean;
}

const FALLBACK: MapTokens = {
  bg: [233, 235, 246],
  land: [250, 250, 254],
  line: [169, 174, 203],
  base: [241, 242, 250],
  ink: [16, 18, 43],
  heat: [210, 86, 27],
  info: [42, 98, 184],
  brands: { yourtal: [177, 39, 155], snapapp: [10, 133, 116], ftr: [184, 117, 0], all: [12, 21, 142] },
  categories: {},
  dark: false,
};

export const CATEGORY_IDS = ["fuel", "groc", "cafe", "retail", "pharm", "ent"] as const;

/** Reads the theme tokens from an element's computed style. Anything it cannot read keeps the light fallback. */
export function readTokens(el: Element): MapTokens {
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: RGB): RGB => parseColor(cs.getPropertyValue(name)) ?? fallback;
  const categories: Record<string, RGB> = {};
  for (const id of CATEGORY_IDS) categories[id] = get(`--c-${id}`, FALLBACK.ink);
  const bg = get("--map-bg", FALLBACK.bg);
  return {
    bg,
    land: get("--map-land", FALLBACK.land),
    line: get("--map-line", FALLBACK.line),
    base: get("--map-base", FALLBACK.base),
    ink: get("--ink", FALLBACK.ink),
    heat: get("--heat", FALLBACK.heat),
    info: get("--info", FALLBACK.info),
    brands: {
      yourtal: get("--yt", FALLBACK.brands.yourtal),
      snapapp: get("--sa", FALLBACK.brands.snapapp),
      ftr: get("--ftr", FALLBACK.brands.ftr),
      all: get("--god", FALLBACK.brands.all),
    },
    categories,
    // A dark map background has low luminance.
    dark: 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] < 110,
  };
}
