import type pg from "pg";
import type { BreakGlassStore, CodeCheck } from "../types";
import { BREAK_GLASS_COLUMNS, toBreakGlassKey, type BreakGlassRow } from "./map";

const SELECT = `SELECT ${BREAK_GLASS_COLUMNS} FROM god_app.break_glass_credentials`;

/**
 * Break-glass keys and enrolment codes over Postgres (migration 0003). The database enforces the rules too: one active
 * key per Owner (unique index), two in total and Owners only (trigger), revocation final and the counter never going
 * back (trigger). god_app cannot make a code, only read one and mark it used.
 */
export function createBreakGlassStore(pool: pg.Pool): BreakGlassStore {
  return {
    async list() {
      const r = await pool.query<BreakGlassRow>(`${SELECT} ORDER BY created_at DESC, credential_id`);
      return r.rows.map(toBreakGlassKey);
    },

    async findActive(credentialId) {
      const r = await pool.query<BreakGlassRow>(`${SELECT} WHERE credential_id = $1 AND revoked_at IS NULL`, [credentialId]);
      return r.rows[0] ? toBreakGlassKey(r.rows[0]) : null;
    },

    async create(input) {
      try {
        const r = await pool.query<BreakGlassRow>(
          `INSERT INTO god_app.break_glass_credentials (credential_id, public_key, sign_count, owner_id)
           VALUES ($1, $2, $3, $4) RETURNING ${BREAK_GLASS_COLUMNS}`,
          [input.credentialId, Buffer.from(input.publicKey), input.signCount, input.ownerId],
        );
        return toBreakGlassKey(r.rows[0]!);
      } catch (e) {
        // 23505: this Owner already has an active key (or the credential id exists); 23514: two keys are active, or
        // not an active Owner; 23503: no such entry.
        const code = (e as { code?: string }).code;
        if (code === "23505" || code === "23514" || code === "23503") return null;
        throw e;
      }
    },

    async recordUse(credentialId, signCount, at) {
      const r = await pool.query(
        `UPDATE god_app.break_glass_credentials SET sign_count = $2, last_used_at = $3::timestamptz
         WHERE credential_id = $1 AND revoked_at IS NULL AND (sign_count < $2 OR ($2 = 0 AND sign_count = 0))`,
        [credentialId, signCount, at],
      );
      return r.rowCount === 1;
    },

    async revoke(credentialId, at) {
      const r = await pool.query(
        "UPDATE god_app.break_glass_credentials SET revoked_at = $2::timestamptz WHERE credential_id = $1 AND revoked_at IS NULL",
        [credentialId, at],
      );
      return r.rowCount === 1;
    },

    async checkCode(hash, at): Promise<CodeCheck> {
      const r = await pool.query<{ owner_id: string; used: boolean; expired: boolean }>(
        `SELECT owner_id, used_at IS NOT NULL AS used, expires_at <= $2::timestamptz AS expired
         FROM god_app.break_glass_enrolment_codes WHERE code_hash = $1`,
        [hash, at],
      );
      const c = r.rows[0];
      if (!c) return { state: "unknown" };
      if (c.used) return { state: "used", ownerId: c.owner_id };
      if (c.expired) return { state: "expired", ownerId: c.owner_id };
      return { state: "ok", ownerId: c.owner_id };
    },

    async useCode(hash, ownerId, at) {
      const r = await pool.query(
        `UPDATE god_app.break_glass_enrolment_codes SET used_at = $3::timestamptz
         WHERE code_hash = $1 AND owner_id = $2 AND used_at IS NULL AND expires_at > $3::timestamptz`,
        [hash, ownerId, at],
      );
      return r.rowCount === 1;
    },
  };
}
