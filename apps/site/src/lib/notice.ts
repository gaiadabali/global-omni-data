import { CONTACT_EMAIL } from "./site";

/**
 * The GOD Group Privacy Notice's facts, in one place. `entity`, `abn` and `privacyEmail` are still to be
 * confirmed (2026-11-27). While they are null the page falls back to wording that needs no placeholder, and
 * the page never shows a square bracket. Fill them in here and nowhere else.
 */
export const NOTICE: {
  version: string;
  effective: string;
  entity: string | null;
  abn: string | null;
  privacyEmail: string | null;
  deletionWindow: string;
} = {
  version: "1.1",
  effective: "2026-11-27",
  // MOCK (founder, 2026-11-27): replace with the registered entity name and its ABN before launch.
  // The ABN stays null on purpose: an invented ABN could belong to a real business.
  entity: "Global Omni Data Pty Ltd",
  abn: null,
  privacyEmail: "hello@god.gaiada.com", // founder, 2026-11-27
  deletionWindow: "1 hour",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function effectiveLabel(iso: string = NOTICE.effective): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** The legal name of the group as one sentence fragment, with no placeholder when the entity is not set. */
export function groupLabel(n = NOTICE): string {
  const base = "the GOD group (Global Omni Data)";
  if (!n.entity) return base;
  return n.abn ? `${base}, ${n.entity}, ABN ${n.abn}` : `${base}, ${n.entity}`;
}

export function privacyEmail(n = NOTICE): string {
  return n.privacyEmail ?? CONTACT_EMAIL;
}
