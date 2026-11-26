import { fileURLToPath } from "node:url";
import { BreakGlassCliError, issueCode, listKeys, revokeKeys } from "./break-glass.ts";
import { MigrationError, migrate, status } from "./runner.ts";

/**
 * node src/cli.ts [up|status] [--dir <migrations folder>]
 * node src/cli.ts break-glass-code --owner <allow-list entry id>
 * node src/cli.ts break-glass-revoke (--owner <allow-list entry id> | --all)
 * node src/cli.ts break-glass-list
 *
 * Reads GOD_MIGRATE_DATABASE_URL (a god_migrator connection). Exit 0 on success, 1 on a refused or failed
 * command, 2 on bad usage. The deploy script runs `up` from the dashboard image before the container is swapped;
 * the lead runs the break-glass commands on Helios (infra/dashboard/RUNBOOK.md, "Emergency Owner access").
 */
const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith("--") ? args[0] : "up";
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = flag("--dir") ?? fileURLToPath(new URL("../migrations", import.meta.url));
const url = process.env.GOD_MIGRATE_DATABASE_URL;
const COMMANDS = ["up", "status", "break-glass-code", "break-glass-revoke", "break-glass-list"];

function usage(): never {
  console.error(
    [
      "usage: GOD_MIGRATE_DATABASE_URL=postgres://god_migrator:...@host/god_dashboard node src/cli.ts <command>",
      "  up | status [--dir <folder>]                       apply or list the migrations",
      "  break-glass-code --owner <entry id>                a one-time emergency key enrolment code (15 minutes)",
      "  break-glass-revoke (--owner <entry id> | --all)    revoke emergency keys and end emergency sessions",
      "  break-glass-list                                   list the emergency keys",
    ].join("\n"),
  );
  process.exit(2);
}

if (!url || !dir || !COMMANDS.includes(cmd)) usage();

try {
  if (cmd === "status") {
    for (const r of await status(url, { dir })) console.log(`${r.state.padEnd(8)} ${r.file}${r.appliedAt ? `  ${r.appliedAt}` : ""}`);
  } else if (cmd === "up") {
    const r = await migrate(url, { dir, log: (l) => console.log(l) });
    console.log(`migrations: ${r.applied.length} applied, ${r.upToDate} already up to date`);
  } else if (cmd === "break-glass-code") {
    const owner = flag("--owner");
    if (!owner) usage();
    const c = await issueCode(url, owner);
    console.log(`Emergency key enrolment code for ${c.ownerName} (${c.ownerId}):`);
    console.log("");
    console.log(`    ${c.code}`);
    console.log("");
    console.log(`It works once, until ${c.expiresAt} (15 minutes). Read it to the Owner; do not send it by email or chat.`);
  } else if (cmd === "break-glass-revoke") {
    const owner = flag("--owner");
    if (!owner && !args.includes("--all")) usage();
    const r = await revokeKeys(url, owner ? { ownerId: owner } : { all: true });
    console.log(`revoked ${r.keys} emergency ${r.keys === 1 ? "key" : "keys"}; ended ${r.sessions} emergency ${r.sessions === 1 ? "session" : "sessions"}`);
  } else {
    const rows = await listKeys(url);
    if (!rows.length) console.log("no emergency keys");
    for (const k of rows) {
      console.log(`${k.revoked ? "revoked" : "ACTIVE "}  owner ${k.owner}  key ${k.credential}…  added ${k.created}  last used ${k.lastUsed ?? "never"}${k.revoked ? `  revoked ${k.revoked}` : ""}`);
    }
  }
} catch (e) {
  if (e instanceof MigrationError || e instanceof BreakGlassCliError) console.error(`REFUSED: ${e.message}`);
  else console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
