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

/** "Area near 33.9 S, 151.2 E": the name for an area the API did not label. */
export function coordName(lat: number, lon: number): string {
  const ns = lat < 0 ? "S" : "N";
  const ew = lon < 0 ? "W" : "E";
  return `Area near ${Math.abs(lat).toFixed(1)} ${ns}, ${Math.abs(lon).toFixed(1)} ${ew}`;
}
