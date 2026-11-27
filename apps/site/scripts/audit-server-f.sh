#!/usr/bin/env bash
# Run apps/site/scripts/audit.mjs on server-f in a throwaway Playwright container. Nothing is installed in the repo
# or on the laptop: Lighthouse and axe go into /opt/god-build/tmp/site-audit-tools on the box.
#
#   bash apps/site/scripts/audit-server-f.sh <target> <out-name> [audit.mjs flags]
#
#   target    https://god.gaiada.com, or a built dist folder already on server-f
#             (for example /opt/god-build/src/god-site-audit/apps/site/dist)
#   out-name  the JSON lands at /opt/god-build/tmp/<out-name>.json and is copied to ./<out-name>.json
set -euo pipefail
TARGET="${1:?target url or dist dir on server-f}"; OUT="${2:?out name}"; shift 2
HOST="${GOD_BUILD_HOST:-server-f}"; BASE=/opt/god-build; TOOLS=$BASE/tmp/site-audit-tools
PW=1.65.1; LH=13.6.0; AXE=4.14.1
[[ "$OUT" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad out name" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
ssh "$HOST" "mkdir -p $TOOLS" && scp -q "$HERE/audit.mjs" "$HOST:$TOOLS/audit.mjs"
ssh "$HOST" "flock -w 1800 $BASE/build.lock docker run --rm --cpus 4 --memory 6g --ipc=host -v $BASE:$BASE -w $TOOLS \
  -e npm_config_cache=$BASE/cache/npm mcr.microsoft.com/playwright:v$PW-noble bash -euo pipefail -c '
    [ -d node_modules/lighthouse ] || { echo \"{\\\"type\\\":\\\"module\\\",\\\"private\\\":true}\" > package.json
      npm i --no-audit --no-fund --loglevel=error --save-exact lighthouse@$LH @axe-core/playwright@$AXE playwright@$PW chrome-launcher@1.2.3; }
    node audit.mjs $TARGET $BASE/tmp/$OUT.json $*'"
ssh "$HOST" "cat $BASE/tmp/$OUT.json" > "./$OUT.json"
echo "== ./$OUT.json"
