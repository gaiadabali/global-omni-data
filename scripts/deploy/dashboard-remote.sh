#!/usr/bin/env bash
# Runs ON Helios, as root. dashboard-to-helios.sh copies it to /opt/god-dashboard/remote.sh and runs it
# (not meant to be run by hand):
#   bash /opt/god-dashboard/remote.sh deploy <tag> <port>
#   bash /opt/god-dashboard/remote.sh rollback "" <port>
#
# deploy:   back up the database, run the migrations as god_migrator from the new image, swap the container,
#           wait for /healthz to report the new build, and put the previous image back if it does not.
# rollback: start the image recorded in previous.tag. Migrations are forward-only and are not undone.
set -euo pipefail
MODE="${1:?mode}"; TAG="${2:-}"; PORT="${3:?port}"
DIR=/opt/god-dashboard; CONF=/etc/god-dashboard; BACKUPS=/var/backups/god-dashboard
COMPOSE=(docker compose -f "$DIR/compose.yaml")
die() { echo "error: $*" >&2; exit 1; }
say() { echo "   $*"; }

current() { cat "$DIR/current.tag" 2>/dev/null || true; }
previous() { cat "$DIR/previous.tag" 2>/dev/null || true; }

# Start <tag> and wait up to 90 s for /healthz to answer with that build.
run_and_wait() {
  local tag=$1
  GOD_IMAGE_TAG=$tag GOD_PORT=$PORT "${COMPOSE[@]}" up -d --remove-orphans
  for i in $(seq 1 45); do
    if curl -fsS -m 3 "http://127.0.0.1:$PORT/healthz" 2>/dev/null | grep -q "\"build\":\"$tag\""; then
      say "/healthz answers with build $tag after ~$((i * 2)) s; docker health: $(docker inspect -f '{{.State.Health.Status}}' god-dashboard 2>/dev/null || echo unknown)"
      return 0
    fi
    sleep 2
  done
  return 1
}

docker compose version >/dev/null 2>&1 || die "docker compose plugin missing on this host"
[ -f "$DIR/compose.yaml" ] || die "$DIR/compose.yaml missing"

if [ "$MODE" = rollback ]; then
  PREV="$(previous)"; CUR="$(current)"
  [ -n "$PREV" ] || die "no previous.tag: nothing to roll back to"
  docker image inspect "god-dashboard:$PREV" >/dev/null 2>&1 || die "image god-dashboard:$PREV is no longer on this host"
  say "rolling back $CUR -> $PREV (database migrations stay applied)"
  run_and_wait "$PREV" || { docker logs --tail 40 god-dashboard >&2 || true; die "previous image $PREV did not come up"; }
  echo "$PREV" > "$DIR/current.tag"; echo "$CUR" > "$DIR/previous.tag"
  echo "ROLLED-BACK to $PREV"
  exit 0
fi

[ "$MODE" = deploy ] || die "unknown mode $MODE"
[[ "$TAG" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad tag"
docker image inspect "god-dashboard:$TAG" >/dev/null 2>&1 || die "image god-dashboard:$TAG was not loaded"
for f in dashboard.env migrate.env; do
  [ -f "$CONF/$f" ] || die "$CONF/$f is missing (infra/dashboard/RUNBOOK.md, step 3)"
  [ "$(stat -c %a "$CONF/$f")" = 600 ] || die "$CONF/$f must be mode 600"
done
# The port must be free, or held by our own container (which compose replaces).
if ss -ltnH "sport = :$PORT" | grep -q . && ! docker ps --format '{{.Names}}' | grep -qx god-dashboard; then
  die "port $PORT is taken by another process (set GOD_PORT, and the same port in the nginx vhost)"
fi

echo "== 1/4 database backup"
install -d -m 700 "$BACKUPS"
if runuser -u postgres -- psql -Atc "select 1 from pg_database where datname = 'god_dashboard'" | grep -q 1; then
  OUT="$BACKUPS/pre-$TAG-$(date -u +%Y%m%dT%H%M%SZ).dump"
  runuser -u postgres -- pg_dump -Fc god_dashboard > "$OUT"
  chmod 600 "$OUT"; say "$OUT ($(du -h "$OUT" | cut -f1))"
  ls -1t "$BACKUPS"/pre-*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f
else
  die "database god_dashboard does not exist (runbook step 2)"
fi

echo "== 2/4 migrations as god_migrator (image $TAG)"
docker run --rm --network host --env-file "$CONF/migrate.env" --read-only --cap-drop ALL \
  --security-opt no-new-privileges --entrypoint node "god-dashboard:$TAG" /app/db/src/cli.ts up

echo "== 3/4 swap the container"
PREV="$(current)"
if run_and_wait "$TAG"; then
  [ -n "$PREV" ] && [ "$PREV" != "$TAG" ] && echo "$PREV" > "$DIR/previous.tag"
  echo "$TAG" > "$DIR/current.tag"
else
  echo "error: $TAG did not become healthy" >&2
  docker logs --tail 40 god-dashboard >&2 || true
  if [ -n "$PREV" ] && [ "$PREV" != "$TAG" ] && docker image inspect "god-dashboard:$PREV" >/dev/null 2>&1; then
    say "putting $PREV back"
    run_and_wait "$PREV" && echo "ROLLED-BACK to $PREV (deploy of $TAG failed)" >&2 || echo "previous image $PREV did not come up either" >&2
  fi
  exit 1
fi

echo "== 4/4 tidy old images (keep the newest 3, the running and the previous one)"
KEEP="$(current) $(previous)"
docker images --format '{{.Tag}}' god-dashboard | tail -n +4 | while read -r t; do
  case " $KEEP " in *" $t "*) ;; *) docker rmi "god-dashboard:$t" >/dev/null 2>&1 && say "removed god-dashboard:$t" ;; esac
done
echo "DEPLOY-OK $TAG (previous: ${PREV:-none})"
