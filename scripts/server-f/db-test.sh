#!/usr/bin/env bash
# Integration tests against a real, throwaway PostgreSQL 18. Runs ON server-f, started by
#   bash scripts/server-f/remote-build.sh <tree> db-test <name>
# which ships the tree, takes the build lock and calls this script. Do not run it on the laptop.
#
# 1. a postgres:18 container on a private docker network (no published port, tmpfs data, random passwords)
# 2. packages/db/roles/setup-roles.sql as the superuser, TWICE (proves it is idempotent), then the two passwords
# 3. in a node:24 container on the same network: pnpm install, the migrations as god_migrator, the migrations
#    again (must be a no-op), the @god/db tests (roles, grants, append-only audit log, the runner), and the
#    dashboard's Postgres store tests (GOD_TEST_DATABASE_URL, as god_app)
# 4. the container and the network are removed, pass or fail
# Ends with DB-TEST-OK.
set -euo pipefail
DEST="${1:?tree dir on server-f}"; NAME="${2:?name}"
BASE=/opt/god-build; NODE_IMAGE=node:24-bookworm; PG_IMAGE=postgres:18
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad name: $NAME" >&2; exit 2; }
NET="god-dbtest-$NAME-$$"; PG="$NET-pg"

cleanup() { docker rm -fv "$PG" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

PW_ADMIN="$(openssl rand -hex 12)"; PW_MIG="$(openssl rand -hex 12)"; PW_APP="$(openssl rand -hex 12)"

echo "== postgres ($PG_IMAGE) on private network $NET"
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" --memory 1g --tmpfs /var/lib/postgresql:rw \
  -e POSTGRES_PASSWORD="$PW_ADMIN" "$PG_IMAGE" -c fsync=off -c max_connections=100 >/dev/null
# The image starts a temporary server (unix socket only) before the real one: wait for TCP.
for i in $(seq 1 60); do
  docker exec "$PG" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "postgres did not start" >&2; docker logs "$PG" | tail -20 >&2; exit 1; }
  sleep 1
done
echo "== $(docker exec "$PG" psql -U postgres -Atc 'select version()')"

SETUP="$DEST/packages/db/roles/setup-roles.sql"
for run in 1 2; do
  echo "== setup-roles.sql, run $run"
  docker exec -i "$PG" psql -U postgres -v ON_ERROR_STOP=1 -q < "$SETUP"
done
docker exec "$PG" psql -U postgres -v ON_ERROR_STOP=1 -q \
  -c "ALTER ROLE god_migrator PASSWORD '$PW_MIG'" -c "ALTER ROLE god_app PASSWORD '$PW_APP'"

echo "== install, migrate, test"
docker run --rm --network "$NET" --cpus 4 --memory 6g -v "$BASE:$BASE" -w "$DEST" \
  -e CI=1 -e npm_config_cache="$BASE/cache/npm" \
  -e GOD_TEST_ADMIN_URL="postgres://postgres:$PW_ADMIN@$PG:5432/postgres" \
  -e GOD_TEST_MIGRATOR_URL="postgres://god_migrator:$PW_MIG@$PG:5432/god_dashboard" \
  -e GOD_TEST_APP_URL="postgres://god_app:$PW_APP@$PG:5432/god_dashboard" \
  -e GOD_TEST_DATABASE_URL="postgres://god_app:$PW_APP@$PG:5432/god_dashboard" \
  -e GOD_MIGRATE_DATABASE_URL="postgres://god_migrator:$PW_MIG@$PG:5432/god_dashboard" \
  "$NODE_IMAGE" bash -euo pipefail -c '
    npm i -g pnpm@12.6.0 --no-audit --no-fund --loglevel=error >/dev/null
    echo "== install (node $(node -v), pnpm $(pnpm -v))"
    pnpm install --no-frozen-lockfile --store-dir '"$BASE"'/store --reporter=append-only \
      --filter @god/db... --filter @god/dashboard... 2>&1 | grep -v "^Progress" | tail -15
    echo "== migrate (first run)";  pnpm --filter @god/db --silent migrate
    echo "== migrate (second run, must apply nothing)"
    pnpm --filter @god/db --silent migrate | tee /tmp/second.txt
    grep -q "0 applied" /tmp/second.txt
    echo "== migrate status";       pnpm --filter @god/db --silent migrate:status
    echo "== @god/db tests";        pnpm --filter @god/db exec vitest run --reporter=verbose
    echo "== dashboard Postgres store tests"
    pnpm --filter @god/dashboard exec vitest run src/server/store/postgres --reporter=verbose
    echo DB-TEST-OK'
