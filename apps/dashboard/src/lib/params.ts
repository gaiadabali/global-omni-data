/** The first value of a search parameter (Next gives a string, an array when repeated, or undefined). */
export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
