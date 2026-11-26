export type FieldKey = "name" | "company" | "email" | "want";

export interface ContactInput {
  name: string;
  company: string;
  email: string;
  want: string;
  budget: string;
  /** Honeypot. People never see it, so it stays empty. The receiving end drops any enquiry that fills it. */
  website: string;
}

export interface Validation {
  ok: boolean;
  errors: Partial<Record<FieldKey, string>>;
  /** One line for the alert region, in the prototype's wording. */
  summary: string;
  /** The first field to send focus to, in page order. */
  first?: FieldKey;
}

const ORDER: FieldKey[] = ["name", "company", "email", "want"];

/** Used in "Please fill in name, company." */
const SUMMARY_LABEL: Record<FieldKey, string> = {
  name: "name",
  company: "company",
  email: "email",
  want: "what you want to know",
};

const REQUIRED_MESSAGE: Record<FieldKey, string> = {
  name: "Enter your name.",
  company: "Enter your company.",
  email: "Enter your email address.",
  want: "Tell us what you want to know.",
};

/**
 * The longest value the contact endpoint accepts for each field (it rejects anything longer). The form sets the
 * same numbers as maxlength, so a visitor can never type past them.
 */
export const FIELD_LIMITS = {
  name: 100,
  company: 120,
  email: 254,
  want: 4000,
  budget: 60,
} as const;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_INVALID_MESSAGE = "Enter a valid email address, such as name@example.com.";

export function validateContact(input: ContactInput): Validation {
  const errors: Partial<Record<FieldKey, string>> = {};
  const missing = ORDER.filter((k) => !input[k].trim());
  for (const k of missing) errors[k] = REQUIRED_MESSAGE[k];

  if (missing.length) {
    return {
      ok: false,
      errors,
      summary: `Please fill in ${missing.map((k) => SUMMARY_LABEL[k]).join(", ")}.`,
      first: missing[0],
    };
  }
  if (!EMAIL_PATTERN.test(input.email)) {
    errors.email = EMAIL_INVALID_MESSAGE;
    return { ok: false, errors, summary: "Please enter a valid email address.", first: "email" };
  }
  return { ok: true, errors, summary: "" };
}

export function buildPayload(input: ContactInput): ContactInput {
  return {
    name: input.name.trim(),
    company: input.company.trim(),
    email: input.email.trim(),
    want: input.want.trim(),
    budget: input.budget,
    website: input.website,
  };
}

export const MESSAGES = {
  notConfigured:
    "This form is not switched on yet, so nothing was sent. Please email hello@god.gaiada.com instead.",
  failed:
    "Something went wrong and your enquiry was not sent. Please try again, or email hello@god.gaiada.com.",
} as const;

export type SubmitOutcome = "sent" | "not-configured" | "failed";

/**
 * POST the enquiry as JSON. Only a 2xx response counts as sent. With no endpoint configured nothing is
 * sent and the caller must say so; it must never show the thanks state.
 */
export async function submitContact(
  endpoint: string,
  input: ContactInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitOutcome> {
  if (!endpoint) return "not-configured";
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(buildPayload(input)),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(15_000),
    });
    return res.status >= 200 && res.status < 300 ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
