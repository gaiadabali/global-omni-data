import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * The small pieces of cryptography sign-in needs, all from node:crypto. Keys are derived from GOD_SESSION_SECRET
 * with HKDF-SHA256, one per purpose, so the cookie key and the audit hash key are never the same key.
 */

export type KeyPurpose = "oidc-transaction-v1" | "audit-sub-v1";

export function deriveKey(secret: string, purpose: KeyPurpose): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.alloc(0),
      `god-dashboard/${purpose}`,
      32,
    ),
  );
}

/** A new session token: 256 random bits, base64url (43 characters). Only ever sent in the cookie. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** A non-identifying label for a YourTal sub in the audit log: keyed, so it cannot be reversed or matched
 *  against the sub without the secret, and stable, so repeated attempts line up. */
export function subLabel(sub: string | null | undefined, secret: string): string {
  if (!sub) return "sub#none";
  return `sub#${createHmac("sha256", deriveKey(secret, "audit-sub-v1")).update(sub, "utf8").digest("hex").slice(0, 16)}`;
}

export function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** AES-256-GCM. Output: base64url(iv[12] | tag[16] | ciphertext). `aad` binds the value to its use. */
export function seal(plain: string, key: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

/** The plain text, or null for anything tampered with, truncated or sealed under another key or purpose. */
export function open(sealed: string, key: Buffer, aad: string): string | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return null;
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
