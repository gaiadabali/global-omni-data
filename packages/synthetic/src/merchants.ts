import { getArea, isOtherTerritory, sa2IndexAt, suburbs, type Suburb } from "@god/geo";
import { STATE_CODES } from "./geo";
import { CATEGORIES, CATEGORY_BY_AGE, TEEN_BAND } from "./world";
import { gaussian, mulberry32, cumulative, pickCum } from "./rng";

/** Fictional chains. Merchants are businesses, so their shop locations are exact. */
export const CHAINS: Record<string, readonly string[]> = {
  fuel: ["Southern Cross Fuel", "Pacific Petroleum", "Ironbark Fuel", "Wattle Energy"],
  groc: ["Coastline Grocers", "FreshMart Co-op", "Bluegum Foods"],
  cafe: ["Harbour & Bean", "Laneway Roasters", "Brew Society"],
  retail: ["Kestrel Home", "Outback Outfitters", "Tidewater Fashion"],
  pharm: ["Wattle Pharmacy", "Care Corner Pharmacy"],
  ent: ["Kidzone Play", "Jumpworks Arena", "Starlight Cinemas"],
};

export interface Merchant {
  id: string;
  name: string;
  chain: string;
  /** Index into CATEGORIES. */
  category: number;
  lat: number;
  lon: number;
  state: number;
  /** The real suburb (ABS locality) the shop sits in, and its code. The chain is fictional; the suburb is not. */
  suburb: string;
  suburbCode: string;
  /** The ABS SA2 code the shop is in. */
  sa2: string;
  /** Receipts a month at the current month, all ages. */
  base: number;
}

const AGE_ALL = [0.06, 0.2, 0.27, 0.19, 0.12, 0.09, 0.07];
const CATEGORY_WEIGHT = [4, 6, 7, 6, 3, 3];
const SIZE_BY_CATEGORY = [300, 500, 175, 235, 125, 85];

const cache = new Map<number, readonly Merchant[]>();

/**
 * Suburbs that can hold a shop, weighted by the residents of their SA2 (shared among the SA2's suburbs, with towns
 * a little over-weighted so the country has shops too). Computed once.
 */
let pool: { list: Suburb[]; cum: number[]; popOf: Map<string, number> } | null = null;
function suburbPool() {
  if (pool) return pool;
  const all = suburbs().filter((s) => {
    const sa2 = getArea("sa2", s.sa2);
    return sa2 !== undefined && !isOtherTerritory(sa2) && sa2.population > 0;
  });
  const perSa2 = new Map<string, number>();
  for (const s of all) perSa2.set(s.sa2, (perSa2.get(s.sa2) ?? 0) + 1);
  const popOf = new Map<string, number>();
  const weights = all.map((s) => {
    const pop = getArea("sa2", s.sa2)!.population;
    popOf.set(s.sa2, pop);
    return Math.pow(pop, 0.9) / perSa2.get(s.sa2)!;
  });
  pool = { list: all, cum: cumulative(weights), popOf };
  return pool;
}

export function generateMerchants(seed = 77, count = 3400): readonly Merchant[] {
  const key = seed * 100000 + count;
  const hit = cache.get(key);
  if (hit) return hit;
  const rnd = mulberry32(seed);
  const { list, cum, popOf } = suburbPool();
  const catCum = cumulative(CATEGORY_WEIGHT);
  const out: Merchant[] = [];
  for (let i = 0; i < count; i++) {
    const sub = list[pickCum(cum, rnd())]!;
    // Near the suburb's middle: a small spread (at most about a kilometre), kept inside the suburb's SA2.
    const spread = Math.min(1.2, 0.3 * Math.sqrt(sub.areaKm2));
    const la = sub.lat + (gaussian(rnd) * spread) / 110.57;
    const lo = sub.lon + (gaussian(rnd) * spread) / (111.32 * Math.cos((sub.lat * Math.PI) / 180));
    const moved = sa2IndexAt(lo, la) === (getArea("sa2", sub.sa2)?.index ?? -1);
    const lat = moved ? la : sub.lat;
    const lon = moved ? lo : sub.lon;
    const cat = pickCum(catCum, rnd());
    const chains = CHAINS[CATEGORIES[cat]!.id]!;
    const chain = chains[Math.floor(rnd() * chains.length)]!;
    const town = (popOf.get(sub.sa2) ?? 0) < 12_000;
    const base = Math.max(14, Math.round(SIZE_BY_CATEGORY[cat]! * Math.exp((rnd() - 0.5) * 1.6) * (town ? 0.5 : 1)));
    out.push({
      id: `M-${String(i + 1).padStart(4, "0")}`,
      name: `${chain} ${sub.name}`,
      chain,
      category: cat,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      state: STATE_CODES.indexOf(sub.state as (typeof STATE_CODES)[number]),
      suburb: sub.name,
      suburbCode: sub.code,
      sa2: sub.sa2,
      base,
    });
  }
  cache.set(key, out);
  return out;
}

/** Share of a category's receipts that come from one age band (1 when no band is given). */
export function ageShare(category: number, ageBand: number | undefined): number {
  if (ageBand === undefined) return 1;
  let total = 0;
  for (let a = 0; a < AGE_ALL.length; a++) total += AGE_ALL[a]! * CATEGORY_BY_AGE[a]![category]!;
  const mine = AGE_ALL[ageBand]! * CATEGORY_BY_AGE[ageBand]![category]!;
  return total > 0 ? mine / total : 0;
}

export interface ReceiptOptions {
  /** Month factor, 0..1: receipts that month relative to the current month. */
  factor: number;
  ageBand?: number;
  /** Share of the audience to keep (for example, one brand's people only). */
  audienceShare?: number;
}

/** Receipts a merchant had in a month. Teens never have sensitive-category receipts. */
export function merchantReceipts(m: Merchant, o: ReceiptOptions): number {
  if (o.ageBand === TEEN_BAND && CATEGORIES[m.category]!.sensitive) return 0;
  return Math.round(m.base * o.factor * ageShare(m.category, o.ageBand) * (o.audienceShare ?? 1));
}
