# @god/dashboard

The GOD group dashboard (dashboard.god.gaiada.com). Allow-listed GOD staff only. Next 16 App Router, React 19,
Tailwind 4. In this phase every figure is synthetic (`@god/synthetic`) and sign-in is a dev cookie. The map geography is real, from `@god/geo`. Two seams
replace those later, and nothing else changes:

| Seam | File | Today | Later |
|---|---|---|---|
| **Viewer** (who is signed in) | `src/server/viewer.ts` `getViewer()` | the `god_dev_role` cookie, only while dev sign-in is on | Sign in with YourTal, allow-list, passkey |
| **Data** (where numbers come from) | `src/server/data/` `DashboardData` | `synthetic.ts` over `@god/synthetic` | the warehouse |

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

The contract is `src/server/data/MAPS-CONTRACT.md` (read it before building a map screen). In short, all `GET`, JSON,
`Cache-Control: private, no-cache`, `Vary: Cookie`, thresholds applied on the server, no person-level field anywhere:

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
     const viewer = requirePage(await getViewer(), "insight");   // first line, always
     const data = getDashboardData(viewer);                      // already thresholded for this viewer
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

## Dev sign-in

On only when `GOD_DEV_AUTH=1` **and** `GOD_DEPLOYMENT=dev` (`src/server/dev-auth.ts`). `GOD_DEV_AUTH=1` with any other
`GOD_DEPLOYMENT` stops the server at start (`instrumentation.ts`). Staging and production set neither. The role switch
("Prototype: signed in as", and `/dev-role`) calls server actions that check the guard themselves. Cookie values:
`owner`, `executive`, `data`, `brand_lead_yourtal`, `brand_lead_snapapp`, `brand_lead_ftr`. `tools/shots` sets it.

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
