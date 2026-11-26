#!/usr/bin/env bash
# Publish the built public site to Helios (god.gaiada.com, CloudPanel static site, user ugod).
#
#   PUBLIC_NOINDEX=1 bash scripts/server-f/remote-build.sh <tree> site <name>   # staging build on server-f
#   bash scripts/deploy/site-to-helios.sh <name>                                 # then publish it
#
# The built files stream from server-f through this machine to Helios; nothing is built on the laptop or on
# Helios. The new release is unpacked beside the docroot and swapped in with two renames, so a visitor never
# sees a half-copied site. The previous release is kept as <docroot>.prev for a quick roll-back:
#   ssh helios 'cd /home/ugod/htdocs && mv god.gaiada.com god.gaiada.com.bad && mv god.gaiada.com.prev god.gaiada.com'
set -euo pipefail
NAME="${1:?name of the build on server-f}"
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad name" >&2; exit 2; }
SRC="/opt/god-build/src/$NAME/apps/site/dist"
HOME_DIR=/home/ugod/htdocs; SITE=god.gaiada.com; OWNER=ugod

ssh server-f "test -f '$SRC/index.html'" || { echo "no build at server-f:$SRC" >&2; exit 1; }
echo "== $SRC -> helios:$HOME_DIR/$SITE"
ssh server-f "tar -C '$SRC' -czf - ." | ssh helios "set -e; cd '$HOME_DIR'; rm -rf '$SITE.new'; mkdir '$SITE.new';
  tar -xzf - -C '$SITE.new'; test -f '$SITE.new/index.html'; chown -R $OWNER:$OWNER '$SITE.new';
  find '$SITE.new' -type d -exec chmod 755 {} +; find '$SITE.new' -type f -exec chmod 644 {} +;
  rm -rf '$SITE.prev'; if [ -d '$SITE' ]; then mv '$SITE' '$SITE.prev'; fi; mv '$SITE.new' '$SITE';
  echo \"== live: \$(find '$SITE' -type f | wc -l) files\""
