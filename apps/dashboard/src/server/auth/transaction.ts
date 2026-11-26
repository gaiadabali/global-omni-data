import { deriveKey, open, seal } from "./crypto";

/**
 * The sign-in transaction: what /auth/start must hand to /auth/callback. It lives only in a short-lived encrypted
 * cookie (no table): AES-GCM under a key derived from GOD_SESSION_SECRET, 10 minutes, deleted at the callback
 * whatever happens there.
 */
export const TXN_COOKIE = "__Host-god_oidc";
export const TXN_TTL_MS = 10 * 60_000;
const AAD = "god-oidc-transaction";

export interface Transaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** A same-origin path to go back to, or null for the person's home page. */
  returnTo: string | null;
  /** A fresh passkey check for a signed-in session (its id), or null for a sign-in. */
  freshFor: string | null;
  /** When the flow started, epoch ms. A fresh check's auth_time must not be older. */
  startedAt: number;
}

export function sealTransaction(txn: Transaction, secret: string): string {
  return seal(JSON.stringify(txn), deriveKey(secret, "oidc-transaction-v1"), AAD);
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512;

/** The transaction, or null when the cookie is missing, tampered with, malformed or older than 10 minutes. */
export function openTransaction(value: string | undefined, secret: string, now: number): Transaction | null {
  if (!value || value.length > 4096) return null;
  const plain = open(value, deriveKey(secret, "oidc-transaction-v1"), AAD);
  if (plain === null) return null;
  let t: Partial<Transaction>;
  try {
    t = JSON.parse(plain) as Partial<Transaction>;
  } catch {
    return null;
  }
  if (!isStr(t.state) || !isStr(t.nonce) || !isStr(t.codeVerifier)) return null;
  if (typeof t.startedAt !== "number" || !Number.isFinite(t.startedAt)) return null;
  // Not from the future (beyond a little clock skew), and not past its 10 minutes.
  if (t.startedAt > now + 60_000 || now - t.startedAt >= TXN_TTL_MS) return null;
  return {
    state: t.state,
    nonce: t.nonce,
    codeVerifier: t.codeVerifier,
    returnTo: isStr(t.returnTo) ? t.returnTo : null,
    freshFor: isStr(t.freshFor) ? t.freshFor : null,
    startedAt: t.startedAt,
  };
}
