# Dashboard on Helios: runbook (staging, dashboard.god.gaiada.com)

For the lead, step by step. The dashboard is one container (`god-dashboard`, `node:24-bookworm-slim`, non-root) bound to
`127.0.0.1:3125`, behind nginx, talking to Helios's native PostgreSQL 18 on `127.0.0.1:5432`. It still reports on
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
client and Postgres is not touched. The app itself binds `127.0.0.1:3125` (`HOSTNAME=127.0.0.1` in `compose.yaml`), so the
port is never reachable from outside. The price is a shared loopback, so the container is held down: non-root, read-only
root filesystem, all capabilities dropped, `no-new-privileges`, 640 MB and 1 CPU, and a database role that can touch nothing
outside schema `god_app`.

## Step 1. Check the box

```bash
ssh helios
docker --version && docker compose version          # the compose PLUGIN must be there. If not: apt install docker-compose-plugin
psql --version; runuser -u postgres -- psql -Atc 'show server_version; show listen_addresses; show port;'   # expect 18.x, localhost, 5432   [UNVERIFIED]
ss -ltnH 'sport = :3125' | wc -l                      # 0 = port 3125 is free. If not, pick another and use it in step 5 and in the vhost (GOD_PORT)   [UNVERIFIED]
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
| (no client secret) | The dashboard authenticates to YourTal with `private_key_jwt`. The private JWK lives at `/etc/god-dashboard/oidc-key.jwk.json` (owner uid 1000, mode 0400; make it with the one-liner in `apps/dashboard/README.md`), and `compose.yaml` mounts it read-only and sets `GOD_OIDC_KEY_FILE`. Its public JWKS goes to YourTal as `god-dashboard.jwks.json` |
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

What it does: HTTP to HTTPS (with the `.well-known` webroot left open for renewal); proxy to `127.0.0.1:3125` with
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
curl -s -o /dev/null -w '%{http_code}\n' --connect-timeout 3 http://<helios public ip>:3125/healthz   # must FAIL (000): not reachable from outside
# on Helios
ss -ltnp 'sport = :3125'                              # 127.0.0.1:3125 only
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

## Step 10. Emergency Owner access (break-glass)

Founder decision 2026-11-27: one sealed emergency Owner key, local to the dashboard, for when YourTal is down. It is a
WebAuthn credential registered with the dashboard itself (relying party `dashboard.god.gaiada.com`), never with YourTal,
so it works while YourTal is down. Sign-in is at `https://dashboard.god.gaiada.com/auth/emergency` (not in any menu).
An emergency session lasts **1 hour**, shows "Emergency access. Every action is recorded." on every screen, can read
every page and revoke sessions, and **cannot** export, open a Person 360 profile, invite or change the allow-list, or
add or revoke emergency keys. At most one active key per Owner and two in total. Code: `apps/dashboard/src/server/breakglass/`,
migration `packages/db/migrations/0003_break_glass.sql`.

**Two people to add a key.** The dashboard's runtime role cannot make an enrolment code; only the server CLI (as
`god_migrator`) can. So adding a key takes server access (the lead) **and** an Owner signed in with YourTal who passes a
fresh passkey check. A stolen Owner session alone cannot add one.

The commands below run the CLI from the live image, the same way the deploy runs migrations (`migrate.env`, read-only,
no capabilities). Set this once per shell on Helios:

```bash
ssh helios
TAG=$(cat /opt/god-dashboard/current.tag)
bgcli() { docker run --rm --network host --env-file /etc/god-dashboard/migrate.env --read-only --cap-drop ALL \
  --security-opt no-new-privileges --entrypoint node "god-dashboard:$TAG" /app/db/src/cli.ts "$@"; }
```

### 10.1 Before the first key

- The release with migration 0003 is deployed (step 8). Check: `runuser -u postgres -- psql god_dashboard -c '\dt god_app.*'`
  lists `break_glass_credentials` and `break_glass_enrolment_codes`.
