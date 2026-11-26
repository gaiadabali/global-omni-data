import { CAPITALS } from "./states";

/** The N largest values among the items that pass `visible`. Ties go in name order, so the list does not shuffle. */
export function topBy<T>(
  items: readonly T[],
  value: (t: T) => number,
  name: (t: T) => string,
  visible: (t: T) => boolean,
  n = 10,
): T[] {
  const shown = items.filter(visible);
  shown.sort((a, b) => value(b) - value(a) || name(a).localeCompare(name(b), "en-AU"));
  return shown.slice(0, n);
}

/** Great-circle distance in kilometres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/** The state capital within 150 km, if there is one. */
export function nearCapital(lat: number, lon: number): string | null {
  let best: { name: string; km: number } | null = null;
  for (const c of CAPITALS) {
    const km = distanceKm(lat, lon, c.position[1], c.position[0]);
    if (km <= 150 && (!best || km < best.km)) best = { name: c.name, km };
  }
  return best ? best.name : null;
}

/**
 * A name for an area the API did not label (it labels only when 400 or fewer cells match): the capital it is near,
 * and its coordinates, such as "Sydney area, 33.91S 151.21E". Two decimals is about a kilometre, so the areas in a
 * list read differently from each other.
 */
export function coordName(lat: number, lon: number): string {
  const coords = `${Math.abs(lat).toFixed(2)}${lat < 0 ? "S" : "N"} ${Math.abs(lon).toFixed(2)}${lon < 0 ? "W" : "E"}`;
  const near = nearCapital(lat, lon);
  return near ? `${near} area, ${coords}` : `Area at ${coords}`;
}
