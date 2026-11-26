import { geoBounds, geoContains } from "d3-geo";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { nearestSuburb, placeAt } from "@god/geo";
import statesJson from "./data/au-states.json";

/** State order is fixed: index 0..7 is used as a key everywhere. */
export const STATE_CODES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;
export type StateCode = (typeof STATE_CODES)[number];
export const STATE_NAMES = [
  "New South Wales",
  "Victoria",
  "Queensland",
  "Western Australia",
  "South Australia",
  "Tasmania",
  "Australian Capital Territory",
  "Northern Territory",
] as const;
/** Residents, in thousands, rounded. Used for per-1,000 rates. */
export const STATE_POP_K = [8480, 7020, 5600, 2950, 1850, 575, 470, 255] as const;

/** Affinity of a place for [YourTal, SnapApp, FTR]: how much more (or less) than its size it signs up. */
export type Affinity = readonly [number, number, number];

export interface City {
  index: number;
  name: string;
  state: number;
  lon: number;
  lat: number;
  /** Residents in thousands. */
  popK: number;
  /** Spread of the built-up area, km (one standard deviation). */
  spreadKm: number;
  affinity: Affinity;
  kind: "capital" | "city" | "town";
}

type Row = [string, number, number, number, number, number, Affinity?];
const DEFAULT_AFFINITY: Affinity = [0.9, 0.6, 1.3];