- The Owner has signed in with YourTal at least once (their allow-list entry is `active`). Find the entry id:
  `runuser -u postgres -- psql god_dashboard -Atc "select id, name, status from god_app.allow_list where role = 'owner'"`.
- The key. **Recommended: a FIDO2 hardware security key with a PIN** (it stays in the envelope). A phone or laptop passkey
  that syncs to a cloud account is not sealed: it leaves with the account. Any FIDO2 key that holds discoverable
  credentials and has a PIN works **[UNVERIFIED: no specific model has been tested against this dashboard yet]**.

### 10.2 Make the enrolment code (lead, on Helios)

```bash
bgcli break-glass-code --owner <entry id>       # for example u-owner-1
```

It prints the code once (`XXXX-XXXX-XXXX-XXXX-XXXX`), for that Owner only. It works **once, for 15 minutes**. Read it to
the Owner in person or by phone; do not send it by email or chat. Making a new code stops the old one. Only its SHA-256
is stored, and the audit log records "Emergency key code made" (who: the server).

### 10.3 The Owner adds the key (Owner, in the browser, with the code)

1. Sign in with YourTal at `https://dashboard.god.gaiada.com`.
2. Open **Admin, Emergency access**.
3. Plug in the security key. Type the code and press **Add emergency key**. If YourTal has not checked the passkey in the
   last 5 minutes, the browser goes to YourTal and back: type the code again.
4. The browser asks where to save the passkey: choose the **security key** (not this phone or computer), enter or set its
   PIN, and touch it.
5. The key shows as **Active**. The audit log has "Emergency key added", and `docker logs god-dashboard` has an
   `"alert":"break-glass"` line.

### 10.4 Test it once, then seal it

1. Sign out. Open `https://dashboard.god.gaiada.com/auth/emergency`, press **Use the emergency key**, enter the PIN and
   touch the key. The red banner shows on every screen.
