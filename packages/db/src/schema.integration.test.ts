import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, status } from "./runner.ts";

/**
 * Integration tests against a real Postgres 18 (scripts/server-f/db-test.sh starts a throwaway one, applies
 * roles/setup-roles.sql and the migrations, and sets these). Without them the whole file skips.
 *
 *   GOD_TEST_ADMIN_URL      superuser, database "postgres"
 *   GOD_TEST_MIGRATOR_URL   god_migrator on god_dashboard (migrations already applied)
 *   GOD_TEST_APP_URL        god_app on god_dashboard
 */
const ADMIN = process.env.GOD_TEST_ADMIN_URL;
const MIGRATOR = process.env.GOD_TEST_MIGRATOR_URL;
const APP = process.env.GOD_TEST_APP_URL;
const enabled = Boolean(ADMIN && MIGRATOR && APP);
const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

function withDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

async function connect(url: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

/** The SQLSTATE of the error a statement raises, or "ok". */
async function code(c: pg.Client, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await c.query(sql, params);
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

const rand = () => Math.random().toString(36).slice(2, 10);

describe.skipIf(!enabled)("god_dashboard: roles, grants and the append-only audit log", () => {
  let app: pg.Client;
  let owner: pg.Client;
  let admin: pg.Client;
  const insertAudit = "INSERT INTO god_app.audit_log (who, action, target) VALUES ($1, 'person.open', $2) RETURNING seq, occurred_at";

  beforeAll(async () => {
    app = await connect(APP!);
    owner = await connect(MIGRATOR!);
    admin = await connect(withDb(ADMIN!, "god_dashboard"));
  });
  afterAll(async () => {
    await Promise.all([app?.end(), owner?.end(), admin?.end()]);
  });

  it("the migrations are applied and recorded", async () => {
    const r = await owner.query("SELECT version, name FROM god_app.schema_migrations ORDER BY version");
    expect(r.rows.map((x) => `${x.version}_${x.name}`)).toEqual(["1_allow_list_sessions", "2_audit_log"]);
  });

  describe("audit_log is append-only", () => {
    it("god_app can append and read; seq and time come from the database", async () => {
      const who = `t-${rand()}`;
      const a = await app.query(insertAudit, [who, "GOD-1"]);
      const b = await app.query(insertAudit, [who, "GOD-2"]);
      expect(Number(b.rows[0].seq)).toBeGreaterThan(Number(a.rows[0].seq));
      expect(Math.abs(Date.now() - a.rows[0].occurred_at.getTime())).toBeLessThan(60_000);
      const read = await app.query("SELECT count(*)::int AS n FROM god_app.audit_log WHERE who = $1", [who]);
      expect(read.rows[0].n).toBe(2);
    });

    it("god_app cannot choose seq or the time", async () => {
      // GENERATED ALWAYS refuses an explicit seq (428C9) before the column privilege check (42501) even runs.
      expect(["428C9", "42501"]).toContain(await code(app, "INSERT INTO god_app.audit_log (seq, who, action, target) VALUES (1, 'x', 'person.open', 'y')"));
      expect(await code(app, "INSERT INTO god_app.audit_log (occurred_at, who, action, target) VALUES ('2001-01-01', 'x', 'person.open', 'y')")).toBe("42501");
    });

    it("UPDATE, DELETE and TRUNCATE fail for god_app (no privilege)", async () => {
      await app.query(insertAudit, [`t-${rand()}`, "GOD-3"]);
      expect(await code(app, "UPDATE god_app.audit_log SET who = 'someone else'")).toBe("42501");
      expect(await code(app, "DELETE FROM god_app.audit_log")).toBe("42501");
      expect(await code(app, "TRUNCATE god_app.audit_log")).toBe("42501");
    });

    it("the triggers stop UPDATE, DELETE and TRUNCATE even for the owner and a superuser", async () => {
      for (const c of [owner, admin]) {
        expect(await code(c, "UPDATE god_app.audit_log SET reason = 'edited'")).toBe("23001");
        expect(await code(c, "DELETE FROM god_app.audit_log")).toBe("23001");
        expect(await code(c, "TRUNCATE god_app.audit_log")).toBe("23001");
      }
      const n = await app.query("SELECT count(*)::int AS n FROM god_app.audit_log");
      expect(n.rows[0].n).toBeGreaterThan(0);
    });

    it("rejects an unknown action, a blank who, a blank target and a bad outcome", async () => {
      expect(await code(app, "INSERT INTO god_app.audit_log (who, action, target) VALUES ('x', 'nope', 'y')")).toBe("23514");
      expect(await code(app, "INSERT INTO god_app.audit_log (who, action, target) VALUES ('  ', 'person.open', 'y')")).toBe("23514");
      expect(await code(app, "INSERT INTO god_app.audit_log (who, action, target) VALUES ('x', 'person.open', '')")).toBe("23514");
      expect(await code(app, "INSERT INTO god_app.audit_log (who, action, target, outcome) VALUES ('x', 'person.open', 'y', 'maybe')")).toBe("23514");
    });
  });

  describe("god_app has least privilege", () => {
    it("cannot create tables, schemas or temp tables, or alter anything", async () => {
      expect(await code(app, "CREATE TABLE god_app.sneaky (id int)")).toBe("42501");
      expect(await code(app, "CREATE TABLE public.sneaky (id int)")).toBe("42501");
      expect(await code(app, "CREATE SCHEMA sneaky")).toBe("42501");
      expect(await code(app, "CREATE TEMP TABLE sneaky (id int)")).toBe("42501");
      expect(await code(app, "ALTER TABLE god_app.audit_log DISABLE TRIGGER ALL")).toBe("42501");
      expect(await code(app, "DROP TABLE god_app.audit_log")).toBe("42501");
      expect(await code(app, "DROP TABLE god_app.allow_list")).toBe("42501");
    });

    it("cannot read the migration history or anything in public", async () => {
      expect(await code(app, "SELECT * FROM god_app.schema_migrations")).toBe("42501");
      expect(await code(owner, "CREATE TABLE public.probe (id int)")).toBe("ok");
      expect(await code(app, "SELECT * FROM public.probe")).toBe("42501");
      await owner.query("DROP TABLE public.probe");
    });

    it("cannot delete allow-list entries or sessions, or change fixed columns", async () => {
      expect(await code(app, "DELETE FROM god_app.allow_list")).toBe("42501");
      expect(await code(app, "DELETE FROM god_app.sessions")).toBe("42501");
      expect(await code(app, "UPDATE god_app.allow_list SET email = 'a@b.c'")).toBe("42501");
      expect(await code(app, "UPDATE god_app.allow_list SET role = 'owner'")).toBe("42501");
      expect(await code(app, "UPDATE god_app.sessions SET token_hash = repeat('a', 64)")).toBe("42501");
    });

    it("is not a superuser and cannot bypass RLS or create roles", async () => {
      const r = await app.query("SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname = current_user");
      expect(r.rows[0]).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false });
      expect(await code(app, "CREATE ROLE sneaky")).toBe("42501");
    });
  });

  describe("allow_list and sessions rules", () => {
    const entry = (email: string, over: Record<string, unknown> = {}): [string, unknown[]] => {
      const v = { id: `u-${rand()}`, name: "Test", email, role: "data", brand: null, signed: "2026-11-01", by: "x", status: "invited", invitedBy: "o", ...over };
      return [
        "INSERT INTO god_app.allow_list (id, name, email, role, brand, agreement_signed, original_held_by, status, invited_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [v.id, v.name, v.email, v.role, v.brand, v.signed, v.by, v.status, v.invitedBy],
      ];
    };

    it("one live entry per email; a removed entry frees the email", async () => {
      const email = `a-${rand()}@example.test`;
      const first = entry(email);
      expect(await code(app, ...first)).toBe("ok");
      expect(await code(app, ...entry(email))).toBe("23505");
      expect(await code(app, "UPDATE god_app.allow_list SET status = 'removed' WHERE id = $1", [first[1][0]])).toBe("ok");
      expect(await code(app, ...entry(email))).toBe("ok");
    });

    it("email must be lower case; a brand lead needs a brand and nobody else has one; roles and brands are fixed sets", async () => {
      expect(await code(app, ...entry("Upper@Example.test"))).toBe("23514");
      expect(await code(app, ...entry(`b-${rand()}@example.test`, { role: "brand_lead" }))).toBe("23514");
      expect(await code(app, ...entry(`c-${rand()}@example.test`, { role: "data", brand: "ftr" }))).toBe("23514");
      expect(await code(app, ...entry(`d-${rand()}@example.test`, { role: "brand_lead", brand: "ftr" }))).toBe("ok");
      expect(await code(app, ...entry(`e-${rand()}@example.test`, { role: "root" }))).toBe("23514");
      expect(await code(app, ...entry(`f-${rand()}@example.test`, { status: "gone" }))).toBe("23514");
    });

    it("yourtal_sub is unique, and final once bound", async () => {
      const a = entry(`g-${rand()}@example.test`);
      const b = entry(`h-${rand()}@example.test`);
      await app.query(...a);
      await app.query(...b);
      const sub = `sub-${rand()}`;
      expect(await code(app, "UPDATE god_app.allow_list SET yourtal_sub = $2 WHERE id = $1", [a[1][0], sub])).toBe("ok");
      expect(await code(app, "UPDATE god_app.allow_list SET yourtal_sub = $2 WHERE id = $1", [b[1][0], sub])).toBe("23505");
      expect(await code(app, "UPDATE god_app.allow_list SET yourtal_sub = $2 WHERE id = $1", [a[1][0], `${sub}-other`])).toBe("23001");
    });

    it("sessions: token hash unique and hex, 8-hour absolute limit, revoke pair", async () => {
      const e = entry(`s-${rand()}@example.test`);
      await app.query(...e);
      const uid = e[1][0];
      const hash = randomBytes(32).toString("hex");
      const ins = (h: string, absHours: number) =>
        app.query(
          "INSERT INTO god_app.sessions (token_hash, user_id, created_at, last_seen_at, absolute_expires_at, auth_time, amr) VALUES ($1,$2, now(), now(), now() + make_interval(hours => $3), now(), '{hwk}')",
          [h, uid, absHours],
        );
      const tryIns = (h: string, hrs: number) => ins(h, hrs).then(() => "ok", (x: { code?: string }) => x.code);
      expect(await tryIns(hash, 8)).toBe("ok");
      expect(await tryIns(hash, 8)).toBe("23505");
      expect(await tryIns("not-hex", 8)).toBe("23514");
      expect(await tryIns("b".repeat(64), 9)).toBe("23514");
      expect(await code(app, "UPDATE god_app.sessions SET revoked_at = now() WHERE user_id = $1", [uid])).toBe("23514");
      expect(await code(app, "UPDATE god_app.sessions SET revoked_at = now(), revoked_by = 'x' WHERE user_id = $1", [uid])).toBe("ok");
    });

    it("sessions need a real allow-list entry", async () => {
      const r = await code(
        app,
        "INSERT INTO god_app.sessions (token_hash, user_id, created_at, last_seen_at, absolute_expires_at, auth_time) VALUES (repeat('c', 64), 'no-such-user', now(), now(), now(), now())",
      );
      expect(r).toBe("23503");
    });
  });
});

