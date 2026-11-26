import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "./types";

/**
 * The audit actions the code writes and the CHECK on god_app.audit_log must be the same list. When they were not
 * (0002 lacked signin.ok, signin.fresh and signout), a real sign-in failed at its audit event in Postgres while every
 * memory-store test passed. This reads the latest migration that sets the CHECK and compares.
 */
const MIGRATIONS = fileURLToPath(new URL("../../../../../packages/db/migrations", import.meta.url));

function latestCheck(): string[] {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let found: string[] | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    // 0002: the column CHECK; 0003 on: ADD CONSTRAINT audit_log_action_check CHECK (action IN (...)).
    const m =
      /ADD CONSTRAINT audit_log_action_check CHECK \(action IN \(([^)]*)\)\)/.exec(sql) ??
      /action\s+text NOT NULL CHECK \(action IN\s*\(([^)]*)\)\)/.exec(sql);
    if (m) found = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
  }
  if (!found) throw new Error("no audit_log action CHECK found in the migrations");
  return found;
}

describe("audit actions", () => {
  it("are exactly the ones the database CHECK allows", () => {
    expect([...latestCheck()].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });
});