2. On Helios: `docker logs god-dashboard 2>&1 | grep '"alert":"break-glass"' | tail -3` shows `breakglass.signin`.
3. Sign out.
4. **The founder seals the key** in a tamper-evident envelope, signed and dated across the flap, and keeps it **with the
   paper agreements in the company archive**. The PIN does not go in the same envelope: the founder keeps it apart
   (memorised, or sealed and stored somewhere else; the founder's choice).
5. Record in the archive log: the date sealed and the key's label from Admin (`key:` and 12 characters).

### 10.5 Using it (YourTal is down)

Take the envelope out of the archive, open `/auth/emergency`, and use the key. The session ends after 1 hour; sign in
with it again if needed. Every sign-in is in the audit log ("Emergency sign-in") and writes an alert line to the logs.
Afterwards the lead reads the audit log for the whole period, and the founder reseals the key in a new envelope and
records it.

### 10.6 Quarterly test (founder and lead together, first week of January, April, July and October)

1. Check the envelope is intact (signatures across the flap unbroken). Open it.
2. Sign in at `/auth/emergency`. Check the banner shows, that Insight has no Export button, and that Admin, Emergency
   access shows the key's **Last used** as now. Sign out.
3. On Helios: the alert line is in `docker logs` (10.4 step 2), and `bgcli break-glass-list` shows the key `ACTIVE`, last
   used today.
4. Reseal in a new envelope and record the date.

If any step fails, revoke the key (10.7) and add a new one (10.2 and 10.3) the same week.

### 10.7 Revoke it

- **YourTal works:** an Owner opens Admin, Emergency access, presses **Revoke** and confirms the passkey check. The key
  stops at once and that Owner's emergency sessions end.
- **YourTal is down, or the key is lost or stolen:** on Helios,
  ```bash
  bgcli break-glass-revoke --owner <entry id>     # or --all for every key
  bgcli break-glass-list                          # check: revoked
  ```
  It also ends every live emergency session of that Owner (or all of them with `--all`).

Both write "Emergency key revoked" to the audit log. Revocation is final; a replacement needs a new code. Suspending or
removing an Owner stops their key at once anyway (every emergency sign-in checks the entry), but revoke it too.

### 10.8 The alert channel (TODO for the lead)

Today `notifyBreakGlass` (`apps/dashboard/src/server/breakglass/notify.ts`) writes one JSON line to stderr and nothing
else: nobody is told in real time unless someone watches the logs. Wire it to the company alert route (website alerts go
to the ERP) before relying on it. Until then, check after any YourTal outage:

```bash
docker logs --since 24h god-dashboard 2>&1 | grep '"alert":"break-glass"'
```

### 10.9 Notes

- The rate limit (5 attempts per network prefix and 20 in total per 15 minutes) and the open WebAuthn challenges live in
  the app's memory. A container restart resets them.
- No CSP change: WebAuthn is not governed by CSP, the ceremony's two requests are same-origin `fetch` calls
  (`connect-src 'self'`), and the `Permissions-Policy` header leaves `publickey-credentials-get` and
  `publickey-credentials-create` at their default (this origin only).
- Migration 0003 also adds `signin.ok`, `signin.fresh` and `signout` to the audit log's allowed actions. 0002 left them
  out, so on a database at 0002 a successful YourTal sign-in fails when it writes its audit event.

## Step 11. Contact form: god.gaiada.com to the dashboard, and the email

The public site (static, Astro, on Helios) has a contact form. It posts JSON to **`https://god.gaiada.com/api/contact`**
(same origin, so the site's CSP `connect-src 'self'` stays exactly as it is). nginx on the **god.gaiada.com** vhost proxies
that to the dashboard's **`POST /api/public/contact`** on `127.0.0.1:3125`. Every enquiry is **stored first** in
`god_app.enquiries` (migration 0004, applied by the normal deploy); the email to `hello@god.gaiada.com` is only a
heads-up after that, so nothing is lost while mail is not set up. Owners read and handle enquiries in **Admin, Enquiries**.
Code: `apps/dashboard/src/server/enquiries/`.

### 11.1 Deploy the release with migration 0004 first

Step 5 / step 8 (gate, build, ship). Check afterwards: `runuser -u postgres -- psql god_dashboard -c '\d god_app.enquiries'`
shows the table. The route answers `500` until the table exists, so deploy before the vhost change.

### 11.2 The variables (names only here; add them to `/etc/god-dashboard/dashboard.env`, mode 600)

| Variable | Value |
|---|---|
| `GOD_SITE_ORIGIN` | optional. The only `Origin` the route accepts. Default `https://god.gaiada.com`. Set it only if the site moves (a bare origin, no path) |
| `GOD_SMTP_URL` | `smtp://127.0.0.1:25` (Helios's local postfix, which signs with DKIM). No TLS to a loopback server; any other host needs STARTTLS (`smtp://`) or `smtps://` |
| `GOD_ENQUIRY_TO` | `hello@god.gaiada.com` |
| `GOD_ENQUIRY_FROM` | `GOD website <no-reply@god.gaiada.com>` (no quotes in the env file) |

If **any of the three mail variables is unset or empty**, no email is sent and the container logs one line
(`enquiry.mail.disabled`) the first time an enquiry arrives. Enquiries are still stored. After editing the file:
`GOD_IMAGE_TAG=$(cat /opt/god-dashboard/current.tag) docker compose -f /opt/god-dashboard/compose.yaml up -d --force-recreate`
(step 8: compose only re-reads `env_file` when it recreates the container), and check
`docker exec god-dashboard printenv GOD_ENQUIRY_FROM`. The container uses host networking, so `127.0.0.1:25` is Helios's
postfix: **[UNVERIFIED]** that it listens on loopback and accepts mail from 127.0.0.1. Check:
`ss -ltnp 'sport = :25'`, `postconf mynetworks`, and
`docker exec god-dashboard node -e "require('net').connect(25,'127.0.0.1').once('data',d=>{console.log(String(d));process.exit()})"`
(prints the `220 ...` banner).

### 11.3 The nginx block on the god.gaiada.com vhost

One zone in the `http` context (a new file such as `/etc/nginx/conf.d/god-contact-limit.conf`):

```nginx
limit_req_zone $binary_remote_addr zone=god_contact:1m rate=6r/m;
```

and this inside the `server { ... server_name god.gaiada.com; ... }` block that serves the site (an exact-match location wins
over the site's own `location /`):

```nginx
    # The contact form. The browser posts to /api/contact on this origin; the dashboard answers at /api/public/contact.
    location = /api/contact {
        limit_except POST { deny all; }                 # POST only
        limit_req zone=god_contact burst=3 nodelay;     # about 6 a minute per address, a burst of 4
        limit_req_status 429;
        client_max_body_size 16k;                       # the app refuses over 8 KB itself
        client_body_buffer_size 16k;

        proxy_pass http://127.0.0.1:3125/api/public/contact;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;        # the ONLY address the app reads: set here, never passed through
        proxy_set_header X-Forwarded-For $remote_addr;  # not appended to: a client-sent value is dropped
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_set_header Cookie "";                     # no cookie ever reaches the app
        proxy_hide_header Set-Cookie;
        proxy_read_timeout 15s;
        proxy_send_timeout 15s;
        proxy_no_cache 1;                               # never cached, in either direction
        proxy_cache_bypass 1;
    }
```

Notes for the lead:

- `Origin` and `Content-Type` pass through untouched (the default). The app refuses any request whose `Origin` is not
  `https://god.gaiada.com`, **including one with no `Origin` header**. A browser always sends `Origin` on a `fetch` POST,
  even same-origin; test once in a real browser, not only with curl.
- Do **not** add an `add_header` inside this location: nginx then drops the server-level ones (HSTS, and the site's CSP, if it
  is set there) for this location. Without it they are inherited, which is harmless: a CSP on a no-body API response does
  nothing. The app itself sends `Cache-Control: no-store`, no cookie and no CSP (`src/proxy.ts` skips `/api`).
- If CloudPanel manages this vhost, put the block in its Vhost editor, not only in the file on disk: an on-disk edit is
  lost the next time CloudPanel rewrites the vhost. **[UNVERIFIED]** on this box.
- **Optional hardening on the dashboard vhost** (`nginx.dashboard.god.gaiada.com.conf`): the same route is also reachable
  at `https://dashboard.god.gaiada.com/api/public/contact`. The `Origin` check stops browsers there, not curl with a forged
  `Origin`; it is rate limited either way. To remove the second door, add
  `location ^~ /api/public/ { return 404; }` to that vhost. It is not in the repo's vhost file because this release did not
  change that file.
- The app's own limits are in memory (5 an hour per `/24` or IPv6 `/48`, 100 an hour in total, `429` with `Retry-After`) and
  reset when the container restarts. nginx's `limit_req` is the one that survives a restart.

```bash
nginx -t && systemctl reload nginx
```

### 11.4 Check it with curl

```bash
S=https://god.gaiada.com/api/contact
B='{"name":"Runbook check","company":"GOD","email":"you@example.com","want":"Checking the contact form","budget":"","website":""}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST $S -H 'Origin: https://god.gaiada.com' -H 'Content-Type: application/json' -d "$B"   # 201 (a real row: archive it in Admin, Enquiries)
curl -s -o /dev/null -w '%{http_code}\n' -X POST $S -H 'Content-Type: application/json' -d "$B"                                       # 403 no Origin
curl -s -o /dev/null -w '%{http_code}\n' -X POST $S -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d "$B"     # 403 wrong Origin
curl -s -o /dev/null -w '%{http_code}\n' -X POST $S -H 'Origin: https://god.gaiada.com' -H 'Content-Type: text/plain' -d "$B"         # 415
curl -s -o /dev/null -w '%{http_code}\n' -X POST $S -H 'Origin: https://god.gaiada.com' -H 'Content-Type: application/json' -d '{"website":"x"}'   # 204, nothing stored
curl -s -o /dev/null -w '%{http_code}\n' $S                                                                                           # 403 (GET refused by nginx)
curl -sI -X POST $S -H 'Origin: https://god.gaiada.com' -H 'Content-Type: application/json' -d "$B" | grep -iE '^(HTTP|set-cookie|content-security|cache-control)'
#   expect no set-cookie, and cache-control: no-store
# on Helios
docker logs --since 10m god-dashboard 2>&1 | grep -E 'enquiry\.'     # enquiry.mail.disabled / .failed / .honeypot / .store.failed
```

Then open **Admin, Enquiries** as an Owner: the row is there, the tab label counts it as new, and **Mark as read** writes an
"Enquiry updated" event to the audit log. Archive the test row.

### 11.5 Email: the founder's DNS dependency

- **Today:** mail for `god.gaiada.com` is not set up (the founder is adding it in Google Workspace). Until it is,
  notifications cannot reach `hello@god.gaiada.com`: with no MX record Helios's postfix falls back to the domain's A record,
  which is Helios itself, so the mail loops or bounces **[UNVERIFIED: how this postfix is configured]**. **Nothing is lost**:
  every enquiry is already in Admin, Enquiries. Postfix answering `250 queued` only means it accepted the message; delivery
  can still fail later, in `/var/log/mail.log`, which the app never sees. A failure the app does see is logged as
  `enquiry.mail.failed` with a reason code.
- **Founder (Google Workspace):** add `god.gaiada.com` to the Workspace, create the `hello@god.gaiada.com` mailbox or alias,
  and publish the MX records Workspace gives for `god.gaiada.com`.
- **Lead (DNS and Helios), so the mail is accepted as genuinely from `no-reply@god.gaiada.com`:** an SPF record for
  `god.gaiada.com` that names **both** Google and Helios (one SPF record only: `v=spf1 include:_spf.google.com ip4:<Helios
  address> ~all`), a DKIM key for `god.gaiada.com` on Helios's postfix (selector and key) with its TXT record, and a DMARC
  record (`_dmarc`, `p=none` to start). **[UNVERIFIED]**: the brief says Helios's postfix signs with DKIM; that it already
  signs for `god.gaiada.com` was not checked.
- **Check once all of that is live:** send the curl test in 11.4, find the email in `hello@`, and in Gmail "Show original"
  confirm `SPF: PASS` and `DKIM: PASS` for `god.gaiada.com`. Reply to it: the reply goes to the enquirer (Reply-To).

## Environment variables, all in one place

| Variable | Where | Who owns the name |
|---|---|---|
| `GOD_DATABASE_URL`, `GOD_MIGRATE_DATABASE_URL` | `dashboard.env`, `migrate.env` | this branch (`fe/backend`) |
| `GOD_PUBLIC_URL`, `GOD_SESSION_SECRET`, `YOURTAL_ISSUER`, `GOD_OIDC_CLIENT_ID`, the client secret | `dashboard.env` | the sign-in branch (`fe/auth`); confirm against its `apps/dashboard/.env.example` |
| `GOD_BASEMAP_PMTILES` | `dashboard.env`, optional | the dashboard |
| `GOD_PORT` | the deploy command, default 3125; must match the vhost | the deploy script |
| `NODE_ENV`, `HOSTNAME`, `PORT`, `NODE_OPTIONS` | `compose.yaml` | here |
| `GOD_BUILD_SHA` | baked into the image | the Dockerfile |
| `GOD_SITE_ORIGIN` (optional), `GOD_SMTP_URL`, `GOD_ENQUIRY_TO`, `GOD_ENQUIRY_FROM` | `dashboard.env`; the three mail ones are all or nothing (step 11) | this branch (`fe/contact`) |
| `GOD_DEV_AUTH`, `GOD_DEPLOYMENT` | **never set on Helios** | the dashboard |
