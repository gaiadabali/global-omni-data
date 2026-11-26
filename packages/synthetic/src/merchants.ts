import { CITIES, nearestPlace, stateAt } from "./geo";
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
  cityIndex: number;
  /** Receipts a month at the current month, all ages. */
  base: number;
}

const AGE_ALL = [0.06, 0.2, 0.27, 0.19, 0.12, 0.09, 0.07];
const CATEGORY_WEIGHT = [4, 6, 7, 6, 3, 3];
const SIZE_BY_CATEGORY = [300, 500, 175, 235, 125, 85];

const cache = new Map<number, readonly Merchant[]>();

export function generateMerchants(seed = 77, count = 3400): readonly Merchant[] {
  const key = seed * 100000 + count;
  const hit = cache.get(key);
  if (hit) return hit;
  const rnd = mulberry32(seed);
  const cityCum = cumulative(CITIES.map((c) => c.popK * (c.kind === "town" ? 1.4 : 1)));
  const catCum = cumulative(CATEGORY_WEIGHT);
  const out: Merchant[] = [];
  for (let i = 0; i < count; i++) {
    const ci = pickCum(cityCum, rnd());
    const c = CITIES[ci]!;
    const cos = Math.cos((c.lat * Math.PI) / 180);
    let lat = c.lat;
    let lon = c.lon;
    let st = c.state;
    for (let t = 0; t < 12; t++) {
      const la = c.lat + (gaussian(rnd) * c.spreadKm * 0.75) / 110.57;
      const lo = c.lon + (gaussian(rnd) * c.spreadKm * 0.75) / (111.32 * cos);
      const s = stateAt(la, lo);
      if (s >= 0) {
        lat = la;
        lon = lo;
        st = s;
        break;
      }
    }
    const cat = pickCum(catCum, rnd());
    const chains = CHAINS[CATEGORIES[cat]!.id]!;
    const chain = chains[Math.floor(rnd() * chains.length)]!;
    const near = nearestPlace(lat, lon);
    const base = Math.max(
      14,
      Math.round(SIZE_BY_CATEGORY[cat]! * Math.exp((rnd() - 0.5) * 1.6) * (c.kind === "town" ? 0.5 : 1)),
    );
    out.push({
      id: `M-${String(i + 1).padStart(4, "0")}`,
      name: `${chain} ${near.name}`,
      chain,
      category: cat,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      state: st,
      cityIndex: ci,
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
