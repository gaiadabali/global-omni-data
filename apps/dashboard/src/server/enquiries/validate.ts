import type { NewEnquiry } from "../store/types";

/**
 * The contact form's rules, on the server, where they are authoritative. The site's own checks (apps/site/src/lib/
 * contact.ts) are a courtesy to the visitor: name, company, email and message are required, and the email looks like
 * name@example.com. This adds what a public endpoint needs on top: a length limit on every field, no control
 * characters in a single-line field, and an email with nothing in it that could add a second address to a mail header.
 * The same limits are CHECKs on god_app.enquiries (migration 0004), so a value this lets through cannot be stored if
 * the two ever drift apart.
 */
export const LIMITS = { name: 100, company: 120, email: 254, want: 4000, budget: 60 } as const;

export type EnquiryField = "name" | "company" | "email" | "want";

/** What the site's validateContact says, so the visitor sees the same words wherever the check ran. */
const REQUIRED: Record<EnquiryField, string> = {
  name: "Enter your name.",
  company: "Enter your company.",
  email: "Enter your email address.",
  want: "Tell us what you want to know.",
};
const EMAIL_INVALID = "Enter a valid email address, such as name@example.com.";

/** The site's pattern (EMAIL_PATTERN in apps/site/src/lib/contact.ts). */
const SITE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Characters that let an address field carry a display name, a comment or a second address. Never in a real address. */
const EMAIL_FORBIDDEN = /[<>(),;:"[\]\\]/;
/** Every C0 control (CR, LF, tab and NUL among them), DEL, the C1 controls, and the Unicode line and paragraph separators. */
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
// eslint-disable-next-line no-control-regex
const CONTROL_RUNS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
/** Controls a message does not keep. Tab and line breaks are handled apart. */
// eslint-disable-next-line no-control-regex
const MESSAGE_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
/** A lone surrogate (only possible through a JSON escape such as "\ud800") would make Postgres refuse the row. */
const LONE_SURROGATE = /[\ud800-\udfff]/u;
const wellFormed = (s: string): boolean => !LONE_SURROGATE.test(s);

/** Length in characters as Postgres counts them (code points), not UTF-16 units. */
export function charLength(s: string): number {
  return [...s].length;
}

/** A single-line field: every run of control characters (CR, LF, tab, NUL ...) becomes one space, then trimmed. */
export function cleanLine(s: string): string {
  return s.replace(CONTROL_RUNS, " ").trim();
}

/** The message: CRLF, CR and the Unicode separators become LF, tabs become spaces, other control characters go. */
export function cleanMessage(s: string): string {
  return s
    .replace(/\r\n?|\u2028|\u2029|\u0085/g, "\n")
    .replace(/\t/g, " ")
    .replace(MESSAGE_CONTROLS, "")
    .trim();
}

export type Validated =
  | { ok: true; value: Omit<NewEnquiry, "ipPrefix"> }
  | { ok: false; errors: Partial<Record<EnquiryField | "budget", string>> };

/**
 * Validates and cleans a parsed JSON body (not yet trusted: any field may be missing or not a string). The honeypot
 * (`website`) is handled by the caller before this. A field that is not a string counts as missing.
 */
export function validateEnquiry(body: Record<string, unknown>): Validated {
  const text = (k: string): string => (typeof body[k] === "string" ? (body[k] as string) : "");
  const errors: Partial<Record<EnquiryField | "budget", string>> = {};

  const name = wellFormed(text("name")) ? cleanLine(text("name")) : "";
  const company = wellFormed(text("company")) ? cleanLine(text("company")) : "";
  const want = wellFormed(text("want")) ? cleanMessage(text("want")) : "";
  const budget = wellFormed(text("budget")) ? cleanLine(text("budget")) : "";
  // The email is NOT cleaned: a control character or a space in it makes it invalid, it is not quietly repaired.
  const emailRaw = text("email").trim();

  if (!name) errors.name = REQUIRED.name;
  else if (charLength(name) > LIMITS.name) errors.name = `Keep your name to ${LIMITS.name} characters or fewer.`;

  if (!company) errors.company = REQUIRED.company;
  else if (charLength(company) > LIMITS.company)
    errors.company = `Keep your company name to ${LIMITS.company} characters or fewer.`;

  if (!emailRaw) errors.email = REQUIRED.email;
  else if (
    !wellFormed(emailRaw) ||
    charLength(emailRaw) > LIMITS.email ||
    CONTROLS.test(emailRaw) ||
    EMAIL_FORBIDDEN.test(emailRaw) ||
    !SITE_EMAIL.test(emailRaw)
  )
    errors.email = EMAIL_INVALID;

  if (!want) errors.want = REQUIRED.want;
  else if (charLength(want) > LIMITS.want) errors.want = `Keep your message to ${LIMITS.want} characters or fewer.`;

  if (charLength(budget) > LIMITS.budget) errors.budget = "That budget range is not one we offer.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, company, email: emailRaw, want, budget } };
}
