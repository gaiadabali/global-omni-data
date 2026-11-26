import type pg from "pg";
import type { SessionStore } from "../types";
import { SESSION_COLUMNS, toSessionRecord, type SessionRow } from "./map";

/** A session ends after this long without a request... */
export const IDLE_MINUTES = 30;
/** ...or this long after it began, whatever else happens. The table also has a CHECK for the absolute limit. */
export const ABSOLUTE_HOURS = 8;

const SELECT = `SELECT ${SESSION_COLUMNS} FROM god_app.sessions`;

/** Sessions over Postgres. Only the SHA-256 of the cookie token is stored. */
export function createSessionStore(pool: pg.Pool): SessionStore {
  return {
    async create(input) {
      const r = await pool.query<SessionRow>(
        `INSERT INTO god_app.sessions
           (token_hash, user_id, created_at, last_seen_at, absolute_expires_at, auth_time, amr, user_agent, ip_prefix)
         VALUES ($1, $2, $3::timestamptz, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6::text[], $7, $8)
         RETURNING ${SESSION_COLUMNS}`,
        [input.tokenHash, input.userId, input.createdAt, input.absoluteExpiresAt, input.authTime, [...input.amr], input.userAgent, input.ipPrefix],
      );
      return toSessionRecord(r.rows[0]!);
    },

    async findByTokenHash(tokenHash) {
      const r = await pool.query<SessionRow>(`${SELECT} WHERE token_hash = $1`, [tokenHash]);
      return r.rows[0] ? toSessionRecord(r.rows[0]) : null;
    },

    async touch(id, at) {
      // Never moves backwards, so two overlapping requests cannot shorten a session.
      await pool.query(
        "UPDATE god_app.sessions SET last_seen_at = GREATEST(last_seen_at, $2::timestamptz) WHERE id = $1",
        [id, at],
      );
    },

    async updateAuth(id, authTime, amr) {
      // Never an emergency session: it stays one (the database refuses too, migration 0003).
      await pool.query(
        "UPDATE god_app.sessions SET auth_time = $2::timestamptz, amr = $3::text[] WHERE id = $1 AND NOT ('break-glass' = ANY (amr))",
        [id, authTime, [...amr]],
      );
    },

    async revoke(id, by, at) {
      await pool.query(
        "UPDATE god_app.sessions SET revoked_at = $3::timestamptz, revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL",
        [id, by, at],
      );
    },

    async revokeAllForUser(userId, by, at) {
      const r = await pool.query(
        "UPDATE god_app.sessions SET revoked_at = $3::timestamptz, revoked_by = $2 WHERE user_id = $1 AND revoked_at IS NULL",
        [userId, by, at],
      );
      return r.rowCount ?? 0;
    },

    async listActive(at) {
      const r = await pool.query<SessionRow>(
        `${SELECT}
         WHERE revoked_at IS NULL
           AND absolute_expires_at > $1::timestamptz
           AND created_at + make_interval(hours => $3) > $1::timestamptz
           AND last_seen_at > $1::timestamptz - make_interval(mins => $2)
         ORDER BY last_seen_at DESC, id`,
        [at, IDLE_MINUTES, ABSOLUTE_HOURS],
      );
      return r.rows.map(toSessionRecord);
    },
  };
}
