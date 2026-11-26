# Dashboard on Helios: runbook (staging, dashboard.god.gaiada.com)

For the lead, step by step. The dashboard is one container (`god-dashboard`, `node:24-bookworm-slim`, non-root) bound to
`127.0.0.1:3120`, behind nginx, talking to Helios's native PostgreSQL 18 on `127.0.0.1:5432`. It still reports on
synthetic data; its own state (allow-list, sessions, audit log) is in its own database `god_dashboard`.

Anything marked **[UNVERIFIED]** was not checked on Helios: this runbook was written without touching the box. Check it
before relying on it.

Files in this folder: `compose.yaml` (how it runs), `nginx.dashboard.god.gaiada.com.conf` (the vhost), `backup.sh`
(nightly dump). Scripts: `scripts/deploy/dashboard-to-helios.sh` (the deploy, run from the laptop),
`scripts/deploy/dashboard-remote.sh` (its Helios half). Database: `packages/db` (`roles/setup-roles.sql`, `migrations/`).

## What goes where on Helios

| Path | What | Owner, mode |
|---|---|---|
| `/etc/god-dashboard/dashboard.env` | the app's environment, with secrets | root:root, **600** |
| `/etc/god-dashboard/migrate.env` | `GOD_MIGRATE_DATABASE_URL` for the migrator role | root:root, **600** |
| `/opt/god-dashboard/` | `compose.yaml`, `remote.sh`, `current.tag`, `previous.tag` (written by the deploy script) | root |
| `/var/backups/god-dashboard/` | `pre-<tag>-*.dump` before each deploy, `nightly-*.dump` | root, 700 |
| `/etc/nginx/sites-available/dashboard.god.gaiada.com.conf` | the vhost | root |
| `/var/www/certbot` | webroot for the certificate challenge | root |

## Why host networking

The container uses `network_mode: host`. With the default bridge it could only reach Postgres if Postgres listened on the
docker bridge address and `pg_hba.conf` allowed that subnet: a `listen_addresses` change (which needs a restart) on a
shared production database server, for one small app. With host networking the app connects to `127.0.0.1` like any local
client and Postgres is not touched. The app itself binds `127.0.0.1:3120` (`HOSTNAME=127.0.0.1` in `compose.yaml`), so the
port is never reachable from outside. The price is a shared loopback, so the container is held down: non-root, read-only
root filesystem, all capabilities dropped, `no-new-privileges`, 640 MB and 1 CPU, and a database role that can touch nothing
outside schema `god_app`.

## Step 1. Check the box

```bash
ssh helios
docker --version && docker compose version          # the compose PLUGIN must be there. If not: apt install docker-compose-plugin
psql --version; runuser -u postgres -- psql -Atc 'show server_version; show listen_addresses; show port;'   # expect 18.x, localhost, 5432   [UNVERIFIED]
ss -ltnH 'sport = :3120' | wc -l                      # 0 = port 3120 is free. If not, pick another and use it in step 5 and in the vhost (GOD_PORT)   [UNVERIFIED]
nginx -v; ls /etc/nginx/sites-enabled | head; command -v certbot   # nginx 1.25.1 or newer (the vhost uses "http2 on")   [UNVERIFIED]
dig +short god.gaiada.com                             # the address dashboard.god.gaiada.com must also point to
```

DNS: create an A record `dashboard.god.gaiada.com` → the same address as `god.gaiada.com` (Helios). Do this before step 4.

## Step 2. Create the database and roles (once, as postgres)

```bash
# from the laptop: copy the file (it holds no password)
scp packages/db/roles/setup-roles.sql helios:/root/god-setup-roles.sql
# on Helios
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -f /root/god-setup-roles.sql
runuser -u postgres -- psql -c '\password god_migrator'      # type a long random password (openssl rand -hex 24)
runuser -u postgres -- psql -c '\password god_app'           # a different one
runuser -u postgres -- psql -c '\du god_*' -c '\l god_dashboard'
```

