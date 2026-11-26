import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MigrationError, checksumOf, loadMigrations } from "./runner.ts";

const dirs: string[] = [];
function folder(files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), "god-mig-"));
  dirs.push(d);
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(d, name), sql);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadMigrations (no database)", () => {
  it("reads the real migrations in order with checksums", () => {
    const real = loadMigrations(fileURLToPath(new URL("../migrations", import.meta.url)));
    expect(real.map((m) => m.file)).toEqual(["0001_allow_list_sessions.sql", "0002_audit_log.sql"]);
    for (const m of real) expect(m.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes CRLF and LF the same", () => {
    expect(checksumOf("select 1;\r\nselect 2;\r\n")).toBe(checksumOf("select 1;\nselect 2;\n"));
    expect(checksumOf("select 1;")).not.toBe(checksumOf("select 2;"));
  });

  it("refuses a gap, a repeat and a bad name", () => {
    expect(() => loadMigrations(folder({ "0001_a.sql": "select 1;", "0003_c.sql": "select 3;" }))).toThrow(MigrationError);
    expect(() => loadMigrations(folder({ "0001_a.sql": "select 1;", "0001_b.sql": "select 2;" }))).toThrow(/without gaps/);
    expect(() => loadMigrations(folder({ "1_a.sql": "select 1;" }))).toThrow(/bad migration file name/);
    expect(() => loadMigrations(folder({ "0001_Caps.sql": "select 1;" }))).toThrow(/bad migration file name/);
  });

  it("refuses transaction control, which the runner owns", () => {
    expect(() => loadMigrations(folder({ "0001_a.sql": "BEGIN;\nselect 1;\nCOMMIT;" }))).toThrow(/no BEGIN/);
  });

  it("allows END; inside a function body", () => {
    const sql = "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN 1;\nEND;\n$$;";
    expect(loadMigrations(folder({ "0001_f.sql": sql }))).toHaveLength(1);
  });

  it("ignores files that are not .sql", () => {
    expect(loadMigrations(folder({ "0001_a.sql": "select 1;", "README.md": "x" }))).toHaveLength(1);
  });
});
