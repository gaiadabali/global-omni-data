import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

/**
 * The server half of break-glass (migration 0003): what the lead runs on Helios, as god_migrator, from the
 * dashboard image (`node /app/db/src/cli.ts break-glass-...`). The dashboard's runtime role cannot make an enrolment
 * code, so an Owner session alone can never enrol an emergency key: it also takes someone with server access.
 *
 *   issueCode   a one-time enrolment code for one active Owner entry: 15 minutes, used once, only its hash stored.
 *               Any older unused code for that Owner stops working.
 *   revokeKeys  revokes an Owner's active key (or every key) and ends every emergency session. For when the sealed
 *               key is lost and YourTal is down, so the Admin page cannot be used.
 *   listKeys    the keys, for the quarterly check.
 * Each writes an audit event (who "server").
 *
 * The code format and its hash are duplicated in apps/dashboard/src/server/breakglass/codes.ts; a shared test
 * vector in both test files keeps them the same.
 */

/** Crockford base32: no I, L, O or U, so a code read aloud or off paper is not misread. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 20;
export const CODE_TTL_MINUTES = 15;

/** "7K3M-9QDX-..." : 20 symbols (100 bits) in groups of four. */
export function newEnrolmentCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let s = "";
  // 256 is a multiple of 32, so the low five bits of a random byte are uniform.
  for (const b of bytes) s += ALPHABET[b & 31];
  return s.match(/.{4}/g)!.join("-");
}

/** Upper case, no spaces or dashes, and the Crockford look-alikes mapped (O to 0, I and L to 1). Null if malformed. */
export function normaliseCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(s) ? s : null;
}

export function codeHash(normalised: string): string {
  return createHash("sha256").update(`god-breakglass-code-v1:${normalised}`, "utf8").digest("hex");
}

export class BreakGlassCliError extends Error {
  override name = "BreakGlassCliError";
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url, application_name: "god-breakglass-cli" });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function inTransaction<T>(c: pg.Client, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    const out = await fn();
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  }
}

const OWNER_ID = /^[A-Za-z0-9._-]{1,100}$/;

export interface IssuedCode {
  code: string;
  ownerId: string;
  ownerName: string;
  expiresAt: string;
}

/** A new enrolment code for an active Owner entry. Throws BreakGlassCliError for anyone else. */
export async function issueCode(url: string, ownerId: string): Promise<IssuedCode> {
  if (!OWNER_ID.test(ownerId)) throw new BreakGlassCliError("--owner must be an allow-list entry id, for example u-owner-1");
  return withClient(url, (c) =>
    inTransaction(c, async () => {
      const who = await c.query<{ name: string; role: string; status: string }>(
        "SELECT name, role, status FROM god_app.allow_list WHERE id = $1 FOR SHARE",
        [ownerId],
      );
      const e = who.rows[0];
      if (!e) throw new BreakGlassCliError(`no allow-list entry ${ownerId}`);
      if (e.role !== "owner") throw new BreakGlassCliError(`${ownerId} is not an Owner (role ${e.role})`);
      if (e.status !== "active") {
        throw new BreakGlassCliError(`${ownerId} is ${e.status}: the Owner must have signed in with YourTal at least once`);
      }
      // One live code per Owner: an older unused one stops working now.
      await c.query(
        `UPDATE god_app.break_glass_enrolment_codes SET expires_at = LEAST(expires_at, now())
         WHERE owner_id = $1 AND used_at IS NULL AND expires_at > now()`,
        [ownerId],
      );
      const code = newEnrolmentCode();
      const r = await c.query<{ expires_at: Date }>(
        `INSERT INTO god_app.break_glass_enrolment_codes (code_hash, owner_id, expires_at)
         VALUES ($1, $2, now() + make_interval(mins => $3)) RETURNING expires_at`,
        [codeHash(normaliseCode(code)!), ownerId, CODE_TTL_MINUTES],
      );
      await c.query(
        "INSERT INTO god_app.audit_log (who, action, target, reason) VALUES ('server', 'breakglass.code', $1, $2)",
        [ownerId, `Emergency key enrolment code made on the server for ${e.name}. Works once, for ${CODE_TTL_MINUTES} minutes`],
      );
      return { code, ownerId, ownerName: e.name, expiresAt: r.rows[0]!.expires_at.toISOString() };
    }),
  );
}

export interface RevokeResult {
  keys: number;
  sessions: number;
}

/** Revokes the active key of one Owner (or every active key with `all`) and ends every live emergency session. */
export async function revokeKeys(url: string, target: { ownerId: string } | { all: true }): Promise<RevokeResult> {
  if ("ownerId" in target && !OWNER_ID.test(target.ownerId)) throw new BreakGlassCliError("--owner must be an allow-list entry id");
  return withClient(url, (c) =>
    inTransaction(c, async () => {
      const owner = "ownerId" in target ? target.ownerId : null;
      const keys = await c.query(
        `UPDATE god_app.break_glass_credentials SET revoked_at = now()
         WHERE revoked_at IS NULL AND ($1::text IS NULL OR owner_id = $1)`,
        [owner],
      );
      const sessions = await c.query(
        `UPDATE god_app.sessions SET revoked_at = now(), revoked_by = 'server'
         WHERE revoked_at IS NULL AND 'break-glass' = ANY (amr) AND ($1::text IS NULL OR user_id = $1)`,
        [owner],
      );
      const n = keys.rowCount ?? 0;
      const s = sessions.rowCount ?? 0;
      await c.query(
        "INSERT INTO god_app.audit_log (who, action, target, reason) VALUES ('server', 'breakglass.revoke', $1, $2)",
        [owner ?? "all", `Revoked on the server: ${n} emergency ${n === 1 ? "key" : "keys"}, ${s} emergency ${s === 1 ? "session" : "sessions"} ended`],
      );
      return { keys: n, sessions: s };
    }),
  );
}

export interface KeyRow {
  owner: string;
  credential: string;
  created: string;
  lastUsed: string | null;
  revoked: string | null;
}

export async function listKeys(url: string): Promise<KeyRow[]> {
  return withClient(url, async (c) => {
    const r = await c.query<{ owner_id: string; credential_id: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }>(
      "SELECT owner_id, credential_id, created_at, last_used_at, revoked_at FROM god_app.break_glass_credentials ORDER BY created_at",
    );
    return r.rows.map((x) => ({
      owner: x.owner_id,
      credential: x.credential_id.slice(0, 12),
      created: x.created_at.toISOString(),
      lastUsed: x.last_used_at?.toISOString() ?? null,
      revoked: x.revoked_at?.toISOString() ?? null,
    }));
  });
}
