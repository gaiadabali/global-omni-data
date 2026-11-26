#!/usr/bin/env bash
# Check, build and screenshot a working tree on server-f, inside throwaway containers.
# Owner rule: no GitHub Actions, and no installs or builds on the laptop. server-f also runs the ERP, so one
# build runs at a time (a lock on the box) and each container is capped at 4 CPUs / 6 GB.
#
#   bash scripts/server-f/remote-build.sh <tree-dir> <target> [name]
#
#   target   site | dashboard | all      pnpm install, then turbo typecheck + lint + test + build for that app
#                                         and the workspace packages it uses ("all" = every package)
#            shots-site | shots-dashboard the same build, then screenshots of every route listed in
#                                         tools/shots/routes.<app>.json (Playwright, Chromium)
#            db-test                      no turbo build: starts a throwaway postgres:18 on a private docker network,
#                                         applies packages/db roles + migrations, runs the @god/db and the dashboard
#                                         Postgres store tests, removes it all (scripts/server-f/db-test.sh). Ends DB-TEST-OK.
#            geo-data                     rebuild packages/geo/data from the ABS downloads: installs @god/geo only and
#                                         runs `pnpm --filter @god/geo run build:data` in the same node:24 container
#                                         (downloads are cached under $BASE/cache/abs on the box). No typecheck, test
#                                         or build runs.
#   name     folder on server-f (default: the tree's folder name). Use a distinct name per worktree.
#
# What comes back to <tree-dir>:
#   pnpm-lock.yaml    rewritten whenever the install changed it. Commit it with the package.json change.
#   .shots/<app>/     PNGs plus report.json (console errors, failed requests). Gitignored.
#   packages/geo/data/  (geo-data only) the regenerated boundary, suburb and population files. Commit them.
# The exit code is the build's.
set -euo pipefail
TREE="${1:?tree dir}"; TARGET="${2:?target}"
TREE="$(cd "$TREE" && pwd)"; NAME="${3:-$(basename "$TREE")}"
case "$TARGET" in
  site|dashboard|all) APP="$TARGET"; SHOTS="" ;;
  shots-site) APP=site; SHOTS=site ;;
  shots-dashboard) APP=dashboard; SHOTS=dashboard ;;
  db-test) APP=dashboard; SHOTS="" ;;
  geo-data) APP=geo; SHOTS="" ;;
  *) echo "target must be site, dashboard, all, shots-site, shots-dashboard, db-test or geo-data" >&2; exit 2 ;;
esac
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad name: $NAME" >&2; exit 2; }
HOST="${GOD_BUILD_HOST:-server-f}"; BASE=/opt/god-build; DEST="$BASE/src/$NAME"
NODE_IMAGE=node:24-bookworm
case "$APP" in site) FILTER="--filter=@god/site..." ;; dashboard) FILTER="--filter=@god/dashboard..." ;; *) FILTER="" ;; esac
# What runs after the install. geo-data installs only @god/geo and runs its data pipeline.
if [ "$APP" = geo ]; then
  INSTALL_FILTER="--filter @god/geo..."
  STEPS="echo \"== build the geo data\"; NODE_OPTIONS=--max-old-space-size=4096 GOD_ABS_CACHE=$BASE/cache/abs pnpm --filter @god/geo run build:data"
else
  INSTALL_FILTER=""
  STEPS="echo \"== typecheck, lint, test, build $FILTER\"; pnpm exec turbo run typecheck lint test build $FILTER --output-logs=errors-only"
fi

cd "$TREE"
echo "== shipping $TREE to $HOST:$DEST"
git ls-files -co --exclude-standard -z | grep -zv -e '/node_modules/' -e '^node_modules/' \
  | tar --null -T - -czf - \
  | ssh "$HOST" "rm -rf '$DEST' && mkdir -p '$DEST' $BASE/store $BASE/cache/npm && tar -xzf - -C '$DEST'"

# Build-time switches pass through from the caller's environment (values must be plain: letters, digits, : / . _ -).
PASS=""
for v in PUBLIC_NOINDEX PUBLIC_CONTACT_ENDPOINT; do
  val="${!v:-}"
  [ -z "$val" ] && continue
  [[ "$val" =~ ^[A-Za-z0-9:/._-]+$ ]] || { echo "bad value for $v" >&2; exit 2; }
  PASS="$PASS -e $v=$val"; echo "== passing $v=$val"
done

# One build at a time on the box; wait up to 30 minutes for the lock.
if [ "$TARGET" = db-test ]; then
  ssh "$HOST" "flock -w 1800 $BASE/build.lock bash '$DEST/scripts/server-f/db-test.sh' '$DEST' '$NAME'"
else
ssh "$HOST" "flock -w 1800 $BASE/build.lock docker run --rm --cpus 4 --memory 6g $PASS \
  -v $BASE:$BASE -w '$DEST' -e CI=1 -e NEXT_TELEMETRY_DISABLED=1 -e ASTRO_TELEMETRY_DISABLED=1 \
  -e TURBO_TELEMETRY_DISABLED=1 -e npm_config_cache=$BASE/cache/npm \
  $NODE_IMAGE bash -euo pipefail -c '
    npm i -g pnpm@12.6.0 --no-audit --no-fund --loglevel=error >/dev/null
    echo \"== install (node \$(node -v), pnpm \$(pnpm -v))\"
    pnpm install --no-frozen-lockfile $INSTALL_FILTER --store-dir $BASE/store --reporter=append-only 2>&1 | grep -v \"^Progress\" | tail -25
    $STEPS
    echo BUILD-OK'"
fi

# Bring the lockfile back when the install changed it.
if ssh "$HOST" "test -f '$DEST/pnpm-lock.yaml'"; then
  ssh "$HOST" "cat '$DEST/pnpm-lock.yaml'" > "$TREE/pnpm-lock.yaml.remote"
  if ! cmp -s "$TREE/pnpm-lock.yaml.remote" "$TREE/pnpm-lock.yaml" 2>/dev/null; then
    mv "$TREE/pnpm-lock.yaml.remote" "$TREE/pnpm-lock.yaml"; echo "== pnpm-lock.yaml updated: commit it"
  else
    rm -f "$TREE/pnpm-lock.yaml.remote"
  fi
fi

if [ "$APP" = geo ]; then
  mkdir -p packages/geo
  ssh "$HOST" "tar -C '$DEST/packages/geo' -czf - data" | tar -xzf - -C packages/geo
  echo "== packages/geo/data refreshed in $TREE: commit it"
fi

if [ -n "$SHOTS" ]; then
  PW="$(sed -n 's/.*"playwright": *"\([0-9.]*\)".*/\1/p' tools/shots/package.json | head -1)"
  [ -n "$PW" ] || { echo "no playwright version in tools/shots/package.json" >&2; exit 2; }
  echo "== screenshots ($SHOTS, Playwright $PW)"
  ssh "$HOST" "flock -w 1800 $BASE/build.lock docker run --rm --cpus 4 --memory 6g --ipc=host \
    -v $BASE:$BASE -w '$DEST' -e NEXT_TELEMETRY_DISABLED=1 \
    mcr.microsoft.com/playwright:v$PW-noble node tools/shots/run.mjs $SHOTS"
  rm -rf ".shots/$SHOTS"; mkdir -p .shots
  ssh "$HOST" "tar -C '$DEST/.shots' -czf - '$SHOTS'" | tar -xzf - -C .shots
  echo "== screenshots in $TREE/.shots/$SHOTS"
fi
