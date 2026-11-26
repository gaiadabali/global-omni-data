#!/usr/bin/env bash
# Build the dashboard image on server-f and run it on Helios (dashboard.god.gaiada.com, staging).
#
#   bash scripts/server-f/remote-build.sh <tree> dashboard <name>        # 1. the gate: must end BUILD-OK (commit pnpm-lock.yaml if it changed)
#   bash scripts/deploy/dashboard-to-helios.sh <name> build              # 2. docker build on server-f + a smoke test of the image. Nothing leaves server-f.
#   bash scripts/deploy/dashboard-to-helios.sh <name>                    # 3. build (if needed), ship, migrate, swap      ("all")
#   bash scripts/deploy/dashboard-to-helios.sh <name> ship               #    ship, migrate, swap an image you already built
#   bash scripts/deploy/dashboard-to-helios.sh rollback                  # 4. go back to the previous image (the database is NOT rolled back)
#
# <name> is the build folder on server-f (/opt/god-build/src/<name>), the same name you gave remote-build.sh.
# The image tag is the git sha of THIS tree (plus "-dirty" when it has uncommitted changes; a dirty tree builds but
# will not ship unless ALLOW_DIRTY=1). Ship the same tree you built: the image is built from the folder on server-f.
#
# Order of a deploy, and why:
#   a. build on server-f under the build lock (never on the laptop or Helios), then smoke-test the image there
#   b. docker save | ssh helios docker load, streamed through this machine (server-f cannot reach Helios)
#   c. on Helios: pg_dump of god_dashboard to /var/backups/god-dashboard, then the migrations as god_migrator
#      (a one-off container of the NEW image, so the SQL and the code always match), then swap the container
#   d. wait for /healthz to answer with the new build sha. If it does not, the previous image is started again
#      and the script exits 1. The tags of the running and the previous image are kept in /opt/god-dashboard.
# Migrations run BEFORE the swap and are forward-only, so each one must keep working with the code that is still
# running (add columns and tables; never drop or rename in the same release). See infra/dashboard/RUNBOOK.md.
#
# Needs on Helios (the runbook creates them): /etc/god-dashboard/dashboard.env and migrate.env, the database,
# docker with the compose plugin. Environment: GOD_PORT (default 3120, must match the nginx vhost), HELIOS_SSH
# (default "helios"), BUILD_HOST (default "server-f").
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_HOST="${BUILD_HOST:-server-f}"; HELIOS="${HELIOS_SSH:-helios}"; PORT="${GOD_PORT:-3120}"
BASE=/opt/god-build
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || die "bad GOD_PORT"

if [ "${1:-}" = rollback ]; then
  echo "== rollback on $HELIOS"
  ssh "$HELIOS" "bash /opt/god-dashboard/remote.sh rollback '' '$PORT'"
  exit $?
fi

NAME="${1:?usage: dashboard-to-helios.sh <name> [build|ship|all]   or   dashboard-to-helios.sh rollback}"
ACTION="${2:-all}"
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad name"
case "$ACTION" in build|ship|all) ;; *) die "action must be build, ship or all" ;; esac

TAG="$(git -C "$ROOT" rev-parse --short=12 HEAD)"
DIRTY=""; [ -n "$(git -C "$ROOT" status --porcelain)" ] && DIRTY=1 && TAG="$TAG-dirty"
IMG="god-dashboard:$TAG"; SRC="$BASE/src/$NAME"

do_build() {
  ssh "$BUILD_HOST" "test -f '$SRC/apps/dashboard/Dockerfile'" || die "no build folder at $BUILD_HOST:$SRC (run remote-build.sh first)"
  [ -z "$DIRTY" ] || echo "warning: uncommitted changes in $ROOT; the image is tagged $TAG"
  echo "== docker build $IMG on $BUILD_HOST (waits for the build lock)"
  ssh "$BUILD_HOST" "flock -w 1800 $BASE/build.lock docker build -f '$SRC/apps/dashboard/Dockerfile' \
    --build-arg GIT_SHA='$TAG' -t '$IMG' '$SRC'"
  echo "== image $IMG: $(ssh "$BUILD_HOST" "docker image inspect -f '{{.Size}}' '$IMG'" | awk '{printf "%.0f MB (uncompressed)", $1/1048576}')"
  smoke
}

