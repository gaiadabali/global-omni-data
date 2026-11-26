import { fileURLToPath } from "node:url";
import { MigrationError, migrate, status } from "./runner.ts";

/**
 * node src/cli.ts [up|status] [--dir <migrations folder>]
 *
 * Reads GOD_MIGRATE_DATABASE_URL (a god_migrator connection). Exit 0 on success, 1 on a refused or failed
 * migration, 2 on bad usage. The deploy script runs this from the dashboard image before the container is swapped.
 */
const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith("--") ? args[0] : "up";
const dirFlag = args.indexOf("--dir");
const dir = dirFlag >= 0 ? args[dirFlag + 1] : fileURLToPath(new URL("../migrations", import.meta.url));
const url = process.env.GOD_MIGRATE_DATABASE_URL;

if (!url || !dir || (cmd !== "up" && cmd !== "status")) {
  console.error("usage: GOD_MIGRATE_DATABASE_URL=postgres://god_migrator:...@host/god_dashboard node src/cli.ts [up|status] [--dir <folder>]");
  process.exit(2);
}

try {
  if (cmd === "status") {
    for (const r of await status(url, { dir })) console.log(`${r.state.padEnd(8)} ${r.file}${r.appliedAt ? `  ${r.appliedAt}` : ""}`);
  } else {
    const r = await migrate(url, { dir, log: (l) => console.log(l) });
    console.log(`migrations: ${r.applied.length} applied, ${r.upToDate} already up to date`);
  }
} catch (e) {
  console.error(e instanceof MigrationError ? `REFUSED: ${e.message}` : `FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
