import type pg from "pg";
import type { EnquiryFilter, EnquiryStore } from "../types";
import { ENQUIRY_COLUMNS, toEnquiry, type EnquiryRow } from "./map";

/** The WHERE clause and parameters for a filter. Parameterised only: the search text is never put into the SQL. */
function whereFor(filter: Omit<EnquiryFilter, "limit">): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const status = filter.status ?? "all";
  if (status === "open") clauses.push("status <> 'archived'");
  else if (status !== "all") {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  const q = (filter.q ?? "").trim();
  if (q) {
    params.push(q);
    // strpos, not LIKE: no wildcard in the text can change what matches.
    clauses.push(`strpos(lower(concat_ws(chr(10), name, company, email, want)), lower($${params.length}::text)) > 0`);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", params };
}

/**
 * Enquiries over Postgres (migration 0004). god_app can INSERT six columns (the database sets the id, the time and
 * the status), SELECT, and UPDATE only status, handled_by and handled_at. There is no delete.
 */
export function createEnquiryStore(pool: pg.Pool): EnquiryStore {
  return {
    async create(input) {
      const r = await pool.query<EnquiryRow>(
        `INSERT INTO god_app.enquiries (name, company, email, want, budget, ip_prefix)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${ENQUIRY_COLUMNS}`,
        [input.name, input.company, input.email, input.want, input.budget, input.ipPrefix],
      );
      return toEnquiry(r.rows[0]!);
    },

    async list(filter = {}) {
      const { sql, params } = whereFor(filter);
      let text = `SELECT ${ENQUIRY_COLUMNS} FROM god_app.enquiries${sql} ORDER BY received_at DESC, id DESC`;
      if (filter.limit && filter.limit > 0) {
        params.push(Math.floor(filter.limit));
        text += ` LIMIT $${params.length}`;
      }
      const r = await pool.query<EnquiryRow>(text, params);
      return r.rows.map(toEnquiry);
    },

    async count(filter = {}) {
      const { sql, params } = whereFor(filter);
      const r = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM god_app.enquiries${sql}`, params);
      return r.rows[0]!.n;
    },

    async find(id) {
      const r = await pool.query<EnquiryRow>(`SELECT ${ENQUIRY_COLUMNS} FROM god_app.enquiries WHERE id = $1`, [id]);
      return r.rows[0] ? toEnquiry(r.rows[0]) : null;
    },

    async setStatus(id, status, by, at) {
      // "new" clears who and when; the table's CHECK keeps the three columns in step.
      const r = await pool.query<EnquiryRow>(
        `UPDATE god_app.enquiries
            SET status = $2::text,
                handled_by = CASE WHEN $2::text = 'new' THEN NULL ELSE $3::text END,
                handled_at = CASE WHEN $2::text = 'new' THEN NULL ELSE $4::timestamptz END
          WHERE id = $1
          RETURNING ${ENQUIRY_COLUMNS}`,
        [id, status, by, at],
      );
      return r.rows[0] ? toEnquiry(r.rows[0]) : null;
    },
  };
}