describe.skipIf(!enabled)("the migration runner against scratch databases", () => {
  let admin: pg.Client;
  const made: string[] = [];
  const tmp: string[] = [];

  async function scratch(): Promise<string> {
    const name = `god_scratch_${rand()}`;
    await admin.query(`CREATE DATABASE ${name} OWNER god_migrator`);
    made.push(name);
    return withDb(MIGRATOR!, name);
  }
  function copyMigrations(): string {
    const d = mkdtempSync(join(tmpdir(), "god-mig-copy-"));
    tmp.push(d);
    cpSync(MIGRATIONS, d, { recursive: true });
    return d;
  }

  beforeAll(async () => {
    admin = await connect(ADMIN!);
  });
  afterAll(async () => {
    for (const n of made) await admin.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`);
    await admin.end();
    for (const d of tmp) rmSync(d, { recursive: true, force: true });
  });

  it("applies everything once, then does nothing", async () => {
    const url = await scratch();
    const first = await migrate(url, { dir: MIGRATIONS });
    expect(first.applied).toEqual(["0001_allow_list_sessions", "0002_audit_log"]);
    const second = await migrate(url, { dir: MIGRATIONS });
    expect(second).toEqual({ applied: [], upToDate: 2 });
    expect((await status(url, { dir: MIGRATIONS })).map((r) => r.state)).toEqual(["applied", "applied"]);
  });

  it("refuses an applied migration that was edited", async () => {
    const url = await scratch();
    const dir = copyMigrations();
    await migrate(url, { dir });
    const f = join(dir, "0002_audit_log.sql");
    writeFileSync(f, readFileSync(f, "utf8") + "\n-- sneaky edit\n");
    await expect(migrate(url, { dir })).rejects.toThrow(/edited after it was applied/);
    expect((await status(url, { dir })).map((r) => r.state)).toEqual(["applied", "changed"]);
  });

  it("refuses when an applied migration's file is gone", async () => {
    const url = await scratch();
    const dir = copyMigrations();
    await migrate(url, { dir });
    rmSync(join(dir, "0002_audit_log.sql"));
    await expect(migrate(url, { dir })).rejects.toThrow(/missing or out of order/);
  });

  it("a failing migration rolls back completely and is not recorded", async () => {
    const url = await scratch();
    const dir = copyMigrations();
    for (const f of readdirSync(dir)) if (f.startsWith("0002")) rmSync(join(dir, f));
    writeFileSync(join(dir, "0002_bad.sql"), "CREATE TABLE god_app.half_done (id int);\nSELECT 1/0;\n");
    await expect(migrate(url, { dir })).rejects.toThrow(/0002_bad.sql failed and was rolled back/);
    const c = await connect(url);
    try {
      expect((await c.query("SELECT to_regclass('god_app.half_done') AS t")).rows[0].t).toBeNull();
      expect((await c.query("SELECT count(*)::int AS n FROM god_app.schema_migrations")).rows[0].n).toBe(1);
    } finally {
      await c.end();
    }
    writeFileSync(join(dir, "0002_bad.sql"), "CREATE TABLE god_app.fixed (id int);\n");
    expect((await migrate(url, { dir })).applied).toEqual(["0002_bad"]);
  });

  it("two runners at once: one applies, the other waits and finds nothing to do", async () => {
    const url = await scratch();
    const [a, b] = await Promise.all([migrate(url, { dir: MIGRATIONS }), migrate(url, { dir: MIGRATIONS })]);
    expect(a.applied.length + b.applied.length).toBe(2);
    expect(Math.min(a.applied.length, b.applied.length)).toBe(0);
  });
});
