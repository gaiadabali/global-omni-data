/**
 * What was typed into the Person 360 search box. Only a GOD id (or the start of one) is searchable: GOD holds no
 * names, emails or phone numbers, so a query that looks like one is turned away with a plain explanation.
 */
export type PersonQueryKind = "empty" | "id" | "not-an-id";

export function classifyPersonQuery(q: string): PersonQueryKind {
  const t = q.trim();
  if (!t) return "empty";
  if (/[@\s]/.test(t)) return "not-an-id";
  if (/^\+?\d[\d-]{5,}$/.test(t)) return "not-an-id";
  return "id";
}
