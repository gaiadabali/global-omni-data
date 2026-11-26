/** Why someone opens a Person 360 profile. A category is required, and so is a line of free text. */
export const OPEN_REASONS = [
  { id: "sync-or-merge", label: "Check a sync or merge problem" },
  { id: "geocoding", label: "Confirm a geocoding result" },
  { id: "brand-support", label: "Support request from a brand team" },
  { id: "interest-check", label: "Verify an inferred interest" },
  { id: "other", label: "Other (explain below)" },
] as const;
export type OpenReasonId = (typeof OPEN_REASONS)[number]["id"];

export const MIN_NOTE_LENGTH = 8;
export const MAX_NOTE_LENGTH = 400;

export function isReasonId(v: string): v is OpenReasonId {
  return OPEN_REASONS.some((r) => r.id === v);
}

export type ReasonResult = { ok: true; reason: string } | { ok: false; error: string };

/** "Category label: what they are checking". Refuses an unknown category or a note that is too short or long. */
export function buildReason(reasonId: string, note: string): ReasonResult {
  const found = OPEN_REASONS.find((r) => r.id === reasonId);
  if (!found) return { ok: false, error: "Choose a reason." };
  const text = note.trim();
  if (text.length < MIN_NOTE_LENGTH) return { ok: false, error: "Write at least a short line about what you are checking." };
  if (text.length > MAX_NOTE_LENGTH) return { ok: false, error: `Keep the details under ${MAX_NOTE_LENGTH} characters.` };
  return { ok: true, reason: `${found.label}: ${text}` };
}
