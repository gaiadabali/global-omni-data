import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

/**
 * The migration runner. Plain versioned SQL files (NNNN_name.sql) in a folder, applied in order, each in its own
 * transaction, recorded in god_app.schema_migrations with a checksum. An applied file that was edited or deleted
 * stops the run: change the schema with a new migration, never an old one.
 *
 * Runs as god_migrator. Plain TypeScript that Node 24 runs directly (type stripping), so the image needs no build.
 */

export const SCHEMA = "god_app";
export const TABLE = `${SCHEMA}.schema_migrations`;
/** pg_advisory_lock key: two runners never run at once. */
const LOCK_KEY = 7_340_113_201;
const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export class MigrationError extends Error {
  override name = "MigrationError";
}

export interface MigrationFile {
  version: number;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  /** Files applied by this run, in order, for example "0002_audit_log". */
  applied: string[];
  /** Files already applied and unchanged. */
  upToDate: number;
}

/** SHA-256 hex of the file text with line endings normalised, so a CRLF checkout hashes the same as LF. */
export function checksumOf(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

/** Reads and validates a migrations folder: names, a gapless sequence from 1, and no transaction control. */
export function loadMigrations(dir: string): MigrationFile[] {
  const out: MigrationFile[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const m = FILE_RE.exec(file);
    if (!m) throw new MigrationError(`bad migration file name: ${file} (want NNNN_name.sql, lower case)`);
    const sql = readFileSync(join(dir, file), "utf8");
    if (/^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)\s*;/im.test(sql)) {
      throw new MigrationError(`${file}: no BEGIN/COMMIT/ROLLBACK in a migration, the runner owns the transaction`);
    }
    out.push({ version: Number(m[1]), name: m[2]!, file, sql, checksum: checksumOf(sql) });
  }
  out.forEach((mig, i) => {
    if (mig.version !== i + 1) {
      throw new MigrationError(`migration numbering must run 1, 2, 3 without gaps or repeats: found ${mig.file} at position ${i + 1}`);
    }
  });
  return out;
}

interface AppliedRow {
  version: number;
  name: string;
  checksum: string;
}

async function ensureSchemaAndTable(c: pg.Client): Promise<void> {
  const { rowCount } = await c.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [SCHEMA]);
  if (!rowCount) await c.query(`CREATE SCHEMA ${SCHEMA}`);
  await c.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    version     integer PRIMARY KEY,
    name        text NOT NULL,
    checksum    text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    applied_by  text NOT NULL DEFAULT current_user
  )`);
}

/** Throws unless the database's history is a clean prefix of the files: same names, same checksums. */
function verifyHistory(files: MigrationFile[], applied: AppliedRow[]): void {
  applied.forEach((row, i) => {
    const f = files[i];
    if (!f || f.version !== row.version) {
      throw new MigrationError(
        `migration ${String(row.version).padStart(4, "0")}_${row.name} is applied but its file is missing or out of order`,
      );
    }
    if (f.checksum !== row.checksum) {
      throw new MigrationError(
        `${f.file} was edited after it was applied (checksum differs). Revert it and add a new migration instead.`,
      );
    }
  });
}

async function readApplied(c: pg.Client): Promise<AppliedRow[]> {
  const r = await c.query<AppliedRow>(`SELECT version, name, checksum FROM ${TABLE} ORDER BY version`);
  return r.rows;
}

export interface RunOptions {
  /** Folder of NNNN_name.sql files. */
  dir: string;
  /** Called with a line of progress. */
  log?: (line: string) => void;
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url, application_name: "god-migrate" });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Applies every pending migration. Throws MigrationError for an edited, missing or out-of-order one. */
export async function migrate(url: string, opts: RunOptions): Promise<MigrateResult> {
  const log = opts.log ?? (() => undefined);
  const files = loadMigrations(opts.dir);
  return withClient(url, async (c) => {
    await c.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      await ensureSchemaAndTable(c);
      const applied = await readApplied(c);
      verifyHistory(files, applied);
      const pending = files.slice(applied.length);
      const result: MigrateResult = { applied: [], upToDate: applied.length };
      for (const f of pending) {
        log(`applying ${f.file}`);
        try {
          await c.query("BEGIN");
          await c.query("SET LOCAL lock_timeout = '15s'");
          await c.query(f.sql);
          await c.query(`INSERT INTO ${TABLE} (version, name, checksum) VALUES ($1, $2, $3)`, [
            f.version,
            f.name,
            f.checksum,
          ]);
          await c.query("COMMIT");
        } catch (e) {
          await c.query("ROLLBACK").catch(() => undefined);
          throw new MigrationError(`${f.file} failed and was rolled back: ${e instanceof Error ? e.message : String(e)}`);
        }
        result.applied.push(f.file.replace(/\.sql$/, ""));
      }
      return result;
    } finally {
      await c.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    }
  });
}

export interface StatusRow {
  file: string;
  state: "applied" | "pending" | "changed" | "missing";
  appliedAt?: string;
}

/** What `up` would do, without doing it. Throws nothing for an edited file: it reports it as "changed". */
export async function status(url: string, opts: RunOptions): Promise<StatusRow[]> {
  const files = loadMigrations(opts.dir);
  return withClient(url, async (c) => {
    const exists = await c.query("SELECT to_regclass($1) AS t", [TABLE]);
    const rows = exists.rows[0]?.t
      ? (await c.query<AppliedRow & { applied_at: Date }>(`SELECT version, name, checksum, applied_at FROM ${TABLE} ORDER BY version`)).rows
      : [];
    const byVersion = new Map(rows.map((r) => [r.version, r]));
    const out: StatusRow[] = files.map((f) => {
      const r = byVersion.get(f.version);
      if (!r) return { file: f.file, state: "pending" };
      return { file: f.file, state: r.checksum === f.checksum ? "applied" : "changed", appliedAt: r.applied_at.toISOString() };
    });
    for (const r of rows) {
      if (!files.some((f) => f.version === r.version)) {
        out.push({ file: `${String(r.version).padStart(4, "0")}_${r.name}.sql`, state: "missing" });
      }
    }
    return out;
  });
}