The file is idempotent: running it again changes nothing. It creates `god_migrator` (owns the database and the schema
`god_app`; used only by the migration runner) and `god_app` (the runtime role: no DDL, no superuser, connection limit 20),
the database `god_dashboard` (no access for PUBLIC), and the schema. Table grants to `god_app` come from the migrations.
Use hex passwords: they go into a URL unescaped.

**Recommended, [UNVERIFIED] against the live `pg_hba.conf`:** a role can connect to any database that grants CONNECT to
PUBLIC, which is the default on a shared server. Stop the two roles from even connecting elsewhere by putting these lines
**above** the generic `host` lines in `/etc/postgresql/18/main/pg_hba.conf`, then `systemctl reload postgresql`:

```
host  god_dashboard  god_app,god_migrator  127.0.0.1/32  scram-sha-256
host  all            god_app,god_migrator  all           reject
host  all            god_app,god_migrator  ::/0          reject
```

(`::1` is the IPv6 loopback; if your generic lines already cover it, mirror them.) Check afterwards that the other apps
still connect.

## Step 3. Write the two env files (names only here; the values are yours)

```bash
install -d -m 700 -o root -g root /etc/god-dashboard
install -m 600 -o root -g root /dev/null /etc/god-dashboard/dashboard.env
install -m 600 -o root -g root /dev/null /etc/god-dashboard/migrate.env
nano /etc/god-dashboard/dashboard.env       # then migrate.env
```

Format: `NAME=value`, one per line, **no quotes and no spaces around `=`** (`docker run --env-file` keeps quotes literally).
Docker reads the files as root; the container only sees the variables. The deploy script refuses to run unless both are mode 600.

`dashboard.env`:

| Variable | Value |
|---|---|
| `GOD_DATABASE_URL` | `postgres://god_app:<password>@127.0.0.1:5432/god_dashboard` (the runtime role, never the migrator) |
| `GOD_PUBLIC_URL` | `https://dashboard.god.gaiada.com` (the sign-in redirect URI is built from it) |
| `YOURTAL_ISSUER` | the Sign in with YourTal issuer URL |
| `GOD_OIDC_CLIENT_ID` | this dashboard's client id at YourTal |
| `GOD_OIDC_CLIENT_SECRET` | its client secret. **[UNVERIFIED]**: the sign-in branch (`fe/auth`) owns the exact name; match its `.env.example` |
| `GOD_SESSION_SECRET` | `openssl rand -base64 48` |
| `GOD_BASEMAP_PMTILES` | optional: a same-origin `.pmtiles` path to switch on the self-hosted base map |

**Never set `GOD_DEV_AUTH` or `GOD_DEPLOYMENT`.** Dev sign-in is on only when both are set, and `GOD_DEV_AUTH=1` with any
other `GOD_DEPLOYMENT` stops the app at start. `compose.yaml` itself sets `NODE_ENV`, `HOSTNAME`, `PORT` and `NODE_OPTIONS`.
`GOD_BUILD_SHA` is baked into the image.

`migrate.env`: `GOD_MIGRATE_DATABASE_URL=postgres://god_migrator:<password>@127.0.0.1:5432/god_dashboard`.
It is used only by the one-off migration container, never by the app.

## Step 4. nginx, first over http, then the certificate

```bash
mkdir -p /var/www/certbot
cat > /etc/nginx/sites-available/dashboard.god.gaiada.com.conf <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name dashboard.god.gaiada.com;
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; default_type text/plain; }
    location / { return 301 https://$host$request_uri; }
}
EOF
ln -s /etc/nginx/sites-available/dashboard.god.gaiada.com.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

certbot certonly --webroot -w /var/www/certbot -d dashboard.god.gaiada.com \
  --deploy-hook 'systemctl reload nginx'
```

One name per certificate. Let's Encrypt allows 50 new certificates a week for the whole `gaiada.com` domain, and other
sites on Helios share that bucket: check recent issuance (`ls -lt /etc/letsencrypt/live | head`) before you request. **[UNVERIFIED]**
Helios's nginx include pattern: other vhosts here use `sites-enabled/*.conf`, so keep the `.conf` ending. If CloudPanel still
manages vhosts on this box, a hand-made file under a new name is not regenerated, but check `ls /etc/nginx/sites-enabled`
after any CloudPanel change.

