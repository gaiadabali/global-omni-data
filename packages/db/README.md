# @god/db

The dashboard's own Postgres database (`god_dashboard`): allow-list, sessions and the audit log. Versioned SQL
migrations, a small runner, and the role setup. The Postgres stores that use it are in
`apps/dashboard/src/server/store/postgres/`. Tested against a real Postgres 18 on server-f (`db-test`, below).

> **The analytical warehouse (TASKS 9.2.e) is a separate database with separate roles.** It is not in this package and
> not in `god_dashboard`. The dashboard's credentials (`god_app`, `god_migrator`) must never be able to read it, and the
> warehouse's roles must never be able to read this database. Do not add warehouse tables here, and do not grant
> `god_app` anything in another database.

## Roles

| Role | Used by | Can do |
|---|---|---|
| `god_migrator` | the migration runner only | owns the database and schema `god_app`; creates and alters tables, grants to `god_app` |
| `god_app` | the dashboard at runtime (`GOD_DATABASE_URL`) | the table privileges the migrations grant it, and nothing else: no DDL, no temp tables, nothing outside schema `god_app` |

`roles/setup-roles.sql` creates both, the database, and the schema. A superuser runs it once on Helios, and it can be run
again at any time (every statement is idempotent). It holds no password: set them with `\password`.

`god_app` today: `SELECT, INSERT` on `allow_list` and `sessions` plus `UPDATE` on only the columns that change
(`allow_list`: `yourtal_sub, status, last_sign_in`; `sessions`: `last_seen_at, auth_time, amr, revoked_at, revoked_by`),
no `DELETE` anywhere, and on `audit_log` `SELECT` plus `INSERT (who, action, target, reason, outcome)`. On `enquiries`
(0004) `SELECT`, `INSERT (name, company, email, want, budget, ip_prefix)` (the database sets the id, the time and the
status) and `UPDATE (status, handled_by, handled_at)`.

## Tables (schema `god_app`)

- `allow_list`: the `AllowEntry` contract. `email` is unique among entries that are not `removed`; `yourtal_sub` is unique and
  cannot change once bound (trigger); a brand lead has a brand and nobody else does.
- `sessions`: `token_hash` (SHA-256 hex of the cookie token, unique); `absolute_expires_at` may not exceed `created_at + 8 hours`
  (CHECK); partial indexes over live (not revoked) rows serve `listActive`, which applies the 30-minute idle and 8-hour
  absolute rules in SQL.
- `audit_log`: **append-only, enforced in the database.** `god_app` cannot UPDATE, DELETE or TRUNCATE (no privilege), triggers
  refuse them for every role including the owner and a superuser, `seq` is `GENERATED ALWAYS AS IDENTITY`, and the time
  (`occurred_at`, the event's `when`) is set by the database: `god_app` has no INSERT on those two columns. The owner can still
  `DISABLE TRIGGER` or drop the table, which is why the migrator's password is not in the app's environment, and why the
  off-box archive (later) matters.
- `enquiries` (0004): what the public contact form sends. Stored before anyone is emailed. Length and shape CHECKs on every
  field (single-line fields take no control character; the email takes nothing that can add a second address to a mail
  header), a status of `new`, `read` or `archived` kept in step with who and when (CHECK), and a trigger that keeps what
  the visitor sent final for every role. **Retention is a TODO for the founder** (suggested: 24 months, by a job as
  `god_migrator`; `god_app` has no DELETE and must not get one).
- `schema_migrations`: the runner's own table. `god_app` cannot read it.

## Migrations

`migrations/NNNN_name.sql`, numbered from 0001 with no gaps. The runner (`src/runner.ts`, plain TypeScript that Node 24 runs
directly, so the image needs no build step):

- connects as `god_migrator` (`GOD_MIGRATE_DATABASE_URL`), takes an advisory lock (two runners never overlap), and applies each
  pending file **in its own transaction**, recording `version, name, checksum` in `god_app.schema_migrations`;
- **refuses an edited migration**: the SHA-256 of an applied file (line endings normalised) must match what was recorded. It also
  refuses a missing applied file and a gap in the numbering. Fix mistakes with a new migration, never by editing an old one;
- rejects `BEGIN`/`COMMIT`/`ROLLBACK` inside a file (the runner owns the transaction), so `CREATE INDEX CONCURRENTLY` cannot be
  used here. For a big table, do that by hand and record it in a migration comment.

```bash
GOD_MIGRATE_DATABASE_URL=postgres://god_migrator:...@127.0.0.1:5432/god_dashboard node src/cli.ts up      # apply
GOD_MIGRATE_DATABASE_URL=...                                                      node src/cli.ts status  # applied | pending | changed | missing
```

Migrations are forward-only. The deploy script runs them before the container is swapped, so a migration must work with the
code that is still running (add, do not drop or rename in the same release).

## Tests

`pnpm test` runs the unit tests (file loading, checksums, numbering) anywhere. The integration tests
(`src/schema.integration.test.ts`: roles, grants, append-only audit log, the runner on scratch databases) skip unless
`GOD_TEST_ADMIN_URL`, `GOD_TEST_MIGRATOR_URL` and `GOD_TEST_APP_URL` are set. On server-f:

```bash
bash scripts/server-f/remote-build.sh <tree> db-test <name>     # throwaway postgres:18, roles, migrations (twice), @god/db + store tests
```