/* name, state, lon, lat, residents (thousand), spread km, affinity. Approximate, for a synthetic map only. */
const ROWS: Row[] = [
  ["Sydney", 0, 151.21, -33.87, 5400, 20, [1, 1.25, 0.9]],
  ["Melbourne", 1, 144.96, -37.81, 5300, 20, [0.9, 1.3, 0.95]],
  ["Brisbane", 2, 153.03, -27.47, 2700, 16, [1.5, 0.9, 1]],
  ["Perth", 3, 115.86, -31.95, 2300, 18, [1.1, 1.2, 0.95]],
  ["Adelaide", 4, 138.6, -34.93, 1450, 14, [1, 0.9, 1.1]],
  ["Gold Coast", 2, 153.43, -28.02, 700, 10, [1.7, 0.9, 1]],
  ["Newcastle", 0, 151.78, -32.93, 500, 9, [0.9, 0.8, 1.5]],
  ["Canberra", 6, 149.13, -35.28, 470, 8, [0.9, 1.4, 1.1]],
  ["Sunshine Coast", 2, 153.1, -26.65, 380, 9, [1.5, 0.8, 1]],
  ["Wollongong", 0, 150.89, -34.43, 310, 7, [0.9, 0.8, 1.5]],
  ["Geelong", 1, 144.36, -38.15, 290, 7, [0.9, 0.9, 1.3]],
  ["Hobart", 5, 147.33, -42.88, 250, 7, [1, 0.9, 1.2]],
  ["Townsville", 2, 146.82, -19.26, 195, 6, [1.2, 0.7, 1.4]],
  ["Cairns", 2, 145.77, -16.92, 160, 6, [1.3, 0.7, 1.3]],
  ["Darwin", 7, 130.84, -12.46, 150, 6, [1, 0.9, 1.2]],
  ["Toowoomba", 2, 151.95, -27.56, 140, 5, [1.1, 0.7, 1.4]],
  ["Ballarat", 1, 143.85, -37.56, 120, 5, [0.8, 0.7, 1.4]],
  ["Bendigo", 1, 144.28, -36.76, 105, 5, [0.8, 0.7, 1.4]],
  ["Albury", 0, 146.92, -36.08, 100, 5, [0.8, 0.6, 1.5]],
  ["Launceston", 5, 147.14, -41.44, 90, 5, [0.9, 0.8, 1.2]],
  ["Mackay", 2, 149.19, -21.14, 80, 5, [1.1, 0.6, 1.6]],
  ["Rockhampton", 2, 150.51, -23.38, 80, 5, [1.1, 0.6, 1.6]],
  ["Bunbury", 3, 115.64, -33.33, 75, 5, [1, 0.7, 1.4]],
  ["Alice Springs", 7, 133.88, -23.7, 26, 3, [0.8, 0.5, 1.3]],
  ["Kalgoorlie", 3, 121.47, -30.75, 30, 3, [0.8, 0.5, 1.3]],
  ["Mount Isa", 2, 139.49, -20.73, 18, 3, [0.8, 0.5, 1.3]],
  ["Broome", 3, 122.24, -17.96, 14, 3, [0.8, 0.5, 1.1]],
  ["Geraldton", 3, 114.61, -28.78, 40, 3, [0.9, 0.6, 1.2]],
  ["Albany", 3, 117.88, -35.02, 38, 3, [0.9, 0.6, 1.2]],
  ["Wagga Wagga", 0, 147.37, -35.12, 57, 4, [0.8, 0.6, 1.4]],
  ["Dubbo", 0, 148.6, -32.25, 43, 3, [0.8, 0.6, 1.4]],
  ["Tamworth", 0, 150.93, -31.09, 43, 3, [0.8, 0.6, 1.4]],
  ["Coffs Harbour", 0, 153.11, -30.3, 75, 4, [1, 0.7, 1.3]],
  ["Port Macquarie", 0, 152.91, -31.43, 50, 3, [1, 0.7, 1.3]],
  ["Mildura", 1, 142.16, -34.19, 36, 3, [0.8, 0.6, 1.3]],
  ["Shepparton", 1, 145.4, -36.38, 52, 3, [0.8, 0.6, 1.3]],
  ["Warrnambool", 1, 142.48, -38.38, 35, 3, [0.8, 0.6, 1.2]],
  ["Mount Gambier", 4, 140.78, -37.83, 28, 3, [0.8, 0.6, 1.2]],
  ["Whyalla", 4, 137.58, -33.03, 21, 3, [0.8, 0.6, 1.3]],
  ["Devonport", 5, 146.35, -41.18, 26, 3, [0.9, 0.6, 1.2]],
  ["Bundaberg", 2, 152.35, -24.87, 72, 4, [1.1, 0.6, 1.5]],
  ["Hervey Bay", 2, 152.84, -25.29, 55, 4, [1.2, 0.6, 1.4]],
  ["Gladstone", 2, 151.26, -23.84, 48, 3, [1.1, 0.6, 1.5]],
  ["Katherine", 7, 132.26, -14.46, 11, 2, [0.8, 0.5, 1.1]],
  ["Emerald", 2, 148.17, -23.52, 15, 3, [0.9, 0.5, 1.3]],
  ["Orange", 0, 149.1, -33.28, 40, 3],
  ["Bathurst", 0, 149.58, -33.42, 43, 3],
  ["Lismore", 0, 153.28, -28.81, 29, 3],
  ["Armidale", 0, 151.67, -30.51, 25, 3],
  ["Goulburn", 0, 149.72, -34.75, 23, 2],
  ["Nowra", 0, 150.6, -34.88, 35, 3],
  ["Grafton", 0, 152.93, -29.69, 19, 2],
  ["Taree", 0, 152.46, -31.91, 26, 2],
  ["Broken Hill", 0, 141.47, -31.96, 17, 2],
  ["Queanbeyan", 0, 149.23, -35.35, 40, 3, [0.9, 1.1, 1.2]],
  ["Tweed Heads", 0, 153.54, -28.18, 65, 4, [1.5, 0.8, 1.1]],
  ["Ballina", 0, 153.55, -28.87, 17, 2],
  ["Byron Bay", 0, 153.61, -28.64, 10, 2, [1.3, 0.9, 0.9]],
  ["Muswellbrook", 0, 150.89, -32.26, 16, 2],
  ["Singleton", 0, 151.17, -32.57, 17, 2],
  ["Moree", 0, 149.84, -29.46, 9, 2],
  ["Griffith", 0, 146.04, -34.29, 27, 3],
  ["Cessnock", 0, 151.36, -32.83, 26, 3],
  ["Traralgon", 1, 146.54, -38.2, 26, 3],
  ["Wodonga", 1, 146.89, -36.12, 40, 3],
  ["Horsham", 1, 142.2, -36.71, 17, 2],
  ["Swan Hill", 1, 143.56, -35.34, 11, 2],
  ["Wangaratta", 1, 146.32, -36.36, 19, 2],
  ["Bairnsdale", 1, 147.61, -37.83, 15, 2],
  ["Sale", 1, 147.07, -38.11, 14, 2],
  ["Warragul", 1, 145.93, -38.16, 17, 2],
  ["Echuca", 1, 144.75, -36.14, 15, 2],
  ["Colac", 1, 143.59, -38.34, 12, 2],
  ["Portland", 1, 141.6, -38.34, 10, 2],
  ["Maryborough", 2, 152.7, -25.54, 28, 3],
  ["Gympie", 2, 152.67, -26.19, 21, 2],
  ["Charters Towers", 2, 146.26, -20.08, 9, 2],
  ["Roma", 2, 148.79, -26.57, 7, 2],
  ["Warwick", 2, 152.03, -28.22, 16, 2],
  ["Kingaroy", 2, 151.84, -26.54, 11, 2],
  ["Innisfail", 2, 146.03, -17.52, 8, 2],
  ["Longreach", 2, 144.25, -23.44, 3, 1.5],
  ["Port Douglas", 2, 145.46, -16.48, 3, 1.5],
  ["Biloela", 2, 150.51, -24.4, 6, 2],
  ["Dalby", 2, 151.26, -27.18, 12, 2],
  ["Ayr", 2, 147.4, -19.58, 9, 2],
  ["Karratha", 3, 116.85, -20.74, 22, 3],
  ["Port Hedland", 3, 118.6, -20.31, 16, 2],
  ["Esperance", 3, 121.89, -33.86, 14, 2],
  ["Busselton", 3, 115.35, -33.65, 38, 3],
  ["Northam", 3, 116.67, -31.65, 12, 2],
  ["Carnarvon", 3, 113.66, -24.88, 5, 2],
  ["Kununurra", 3, 128.74, -15.77, 7, 2],
  ["Mandurah", 3, 115.72, -32.53, 95, 5],
  ["Newman", 3, 119.93, -23.36, 5, 1.5],
  ["Port Augusta", 4, 137.77, -32.49, 13, 2],
  ["Port Pirie", 4, 138.02, -33.19, 14, 2],
  ["Murray Bridge", 4, 139.27, -35.12, 19, 2],
  ["Victor Harbor", 4, 138.62, -35.55, 15, 2],
  ["Port Lincoln", 4, 135.86, -34.73, 15, 2],
  ["Coober Pedy", 4, 134.75, -29.01, 2, 1],
  ["Burnie", 5, 145.91, -41.05, 20, 2],
  ["Kingston", 5, 147.31, -42.98, 15, 2],
  ["Nhulunbuy", 7, 136.78, -12.18, 4, 1.5],
  ["Tennant Creek", 7, 134.19, -19.65, 3, 1.5],
];