Then the full vhost, replacing the http-only one:

```bash
# from the laptop
scp infra/dashboard/nginx.dashboard.god.gaiada.com.conf helios:/etc/nginx/sites-available/dashboard.god.gaiada.com.conf
# on Helios
nginx -t && systemctl reload nginx
```

What it does: HTTP to HTTPS (with the `.well-known` webroot left open for renewal); proxy to `127.0.0.1:3120` with
`X-Forwarded-Proto`; gzip for text, CSS, JS, JSON and SVG; `client_max_body_size 1m`; HSTS for a year, **no preload**;
`X-Robots-Tag: noindex, nofollow` (staging only; remove it when this becomes production).
**There is no Content-Security-Policy in nginx on purpose**: the app sends its own nonce-based policy per request, and a
second one from nginx would be intersected with it and break the scripts. Do not add one.
If you use another port, change `proxy_pass` to match.

## Step 5. First deploy (from the laptop)

```bash
cd <the tree you want live>                                # committed, with pnpm-lock.yaml committed
bash scripts/server-f/remote-build.sh . dashboard god-dash        # the gate: must end BUILD-OK
bash scripts/deploy/dashboard-to-helios.sh god-dash build         # image on server-f + smoke test; prints the image size
bash scripts/deploy/dashboard-to-helios.sh god-dash ship         # ship, back up, migrate, swap, wait for /healthz
```

(`dashboard-to-helios.sh god-dash` with no action does the build and the ship together.) Set `GOD_PORT=<port>` first if you
changed the port. The ship step prints four stages and ends `DEPLOY-OK <sha>`. On a first deploy the database backup holds
an empty database and the migrations apply 0001 and 0002.

