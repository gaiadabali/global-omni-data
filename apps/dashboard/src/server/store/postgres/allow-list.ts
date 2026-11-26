import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { AllowListStore } from "../types";
import { ALLOW_COLUMNS, normEmail, toAllowEntry, type AllowRow } from "./map";

const SELECT = `SELECT ${ALLOW_COLUMNS} FROM god_app.allow_list`;

/** Allow-list over Postgres. Parameterised queries only. The table is never deleted from: "removed" is a status. */
export function createAllowListStore(pool: pg.Pool): AllowListStore {
  const one = async (sql: string, params: unknown[]) => {
    const r = await pool.query<AllowRow>(sql, params);
    return r.rows[0] ? toAllowEntry(r.rows[0]) : null;
  };

  return {
    async list() {
      const r = await pool.query<AllowRow>(`${SELECT} ORDER BY invited_at, id`);
      return r.rows.map(toAllowEntry);
    },

    find: (id) => one(`${SELECT} WHERE id = $1`, [id]),

    findBySub: (sub) => one(`${SELECT} WHERE yourtal_sub = $1`, [sub]),

    findUnboundByEmail: (email) =>
      one(`${SELECT} WHERE email = $1 AND yourtal_sub IS NULL AND status <> 'removed' ORDER BY invited_at LIMIT 1`, [
        normEmail(email),
      ]),

    async invite(input) {
      const id = `u-${randomBytes(8).toString("hex")}`;
      // The partial unique index (email WHERE status <> 'removed') is the refusal: no row comes back.
      return one(
        `INSERT INTO god_app.allow_list (id, name, email, role, brand, agreement_signed, original_held_by, status, invited_by)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7, 'invited', $8)
         ON CONFLICT (email) WHERE status <> 'removed' DO NOTHING
         RETURNING ${ALLOW_COLUMNS}`,
        [id, input.name, normEmail(input.email), input.role, input.brand ?? null, input.agreementSigned, input.originalHeldBy, input.invitedBy],
      );
    },

    async bindSub(id, sub) {
      try {
        // Only an invited or active entry can be bound; a suspended or removed one is never reactivated by sign-in.
        const r = await pool.query(
          `UPDATE god_app.allow_list SET yourtal_sub = $2, status = 'active'
           WHERE id = $1 AND status IN ('invited', 'active') AND (yourtal_sub IS NULL OR yourtal_sub = $2)`,
          [id, sub],
        );
        return r.rowCount === 1;
      } catch (e) {
        if ((e as { code?: string }).code === "23505") return false; // that sub already belongs to another entry
        throw e;
      }
    },

    async setStatus(id, status) {
      await pool.query("UPDATE god_app.allow_list SET status = $2 WHERE id = $1", [id, status]);
    },

    async recordSignIn(id, at) {
      await pool.query("UPDATE god_app.allow_list SET last_sign_in = $2::timestamptz WHERE id = $1", [id, at]);
    },
  };
}