const CAPITAL_NAMES = new Set([
  "Sydney",
  "Melbourne",
  "Brisbane",
  "Perth",
  "Adelaide",
  "Hobart",
  "Darwin",
  "Canberra",
]);

export const CITIES: readonly City[] = ROWS.map((r, index) => ({
  index,
  name: r[0],
  state: r[1],
  lon: r[2],
  lat: r[3],
  popK: r[4],
  spreadKm: r[5],
  affinity: r[6] ?? DEFAULT_AFFINITY,
  kind: CAPITAL_NAMES.has(r[0]) ? "capital" : r[4] >= 70 ? "city" : "town",
}));

/* name, postcode, lon, lat */
export const SUBURBS: readonly (readonly [string, string, number, number])[] = [
  ["Parramatta", "2150", 151.0, -33.82],
  ["Bondi", "2026", 151.27, -33.89],
  ["Chatswood", "2067", 151.18, -33.8],
  ["Penrith", "2750", 150.69, -33.75],
  ["Liverpool", "2170", 150.92, -33.92],
  ["Manly", "2095", 151.29, -33.8],
  ["Blacktown", "2148", 150.91, -33.77],
  ["Sutherland", "2232", 151.05, -34.03],
  ["Hornsby", "2077", 151.1, -33.7],
  ["Newtown", "2042", 151.18, -33.9],
  ["Footscray", "3011", 144.9, -37.8],
  ["Richmond", "3121", 144.99, -37.82],
  ["St Kilda", "3182", 144.98, -37.87],
  ["Dandenong", "3175", 145.21, -37.99],
  ["Box Hill", "3128", 145.12, -37.82],
  ["Sunshine", "3020", 144.83, -37.79],
  ["Preston", "3072", 145.0, -37.74],
  ["Frankston", "3199", 145.13, -38.14],
  ["Brunswick", "3056", 144.96, -37.77],
  ["Chermside", "4032", 153.03, -27.39],
  ["South Brisbane", "4101", 153.02, -27.48],
  ["Indooroopilly", "4068", 152.97, -27.5],
  ["Carindale", "4152", 153.1, -27.5],
  ["Sunnybank", "4109", 153.06, -27.58],
  ["Fortitude Valley", "4006", 153.04, -27.46],
  ["Redcliffe", "4020", 153.11, -27.23],
  ["Ipswich", "4305", 152.76, -27.62],
  ["Logan Central", "4114", 153.11, -27.64],
  ["Surfers Paradise", "4217", 153.43, -28.0],
  ["Southport", "4215", 153.41, -27.97],
  ["Robina", "4226", 153.38, -28.07],
  ["Burleigh Heads", "4220", 153.45, -28.09],
  ["Coomera", "4209", 153.33, -27.86],
  ["Fremantle", "6160", 115.75, -32.06],
  ["Joondalup", "6027", 115.77, -31.75],
  ["Subiaco", "6008", 115.82, -31.95],
  ["Rockingham", "6168", 115.73, -32.28],
  ["Midland", "6056", 116.01, -31.89],
  ["Cannington", "6107", 115.94, -32.02],
  ["Glenelg", "5045", 138.52, -34.98],
  ["Norwood", "5067", 138.63, -34.92],
  ["Salisbury", "5108", 138.64, -34.76],
  ["Marion", "5043", 138.56, -35.01],
  ["Port Adelaide", "5015", 138.5, -34.85],
  ["Maroochydore", "4558", 153.1, -26.65],
  ["Caloundra", "4551", 153.13, -26.8],
  ["Noosa Heads", "4567", 153.09, -26.4],
  ["Hamilton", "2303", 151.74, -32.92],
  ["Charlestown", "2290", 151.69, -32.96],
  ["Belconnen", "2617", 149.07, -35.24],
  ["Woden", "2606", 149.09, -35.35],
  ["Gungahlin", "2912", 149.13, -35.18],
  ["Sandy Bay", "7005", 147.33, -42.9],
  ["Glenorchy", "7010", 147.28, -42.83],
  ["Geelong West", "3218", 144.35, -38.14],
  ["Palmerston", "0830", 130.98, -12.48],
  ["Casuarina", "0810", 130.87, -12.37],
  ["Smithfield", "4878", 145.69, -16.82],
  ["Kirwan", "4817", 146.73, -19.31],
];

