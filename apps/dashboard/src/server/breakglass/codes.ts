import { createHash, randomBytes } from "node:crypto";

/**
 * Enrolment codes: the format and the hash. The lead makes a code on the server (packages/db/src/break-glass.ts,
 * which holds the same three functions: the dashboard does not depend on @god/db). A shared test vector in both
 * test files keeps them the same. 20 Crockford base32 symbols (100 bits), shown as five groups of four.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 20;
export const CODE_TTL_MS = 15 * 60_000;

export function newEnrolmentCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let s = "";
  for (const b of bytes) s += ALPHABET[b & 31];
  return s.match(/.{4}/g)!.join("-");
}

/** Upper case, no spaces or dashes, O read as 0 and I or L as 1. Null when it is not a code. */
export function normaliseCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 64) return null;
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(s) ? s : null;
}

export function codeHash(normalised: string): string {
  return createHash("sha256").update(`god-breakglass-code-v1:${normalised}`, "utf8").digest("hex");
}
