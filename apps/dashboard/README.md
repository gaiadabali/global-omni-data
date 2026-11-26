# @god/dashboard

The GOD group dashboard (dashboard.god.gaiada.com). Allow-listed GOD staff only. Next 16 App Router, React 19,
Tailwind 4. In this phase every figure is synthetic (`@god/synthetic`); the map geography is real, from `@god/geo` (ABS).
Sign-in is Sign in with YourTal with a passkey (or a password while the staging switch is on), or the dev cookie while
dev sign-in is on. Three seams:

| Seam                                   | File                                 | Today                                                                                                                   | Later                                   |
| -------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **Viewer** (who is signed in)          | `src/server/viewer.ts` `getViewer()` | Sign in with YourTal (allow-list, passkey, session); the `god_dev_role` cookie only while dev sign-in is on, never both | —                                       |
| **Stores** (the dashboard's own state) | `src/server/store/` `getStores()`    | in memory (`memory.ts`)                                                                                                 | Postgres when `GOD_DATABASE_URL` is set |
| **Data** (where numbers come from)     | `src/server/data/` `DashboardData`   | `synthetic.ts` over `@god/synthetic`                                                                                    | the warehouse                           |

Build and test on server-f only (`scripts/server-f/remote-build.sh`), never on the laptop. See the repo `CLAUDE.md`.

## Structure

```
src/
  app/                      routes. (shell)/ pages share the signed-in shell; signin/ and dev-role/ do not
    (shell)/page.tsx          /            group overview
    (shell)/brands/[brand]/   /brands/yourtal | snapapp | ftr
    (shell)/map/ and activity/   the two Australia maps (client components in components/maps, loaded with
                                 next/dynamic, ssr: false). map/maplibre-worker/route.ts serves MapLibre's worker
                                 file from this origin (CSP worker-src 'self'). GOD_BASEMAP_PMTILES, a same-origin
                                 .pmtiles path, switches on the self-hosted base map; unset = land from au-states.json
    (shell)/insight|teens|person|quality|admin/   Brand insight (with ?print=1), Teen market, Person 360,
                                 Data quality, Admin. Actions write to the audit seam (server/audit)
    (shell)/forbidden.tsx     the 403 screen (a real 403, via forbidden())
    api/map/influence|summary|area|activity|hotspots|activity-area/route.ts   GET handlers, thin wrappers over src/server/map-api.ts
  proxy.ts                  Next 16 "middleware": per-request nonce CSP
  instrumentation.ts        refuses to start on a bad dev-auth config; warms the synthetic sample
  lib/                      pure helpers: pages registry, format, theme, csp, period
  server/                   server-only code. Pages call these, never the other way round
    types.ts                  Viewer, Role, BrandId
    viewer.ts / dev-roles.ts / dev-auth.ts / dev-actions.ts   the viewer seam and the dev guard
    access.ts                 THE access table, requirePage / requireApi, the nav
    privacy.ts                THE threshold function, presentCount
    data/                     the data seam (types, provider, presentation, legend)
    map-api.ts                query validation and the two map handlers
  components/ui/            Card, StatTile, Table, Badge, Tabs, Segmented, Select, Modal, Toast, EmptyState, SmallNumber
  components/charts/        LineChart, BarChart (vertical and horizontal), StackedBar, Sparkline
  components/shell/         sidebar, phone bar, theme toggle, dev role switch
  components/brands/        the three brand pages' content
```

## The rules that make this safe

1. **Every page and route handler checks access on the server, first.** Pages: `const viewer = requirePage(await
getViewer(), "pageId")`. No viewer redirects to `/signin`; a role that may not open the page gets a real 403.
   Route handlers use `requireApi` (401 or 403). The shell layout redirects too, but a layout does not re-run on client
   navigation, so it is never the check.
2. **Hiding a link is cosmetic.** The nav is built by `navFor(viewer)` from the same table the checks use.
3. **No number reaches a page unthresholded.** Pages get data from `getDashboardData(viewer)`, which returns
   `Present<...>`: every `RawCount` the provider returned has been through `presentCount` for that viewer. ESLint
   forbids importing the provider (or `@god/synthetic`) from `src/app` and `src/components`.
4. **No `style=""` attributes anywhere in rendered HTML.** The CSP has no `'unsafe-inline'` for styles. Colours come from
   classes (`.b-yt`, `.b-sa`, `.b-ftr`, `.b-god`) and SVG presentation attributes (`fill="var(--yt)"`).
5. **No third parties at runtime.** Fonts are `@fontsource-variable/*`, the logo is in `public/`, `connect-src 'self'`.

## Access (`src/server/access.ts`)

`PAGE_ACCESS` and `API_ACCESS` map each page and API to the roles that may use it. A brand lead sees only their own
brand: `BRAND_PAGE` limits the brand pages, `canQueryBrand(viewer, brand)` limits queries (a brand lead may not ask for
`all`). `requirePage(viewer, pageId)`, `requireApi(viewer, apiId)`, `navFor`, `phoneNavFor`, `homePathFor`.

## Privacy (`src/server/privacy.ts`)

`presentCount(n, { kind: "adult" | "teen" | "sensitive", viewer })` returns `{ display, exact, suppressed }`.
Under 10 (adult) or under 20 (teen, sensitive) it is `"<10"` / `"<20"` with `exact: null`. Owner and Data team get the
exact number with `suppressed: true`, and the UI shows the **small number** marker (`<Num n={...} />`). `toPNum` is the
UI-ready form `{ value, display, suppressed }` (`value` is 0 for a suppressed count the viewer must not see).

## Data (`src/server/data/`)

- `types.ts`: `DashboardData` is the warehouse contract: `overview`, `brand`, `influenceMap`, `activityMap`. A provider
  returns exact numbers. Anything that is a count is typed `RawCount` / `RawSeries` (build them with `count(n, kind)` and
  `countSeries(values, kind)`). A plain `number` field is deliberately not a count (money, a rate, a share).
- `synthetic.ts`: the provider over `@god/synthetic`. A warehouse provider replaces this file.
- `present.ts`: `presentTree` thresholds any provider result; `presentInfluence` / `presentActivity` flatten map results,
  compute `band` and `legend`.
- `index.ts`: `getDashboardData(viewer)`. The only door for pages. It also refuses a brand lead's query for another
  brand, as defence in depth.
- `legend.ts`: log-rounded legend bands that always start `<10` (`<20` for teen and sensitive).

### Map API

The map contract is `src/server/data/MAPS-CONTRACT.md` (read it before building a map screen). Both are `GET`, JSON, `Cache-Control: private, no-cache`, `Vary: Cookie`. Thresholds are applied on the server. Bad query: 400. Not signed in: 401. Role or brand not allowed: 403.

| Endpoint | What |
|---|---|
| `/api/map/influence` | cells at `level=state\|sa4\|sa3\|sa2\|h3` (`res=6\|7`; `bbox` required from SA2 down), each with a real `name`, `parent`, `centroid`, `population`, 12-month `trend` and `newThisMonth` |
| `/api/map/summary` | headline totals, a ranked list of areas with sparklines, and the top movers |
| `/api/map/area` | one area: parent chain, population, totals per brand and for GOD, 24-month series, age mix, per 1,000 against the nation, rank in its parent |
| `/api/map/activity` | merchant dots and activity heat (`h3=5\|6\|7`), heat cells named for suburbs |
| `/api/map/hotspots` | the top activity areas, with suburb name and category mix |
| `/api/map/activity-area` | one heat cell or SA2: category mix, age mix, top merchants |

There is no street level: `res=8` is a 400, and the map zoom is capped at suburb size (`MAX_ZOOM` 11.4 in
`components/maps/zoom.ts`). Bad query: 400. Not signed in: 401. Role or brand not allowed: 403. Unknown area: 404.

Geography is real (`@god/geo`, ABS ASGS Edition 3 and ERP 30 June 2025); the people are synthetic. The outlines are static
files, `/geo/state.json`, `sa4.json`, `sa3.json`, `sa2.json`, generated from `packages/geo/data` by
`packages/geo/scripts/emit-public.mjs` when `dev` or `build` runs (not committed, so the data is in git once). They are served
with `Cache-Control: public, max-age=31536000, immutable`; `mapMeta().geo.levels` gives the versioned URLs.

## Components

Use these before writing a new one.

- `ui`: `Card`, `PageHeader`, `StatTile` / `StatGrid`, `Table`, `Badge`, `Callout`, `Tabs`, `Segmented`, `Select`, `Modal`,
  `useToast` / `ToastProvider`, `EmptyState` / `Loading`, `Num` / `SmallNumberMarker`.
  `Segmented` with `href` options keeps state in the URL (`?period=week`) and needs no client code.
- `charts`: `LineChart` (several series, hide/show, hover and arrow keys), `BarChart` (`orientation`, `stacked`),
  `StackedBar` (one whole in parts), `Sparkline`. Charts compute with d3-scale, d3-shape and d3-array and draw SVG. Pass a
  `title` and a `description` (the accessible name and summary), colours as theme tokens (`"var(--yt)"`), and a
  `format` name (`"int" | "compact" | "aud" | "pct"`; functions cannot cross from a server page). Each chart carries a
  visually hidden table and a `data-ready="1"` attribute once it has measured itself (screenshots wait for it).
  Charts plot numbers, so a suppressed count plots as 0 for roles that may not see it; show small counts in a table.

## Add a page

1. `src/lib/pages.ts`: add the id to `PAGE_IDS` and an entry in `PAGES` (path, title, one-line `sub`, nav group, icon).
2. `src/server/access.ts`: add the id to `PAGE_ACCESS` (and `BRAND_PAGE` if it is one brand's). Add a test row in
   `access.test.ts`.
3. `src/app/(shell)/<path>/page.tsx`:

   ```tsx
   export const metadata: Metadata = { title: PAGES.insight.title };
   export default async function Page() {
     const viewer = requirePage(await getViewer(), "insight"); // first line, always
     const data = getDashboardData(viewer); // already thresholded for this viewer
     return (
       <div className="page-body">
         <PageHeader title={PAGES.insight.title} sub={PAGES.insight.sub} />
         {/* Cards, StatTiles, charts */}
       </div>
     );
   }
   ```

4. Need a new number? Add it to the right type in `data/types.ts` as a `RawCount`, produce it in `synthetic.ts`, and use
   the `Present<...>` result. Never import the provider into a page.
5. Add the route to `tools/shots/routes.dashboard.json`.

## Sign in with YourTal (`src/server/auth/`)

YourTal is the OpenID Connect provider (YourTal `docs/26-sign-in-with-yourtal.md`). The dashboard is the confidential
client `god-dashboard` (private_key_jwt, redirect `https://dashboard.god.gaiada.com/auth/callback`, its own pairwise
sector). `openid-client` 6.8.8 does all the protocol: code flow, PKCE S256, `state`, `nonce`, the `iss` response
parameter, and the ID token checks including the signature (`enableNonRepudiationChecks`). YourTal's tokens are never
stored, logged or sent to the browser.

| Route                                    | What                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /auth/start[?fresh=1&return=/path]` | Starts a sign-in. The transaction (state, nonce, PKCE verifier, return path) goes only in `__Host-god_oidc`: AES-256-GCM under a key derived (HKDF) from `GOD_SESSION_SECRET`, 10 minutes. `fresh=1` is the fresh passkey check for the signed-in session (`max_age=0`). |
| `GET /auth/callback`                     | Deletes the transaction cookie, then refuses or signs in (below).                                                                                                                                                                                                        |
| `POST /auth/signout`                     | POST only, Origin must be `GOD_PUBLIC_URL`; revokes the session, clears the cookie, goes to `/signin?reason=signed-out`.                                                                                                                                                 |
| `POST /auth/yourtal/events`              | YourTal's signed events (SET, verified with `jose` against YourTal's JWKS): `account-deleted` and `access-ended` end the person's sessions.                                                                                                                              |
| `GET /auth/emergency`, `POST /auth/emergency/options`, `POST /auth/emergency/verify` | Emergency Owner sign-in without YourTal (below). |
| `GET /healthz`                           | `{ ok, signIn: "yourtal" \| "dev" \| "off", store }`. Nothing else.                                                                                                                                                                                                      |

**The callback, in order, before any session exists** (`callback.ts`): the transaction cookie opens and `state`
matches; the code is redeemed and the ID token validated; `amr` must contain `hwk` (else `/signin?reason=password`);
`age_band` must be `adult` (a teen: `reason=teen`; missing: `reason=retry`); the allow-list by `sub`, or an unbound
entry bound by its email once (`bindSub`; a second sub for a bound entry is refused); the entry must be invited or
active (else `reason=not-listed`, with no hint whether the email exists). Every refusal writes `signin.refused` with a
keyed hash of the sub (`sub#…`), never the sub or the email. A sign-in writes `signin.ok`; sign-out writes `signout`.

**Sessions** (`session.ts`, `store/limits.ts`): a random 256-bit token in `__Host-god_session` (Secure, HttpOnly,
SameSite=Lax, Path=/, 8 hours); the store holds only its SHA-256. `getViewer()` checks on every request: not revoked,
under 30 minutes idle and 8 hours old, and the person still active on the allow-list. `lastSeenAt` is written at most
once a minute. An ended session lands on `/signin?reason=expired`.

**Fresh passkey check** (`fresh.ts`): exports (insight and teens), opening a Person 360 profile, invites and allow-list
changes, and adding or revoking emergency keys need the session's last YourTal sign-in under 5 minutes old with `amr` containing `hwk`. Otherwise the action
answers with `/auth/start?fresh=1`, the modal sends the browser there (YourTal asks for the passkey again) and back,
and the person presses the button again. The handlers refuse when no gate is passed. Revoking sessions needs no fresh
check: it only protects. An emergency (break-glass) session never passes the gate.

**Settings** (`config.ts`, names in `.env.example`): `YOURTAL_ISSUER`, `GOD_OIDC_CLIENT_ID`, `GOD_OIDC_KEY_FILE`
(secret), `GOD_PUBLIC_URL`, `GOD_SESSION_SECRET` (secret, 32 bytes or more). With dev sign-in off, a missing or bad
one stops the server at start, like the dev guard. The key file holds a private RSA JWK with a `kid`; make one with:

```bash
node -e 'const c=require("node:crypto");const{privateKey:k}=c.generateKeyPairSync("rsa",{modulusLength:2048});const j={...k.export({format:"jwk"}),kid:"god-"+Date.now(),alg:"RS256",use:"sig"};const{d,p,q,dp,dq,qi,...pub}=j;require("fs").writeFileSync("god-oidc.jwk.json",JSON.stringify(j),{mode:0o400});console.log(JSON.stringify({keys:[pub]}))'
```

It prints the public JWKS: that goes to YourTal as `/opt/yourtal/secrets/oidc/clients/god-dashboard.jwks.json`.

**CSP.** `connect-src 'self'` stays: the callback is a navigation. The sign-in button and the fresh check are links
(GET navigations), never form posts, so `form-action 'self'` never meets the redirect to YourTal (browsers apply
`form-action` to a form's redirects too). Sign-out is a form POST to this origin, answered with a redirect to
`/signin`, also this origin.

## Emergency Owner access (break-glass, `src/server/breakglass/`)

Founder decision 2026-11-27: one sealed emergency Owner key, local to the dashboard, for when YourTal is down. It is a
WebAuthn credential (a hardware security key or a passkey) registered with **this dashboard** as the relying party
(RP ID = the host of `GOD_PUBLIC_URL`, origin = `GOD_PUBLIC_URL`), never with YourTal. `@simplewebauthn/server` and
`@simplewebauthn/browser` (14.x, as YourTal), user verification required every time. Nothing new to configure: it is on
whenever real sign-in is configured, and off while dev sign-in is on. Lead's steps: `infra/dashboard/RUNBOOK.md`,
"Emergency Owner access".

| Piece | What |
| --- | --- |
| Store | `BreakGlassStore` (`store/types.ts`), memory and Postgres (migration 0003). Only the public key, credential id, counter, Owner entry id, created, last used and revoked. At most one active key per Owner and two in total, enforced in the database too. |
| Enrolment | Admin, Emergency access (`enrol.ts`, server actions in `actions.ts`). An Owner in a normal YourTal session, the fresh passkey check, and a one-time code the lead makes on the server (`node /app/db/src/cli.ts break-glass-code --owner <id>`, 15 minutes, used once, only its SHA-256 stored; `god_app` cannot make one). Two people: server access plus an Owner session. |
| Sign-in | `/auth/emergency` (not in any nav, not linked from `/signin`), one button. `POST /auth/emergency/options` (rate limit: 5 per network prefix and 20 in total per 15 minutes; a single-use 2-minute challenge, no key named) and `POST /auth/emergency/verify` (`signin.ts`): the key is active, its Owner entry is active with role owner, signature, origin, RP ID and user verification check out, the counter moves forward. Then a normal session row with `amr: ["hwk","break-glass"]` and an absolute limit of **1 hour** (the database checks it too). |
| Least power | An emergency session (`viewer.breakGlass`) reads every Owner page and can revoke sessions. It cannot export (including the print view by URL), open a Person 360 profile, invite or change the allow-list, or add or revoke emergency keys. Enforced twice on the server: `allowedInEmergency` in the handlers (`access.ts`) and the fresh passkey gate, which fails closed for an emergency session with no way to step up; the data layer refuses export views and profiles too. Every screen shows "Emergency access. Every action is recorded." |
| Alert | Audit events `breakglass.code`, `.enrol`, `.revoke`, `.signin`, `.refused` (every refusal). `notifyBreakGlass` (`notify.ts`) writes one JSON line to stderr (`docker logs`). **TODO for the lead:** wire it to the ERP alert route. |

The ceremonies and the rate limit live in process memory (one Node process on Helios): a restart forgets open
ceremonies and resets the limit.

## Dev sign-in

On only when `GOD_DEV_AUTH=1` **and** `GOD_DEPLOYMENT=dev` (`src/server/dev-auth.ts`). `GOD_DEV_AUTH=1` with any other
`GOD_DEPLOYMENT` stops the server at start (`instrumentation.ts`). Staging and production set neither. The role switch
("Prototype: signed in as", and `/dev-role`) calls server actions that check the guard themselves. Cookie values:
`owner`, `executive`, `data`, `brand_lead_yourtal`, `brand_lead_snapapp`, `brand_lead_ftr`. `tools/shots` sets it.
While dev sign-in is on, real sign-in is off (`/auth/*` go to `/signin?reason=unavailable`), the fresh passkey check
passes (dev has no passkeys), and Admin lists seeded fictional sessions.

## Security headers

`next.config.ts`: Referrer-Policy, X-Content-Type-Options, X-Frame-Options, Permissions-Policy, COOP, CORP.
`src/proxy.ts` + `src/lib/csp.ts`: the CSP with a per-request nonce.

```
default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'; img-src 'self' data: blob:;
font-src 'self'; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'none';
form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

`upgrade-insecure-requests` is left out when `GOD_DEPLOYMENT=dev` (plain http). `'unsafe-eval'` and style
`'unsafe-inline'` appear only under `next dev`. Pages are rendered per request (a nonce cannot be prerendered).

## Tests and lint

`pnpm test` is vitest 5 over the pure server code: access, privacy, dev guard, legend, map query validation, CSP, the
data layer, and the map timings (p95 under 300 ms, printed). `pnpm lint` is ESLint 9 with `eslint-config-next` 16.