/* ---------------- states, by d3-geo geoContains, once per grid cell ---------------- */

type StateFeature = Feature<Polygon | MultiPolygon, { name: string; code: string }>;
const fc = statesJson as unknown as FeatureCollection<
  Polygon | MultiPolygon,
  { name: string; code: string }
>;

interface StateShape {
  state: number;
  feature: StateFeature;
  w: number;
  s: number;
  e: number;
  n: number;
}

let shapes: StateShape[] | null = null;
function getShapes(): StateShape[] {
  if (shapes) return shapes;
  const out: StateShape[] = [];
  for (const feature of fc.features) {
    const name = feature.properties.name;
    // Jervis Bay Territory is administered from the ACT for this purpose.
    const state =
      name === "Jervis Bay Territory" ? 6 : (STATE_NAMES as readonly string[]).indexOf(name);
    if (state < 0) continue;
    const [[w, s], [e, n]] = geoBounds(feature);
    out.push({ state, feature, w, s, e, n });
  }
  shapes = out;
  return out;
}

const GRID = 50; // cells per degree: 0.02 degrees, about 2 km
const stateCache = new Map<number, number>();

/** State index for a point, or -1 for open water. Evaluated at the centre of a 0.02-degree cell, memoised. */
export function stateAt(lat: number, lon: number): number {
  const gx = Math.round(lon * GRID);
  const gy = Math.round(lat * GRID);
  const key = gx * 100003 + gy;
  const hit = stateCache.get(key);
  if (hit !== undefined) return hit;
  const clon = gx / GRID;
  const clat = gy / GRID;
  let found = -1;
  for (const sh of getShapes()) {
    if (clon < sh.w || clon > sh.e || clat < sh.s || clat > sh.n) continue;
    if (geoContains(sh.feature, [clon, clat])) {
      found = sh.state;
      break;
    }
  }
  stateCache.set(key, found);
  return found;
}