**First allow-list entry.** Sign-in only admits people on the allow-list, and Admin invites need an Owner who can already
sign in. **[UNVERIFIED]** how the sign-in branch bootstraps the first Owner; if it has no mechanism, insert one by hand
(no secret involved; the entry binds to the person's YourTal `sub` at their first sign-in):

```bash
runuser -u postgres -- psql god_dashboard -c "
SET ROLE god_app;
INSERT INTO god_app.allow_list (id, name, email, role, agreement_signed, original_held_by, status, invited_by)
VALUES ('u-owner-1', '<full name>', '<lower-case email>', 'owner', '<YYYY-MM-DD paper agreement signed>', '<who holds the original>', 'invited', 'bootstrap');"
```

## Step 6. Check it with curl

```bash
H=https://dashboard.god.gaiada.com
curl -sS $H/healthz                                   # {"ok":true,"build":"<the sha you deployed>"}   <- proves WHICH build is live
curl -sI http://dashboard.god.gaiada.com/ | head -3   # 301 to https
curl -sI $H/ | grep -iE '^(HTTP|location|strict-transport|x-robots|content-security-policy|x-frame|x-powered)'
#   expect 307 to /signin when signed out; HSTS max-age=31536000 (no preload); X-Robots-Tag noindex;
#   exactly ONE content-security-policy line, with a nonce and no 'unsafe-inline'/'unsafe-eval'; no x-powered-by
curl -sI -H 'Accept-Encoding: gzip' $H/signin | grep -i content-encoding     # gzip
curl -s -o /dev/null -w '%{http_code}\n' $H/api/map/influence                # 401 (not signed in)
curl -s -o /dev/null -w '%{http_code}\n' --connect-timeout 3 http://<helios public ip>:3120/healthz   # must FAIL (000): not reachable from outside
# on Helios
ss -ltnp 'sport = :3120'                              # 127.0.0.1:3120 only
docker ps --filter name=god-dashboard --format '{{.Status}}'     # Up ... (healthy)
docker exec god-dashboard id -u                       # 1000
cat /opt/god-dashboard/current.tag /opt/god-dashboard/previous.tag
runuser -u postgres -- psql god_dashboard -c '\dt god_app.*'  # allow_list, audit_log, schema_migrations, sessions
```

Then sign in through the browser, and check the Admin page shows the audit entries.

## Step 7. Roll back

```bash
bash scripts/deploy/dashboard-to-helios.sh rollback           # from the laptop
```

It starts the image in `/opt/god-dashboard/previous.tag`, waits for `/healthz` to answer with that build, and swaps
`current.tag` and `previous.tag`. The last three images are kept on Helios. **The database is not rolled back**: migrations
are forward-only, and each one must work with the code that is still running (add columns and tables; never drop or rename
in the same release). If a migration itself is the problem, restore from `/var/backups/god-dashboard/pre-<sha>-*.dump`:

```bash
docker compose -f /opt/god-dashboard/compose.yaml down
runuser -u postgres -- dropdb god_dashboard
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q -f /root/god-setup-roles.sql      # recreates the empty database, owner, schema
runuser -u postgres -- pg_restore -d god_dashboard --clean --if-exists --no-owner --role=god_migrator --exit-on-error \
  /var/backups/god-dashboard/pre-<sha>-<time>.dump
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -q -f /root/god-setup-roles.sql      # again: re-asserts the per-role settings a dump does not carry
# then roll the image back as above (the migrations table came back with the dump, so a later deploy re-applies only what is missing)
```

This restore sequence was rehearsed on a throwaway `postgres:18` on server-f (2026-11-26): rows, the migration history and
the `god_app` grants all came back, and the migration runner reported nothing to do afterwards. It has not been run on Helios.

A failed deploy (the new container never answers `/healthz` with the new build) puts the previous image back by itself and
exits 1; the migrations of that release stay applied.

## Step 8. Update later

Repeat step 5: gate, build, ship. Same sha twice is fine (the swap just recreates the container). Edits to the env file
need `docker compose -f /opt/god-dashboard/compose.yaml up -d --force-recreate` with `GOD_IMAGE_TAG=$(cat /opt/god-dashboard/current.tag)` and
`GOD_PORT` set, because compose only re-reads `env_file` when it recreates the container.

## Step 9. Nightly backup

```bash
# from the laptop
scp infra/dashboard/backup.sh helios:/usr/local/sbin/god-dashboard-backup
# on Helios
chmod 755 /usr/local/sbin/god-dashboard-backup
echo '17 2 * * * root /usr/local/sbin/god-dashboard-backup >> /var/log/god-dashboard-backup.log 2>&1' > /etc/cron.d/god-dashboard-backup
/usr/local/sbin/god-dashboard-backup && ls -l /var/backups/god-dashboard
```

It writes a custom-format `pg_dump` (checked with `pg_restore --list`, mode 600, 14 kept). **TODO for the lead: this is the
same disk.** I found no verified off-box backup path for Helios in the repo or in `gaiada-setups` (the notes say the `gaiada_backups`
GCS bucket and the sumopod sftp route exist for other apps, and both have failed in the past; the Helios README records that
no Postgres backup job existed on this box). The audit log is the record that matters most here: copy these dumps off the box
as soon as a path works. Until then, a disk loss loses this database.

## Environment variables, all in one place

| Variable | Where | Who owns the name |
|---|---|---|
| `GOD_DATABASE_URL`, `GOD_MIGRATE_DATABASE_URL` | `dashboard.env`, `migrate.env` | this branch (`fe/backend`) |
| `GOD_PUBLIC_URL`, `GOD_SESSION_SECRET`, `YOURTAL_ISSUER`, `GOD_OIDC_CLIENT_ID`, the client secret | `dashboard.env` | the sign-in branch (`fe/auth`); confirm against its `apps/dashboard/.env.example` |
| `GOD_BASEMAP_PMTILES` | `dashboard.env`, optional | the dashboard |
| `GOD_PORT` | the deploy command, default 3120; must match the vhost | the deploy script |
| `NODE_ENV`, `HOSTNAME`, `PORT`, `NODE_OPTIONS` | `compose.yaml` | here |
| `GOD_BUILD_SHA` | baked into the image | the Dockerfile |
| `GOD_DEV_AUTH`, `GOD_DEPLOYMENT` | **never set on Helios** | the dashboard |
