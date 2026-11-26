#!/usr/bin/env bash
# Nightly dump of the dashboard database on Helios. Install per infra/dashboard/RUNBOOK.md step 9:
#   install -m 755 backup.sh /usr/local/sbin/god-dashboard-backup
#   echo '17 2 * * * root /usr/local/sbin/god-dashboard-backup' > /etc/cron.d/god-dashboard-backup
#
# Custom-format pg_dump of god_dashboard (allow-list, sessions, audit log) into /var/backups/god-dashboard, mode 600,
# checked with pg_restore --list, 14 nightly dumps kept. The dashboard deploy script also writes a pre-<tag> dump
# before every migration (kept separately, 14 of those).
# TODO(lead): this is the SAME DISK. Helios has no off-box backup path that is verified working (the other apps'
# copies on this box stay on the box too). The audit log is the record that matters most: copy these dumps off the box
# (the GCS bucket gaiada_backups, or sumopod over sftp) as soon as a working path exists. Until then, a disk loss
# loses this database.
set -euo pipefail
DIR=/var/backups/god-dashboard; DB=god_dashboard; KEEP=14
install -d -m 700 "$DIR"
OUT="$DIR/nightly-$(date -u +%Y%m%dT%H%M%SZ).dump"
runuser -u postgres -- pg_dump -Fc "$DB" > "$OUT.part"
chmod 600 "$OUT.part"
pg_restore --list "$OUT.part" >/dev/null   # a dump that cannot be listed is not a backup
mv "$OUT.part" "$OUT"
ls -1t "$DIR"/nightly-*.dump | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