/* ---------------- population ---------------- */

const KM_LAT = 110.57;
const KM_LON_EQ = 111.32;
const RURAL_DENSITY = 0.12; // people per km2 outside the cities

/** Residents per km2 at a point: the sum of the city gaussians plus a thin rural background. */
export function populationDensity(lat: number, lon: number): number {
  let d = RURAL_DENSITY;
  for (const c of CITIES) {
    const dy = (lat - c.lat) * KM_LAT;
    if (Math.abs(dy) > 5 * c.spreadKm) continue;
    const dx = (lon - c.lon) * KM_LON_EQ * Math.cos((c.lat * Math.PI) / 180);
    const d2 = dx * dx + dy * dy;
    const s2 = c.spreadKm * c.spreadKm;
    if (d2 > 25 * s2) continue;
    d += (c.popK * 1000 * Math.exp(-d2 / (2 * s2))) / (2 * Math.PI * s2);
  }
  return d;
}

export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dy = (lat2 - lat1) * KM_LAT;
  const dx = (lon2 - lon1) * KM_LON_EQ * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

export interface NearestPlace {
  name: string;
  km: number;
  suburb: boolean;
  /** State index of the place (0..7, as in STATE_CODES), or -1 when it is not known. */
  state: number;
}

/** The real suburb (ABS locality) nearest a point, within 80 km; else the nearest modelled city. */
export function nearestPlace(lat: number, lon: number): NearestPlace {
  const near = nearestSuburb(lon, lat);
  if (near) {
    const st = (STATE_CODES as readonly string[]).indexOf(near.suburb.state);
    return { name: near.suburb.name, km: near.distanceKm, suburb: true, state: st };
  }
  let best: NearestPlace = { name: "", km: Infinity, suburb: false, state: -1 };
  for (const c of CITIES) {
    const km = kmBetween(lat, lon, c.lat, c.lon);
    if (km < best.km) best = { name: c.name, km, suburb: false, state: c.state };
  }
  return best;
}

/** A readable label for a place, such as "Around Parramatta, NSW": a real suburb name from the ABS. */
export function placeName(lat: number, lon: number): string {
  const place = placeAt(lon, lat);
  const state = place.sa2?.state ?? place.suburb?.state ?? "";
  const code = state && state !== "OT" ? state : "";
  const p = nearestPlace(lat, lon);
  if (place.suburb && p.km < 12) return `Around ${place.name}${code ? `, ${code}` : ""}`;
  return `Remote area${code ? ` in ${code}` : ""}${p.name ? `, near ${p.name}` : ""}`;
}