# Start the image the way compose will (non-root, read-only, no capabilities), with no database, and look at it.
smoke() {
  echo "== smoke test of $IMG on $BUILD_HOST"
  ssh "$BUILD_HOST" bash -s -- "$IMG" "$TAG" <<'SMOKE'
set -euo pipefail
IMG=$1; TAG=$2; C="god-dash-smoke-$$"
trap 'docker rm -f "$C" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$C" --read-only --tmpfs /tmp --tmpfs /app/apps/dashboard/.next/cache:uid=1000,gid=1000,mode=0755 \
  --cap-drop ALL --security-opt no-new-privileges --memory 640m -e NODE_OPTIONS=--max-old-space-size=384 \
  -e GOD_DEV_AUTH=1 -e GOD_DEPLOYMENT=dev -p 127.0.0.1::3000 "$IMG" >/dev/null
PORT="$(docker port "$C" 3000/tcp | head -1 | sed 's/.*://')"
for i in $(seq 1 60); do
  body="$(curl -fsS -m 3 "http://127.0.0.1:$PORT/healthz" 2>/dev/null || true)"; [ -n "$body" ] && break
  [ "$i" = 60 ] && { echo "no /healthz answer in 60 s" >&2; docker logs --tail 40 "$C" >&2; exit 1; }
  sleep 1
done
echo "   /healthz: $body"
case "$body" in *"\"build\":\"$TAG\""*) ;; *) echo "   build sha missing from /healthz" >&2; exit 1 ;; esac
echo "   runs as uid $(docker exec "$C" id -u) (must not be 0)"; [ "$(docker exec "$C" id -u)" != 0 ]
curl -fsS -m 10 -o /dev/null -D - "http://127.0.0.1:$PORT/signin" | tr -d '\r' | grep -i -E '^(HTTP|content-security-policy:|x-frame-options)' | cut -c1-120 | sed 's/^/   /'
for i in $(seq 1 30); do
  h="$(docker inspect -f '{{.State.Health.Status}}' "$C")"; [ "$h" = healthy ] && break
  [ "$i" = 30 ] && { echo "   docker health stayed '$h'" >&2; exit 1; }
  sleep 2
done
echo "   docker health: $h"
echo "   memory: $(docker stats --no-stream --format '{{.MemUsage}}' "$C")"
set +e; docker run --rm --entrypoint node "$IMG" /app/db/src/cli.ts >/dev/null 2>&1; rc=$?; set -e
echo "   migration runner present, usage exit code $rc (2 expected)"; [ "$rc" = 2 ]
echo SMOKE-OK
SMOKE
}

do_ship() {
  [ -z "$DIRTY" ] || [ "${ALLOW_DIRTY:-}" = 1 ] || die "tree has uncommitted changes; commit, or set ALLOW_DIRTY=1"
  ssh "$BUILD_HOST" "docker image inspect '$IMG' >/dev/null" || die "no image $IMG on $BUILD_HOST: run the build step"
  echo "== compose.yaml -> $HELIOS:/opt/god-dashboard"
  ssh "$HELIOS" "mkdir -p /opt/god-dashboard && cat > /opt/god-dashboard/compose.yaml.new && mv /opt/god-dashboard/compose.yaml.new /opt/god-dashboard/compose.yaml" \
    < "$ROOT/infra/dashboard/compose.yaml"
  echo "== $IMG: $BUILD_HOST -> this machine -> $HELIOS (docker save | docker load)"
  ssh "$BUILD_HOST" "docker save '$IMG' | gzip -1" | ssh "$HELIOS" "gunzip | docker load"
  echo "== migrate and swap on $HELIOS"
  ssh "$HELIOS" "bash /opt/god-dashboard/remote.sh deploy '$TAG' '$PORT'"
}

case "$ACTION" in
  build) do_build ;;
  ship) do_ship ;;
  all) do_build; do_ship ;;
esac
