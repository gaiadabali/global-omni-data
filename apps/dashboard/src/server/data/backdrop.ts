import { CITIES, cumulative, gaussian, mulberry32, pickCum, stateAt } from "@god/synthetic";

/**
 * Decorative dots for the sign-in screen: where Australians live, drawn from the city model. Always synthetic, by
 * design and whatever provider is selected: it is a picture, not data, and it never touches the warehouse.
 */
export interface BackdropDot {
  x: number;
  y: number;
  r: number;
  o: number;
}

export const BACKDROP_SIZE = { w: 900, h: 860 } as const;

const LON0 = 112.5;
const LON1 = 154;
const LAT_TOP = -9.5;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const K = (BACKDROP_SIZE.w - 20) / (((LON1 - LON0) * Math.PI) / 180);

let cache: BackdropDot[] | null = null;

export function backdropDots(n = 2200): BackdropDot[] {
  if (cache && cache.length === n) return cache;
  const rnd = mulberry32(3);
  // Weight by population to the power 0.6, so the towns show as well as the capitals.
  const cum = cumulative(CITIES.map((c) => Math.pow(c.popK, 0.6)));
  const dots: BackdropDot[] = [];
  const place = (lat: number, lon: number) => {
    dots.push({
      x: Math.round((10 + ((lon - LON0) * Math.PI * K) / 180) * 10) / 10,
      y: Math.round((10 + (merc(LAT_TOP) - merc(lat)) * K) * 10) / 10,
      r: Math.round((1 + rnd() * 1.4) * 10) / 10,
      o: Math.round((0.15 + rnd() * 0.5) * 100) / 100,
    });
  };
  while (dots.length < n) {
    if (rnd() < 0.2) {
      // A thin spread over the land, so the shape of the country reads.
      const lat = -10.8 - rnd() * 33;
      const lon = 113.2 + rnd() * 40.5;
      if (stateAt(lat, lon) >= 0) place(lat, lon);
      continue;
    }
    const c = CITIES[pickCum(cum, rnd())]!;
    const spread = c.spreadKm * 1.6;
    const lat = c.lat + (gaussian(rnd) * spread) / 110.57;
    const lon = c.lon + (gaussian(rnd) * spread) / (111.32 * Math.cos((c.lat * Math.PI) / 180));
    if (stateAt(lat, lon) >= 0) place(lat, lon);
  }
  cache = dots;
  return dots;
}
