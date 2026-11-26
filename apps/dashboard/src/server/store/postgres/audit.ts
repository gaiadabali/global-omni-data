import type pg from "pg";
import { dayRange } from "@/lib/dates";
import { isAuditAction, type AuditEvent, type AuditFilter, type AuditLog } from "../../audit/types";
import { AUDIT_COLUMNS, toAuditEvent, type AuditRow } from "./map";

/**
 * The audit log over Postgres. Append-only in the database itself (migration 0002): the runtime role can only
 * INSERT and SELECT, a trigger refuses UPDATE, DELETE and TRUNCATE, and `seq` and the time are set by the
 * database. This object has exactly two methods, like the memory log.
 */
export function createPostgresAuditLog(pool: pg.Pool): AuditLog {
  const log: AuditLog = {
    async append(input): Promise<AuditEvent> {
      if (!input.who.trim()) throw new RangeError("audit: who is required");
      if (!input.target.trim()) throw new RangeError("audit: target is required");
      if (!isAuditAction(input.action)) throw new RangeError(`audit: unknown action ${String(input.action)}`);
      const r = await pool.query<AuditRow>(
        `INSERT INTO god_app.audit_log (who, action, target, reason, outcome)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${AUDIT_COLUMNS}`,
        [input.who, input.action, input.target, input.reason ?? "", input.outcome ?? "done"],
      );
      return toAuditEvent(r.rows[0]!);
    },

    async list(filter: AuditFilter = {}) {
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replace("?", `$${params.length}`));
      };
      if (filter.who) add("who = ?", filter.who);
      if (filter.action) add("action = ?", filter.action);
      if (filter.target) add("target = ?", filter.target);
      if (filter.outcome) add("outcome = ?", filter.outcome);
      // A day is a day in Australian Eastern time, as src/lib/dates.ts defines it. A bad date is ignored.
      const from = filter.from ? dayRange(filter.from) : null;
      const to = filter.to ? dayRange(filter.to) : null;
      if (from) add("occurred_at >= ?::timestamptz", new Date(from.start).toISOString());
      if (to) add("occurred_at <= ?::timestamptz", new Date(to.end).toISOString());
      let sql = `SELECT ${AUDIT_COLUMNS} FROM god_app.audit_log`;
      if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
      sql += " ORDER BY occurred_at DESC, seq DESC";
      if (filter.limit && filter.limit > 0) {
        params.push(Math.floor(filter.limit));
        sql += ` LIMIT $${params.length}`;
      }
      const r = await pool.query<AuditRow>(sql, params);
      return Object.freeze(r.rows.map(toAuditEvent));
    },
  };
  return Object.freeze(log);
}
