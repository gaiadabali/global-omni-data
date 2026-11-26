# The map API: contract for the map pages

Written first, then built (2026-11-26). The UI is built against this file. Code: `src/server/map-api.ts` (validation and
handlers), `src/server/data/synthetic.ts` (the provider), `src/server/data/present.ts` (thresholds), tests beside them.
Geography is real (ABS, `@god/geo`, ASGS Edition 3 and ERP 30 June 2025). The people, businesses and receipts are
synthetic.

## Rules that hold for every endpoint

- `GET`, JSON. Headers: `Cache-Control: private, no-cache`, `Vary: Cookie`, a locked-down CSP. Not signed in: 401. A role
  that may not use the endpoint, or a brand lead asking for another brand or for `all`: 403. A bad query: 400 with
  `{ error }`. An unknown area id: 404.
- **Every count passes through `presentCount` on the server.** Adult figures under 10 show `"<10"`. Teen figures and
  sensitive-category figures under 20 show `"<20"`. Owner and Data team see exact small adult counts (`suppressed: true`,
  the UI marks them); a teen count under 20 exists for nobody. A brand lead's figures cover their own brand only.
- **Teens**: every teen figure covers 20 or more teens, or shows `"<20"`. Alcohol, vape, gambling and other sensitive
  categories (today: `pharm`) never appear in teen figures, and asking for them with the teen band is a 400.
- **No person-level data leaves the server.** Nothing here is a person, a person id or a person's point. Areas have a
  centroid (an area's label point, or an H3 cell's centre). Merchants are businesses and keep their shop location.
- A suppressed count is `value: 0` for roles that may not see it. Series are arrays of numbers with 0 for a suppressed month.
- Months are `YYYY-MM`, `2024-12` to `2026-11`. Ids: a state is its abbreviation (`NSW`, `VIC`, `QLD`, `WA`, `SA`, `TAS`,
  `ACT`, `NT`); SA4, SA3 and SA2 are the ABS codes (`125`, `12504`, `125041717`); an H3 cell is its index.
- **No street level.** The finest level is an SA2 or an H3 cell of resolution 7 (about 2 km across). `res` 8 and above is a 400.

### Names and places (all endpoints)

- `name`: a real place name. State: "New South Wales". SA4/SA3/SA2: the ABS name ("Sydney - Parramatta"). **H3 cell: the
  suburb that contains the centre** ("Parramatta"; the suburb file has points, not outlines, so it is the nearest suburb,
  counting each suburb as a disc of its own area, capped at 4 km radius).
- `parent`: where it is, in a few words. State: "Australia". SA4: "Greater Sydney, NSW", or for a regional SA4 its
  region "Rest of NSW". SA3, SA2 and H3 cells: "Greater Sydney, NSW" in a capital city region, otherwise the SA4
  ("Capital Region, NSW").
- `centroid`: `[lon, lat]`.

## 1. `GET /api/map/influence`

`?brand=yourtal|snapapp|ftr|all` (default all) `&audience=businesses|people|both` (both) `&measure=count|per1000` (count)
`&month=YYYY-MM` (current) `&level=state|sa4|sa3|sa2|h3` (state) `&res=6|7` (h3 only, default 6) `&bbox=w,s,e,n`.

`bbox` is **required for `sa2` and `h3`**, and optional for state, sa4 and sa3 (it then keeps the areas whose box meets it).
Other Territories are never returned.

```jsonc
{
  "query": { "brand": "all", "audience": "both", "measure": "count", "month": "2026-11",
             "level": "sa2",            // or "state" | "sa4" | "sa3" | { "h3": 7 }
             "bbox": [150.6, -34.2, 151.5, -33.5] },
  "unit": "people",                      // or "per 1,000"
  "trendMonths": ["2025-12", "..."],     // the months of every cell's trend: the last 12 ending at `month` (fewer in 2024-12 to 2025-10)
  "cells": [{
    "id": "125041717", "name": "Parramatta - Rosehill", "label": "Parramatta - Rosehill",   // label = name, kept for old callers
    "parent": "Greater Sydney, NSW", "centroid": [151.004, -33.826],
    "population": 21850,                 // residents, ABS ERP (H3: the cell's share of the SA2s under it)
    "value": 412, "display": "412", "suppressed": false, "band": 3,   // as before: value is the count, or the rate for per1000
    "trend": [380, 385, 390, 395, 399, 402, 404, 406, 408, 409, 411, 412],   // running totals, presented (0 when suppressed)
    "newThisMonth": { "value": 1, "display": "<10", "suppressed": true }     // joined in `month`, presented
  }],
  "legend": [{ "band": 0, "label": "<10", "min": 0, "max": 10 }, "..."],
  "truncated": false                     // true when the cap (20,000 cells; 8,000 at H3 res 7) dropped the smallest
}
```

Legend rules are as before: the count legend always starts `<10`; per 1,000 has its own scale, with band 0 for suppressed
cells. `trend` is always counts, even for `measure=per1000`.

## 2. `GET /api/map/summary`

`?brand&audience&measure&month` as above, `&level=state|sa4|sa3|sa2` (state; no `bbox`, no `h3`), `&limit=1..100` (20).

```jsonc
{
  "query": { "brand": "all", "audience": "both", "measure": "count", "month": "2026-11", "level": "sa4", "limit": 20 },
  "unit": "people",
  "trendMonths": ["..."],
  "headline": {
    "total": { "value": 552310, "display": "552,310", "suppressed": false },       // the selection, nationally
    "newThisMonth": { "value": 9120, "display": "9,120", "suppressed": false },
    "growthPct": 1.7,                                   // new this month over last month's total, or null
    "per1000": 20.0                                     // nationally, per 1,000 residents
  },
  "areas": [{                                           // ranked by value (the rate, for per1000), highest first
    "rank": 1, "id": "125", "name": "Sydney - Parramatta", "parent": "Greater Sydney, NSW", "centroid": [151.0, -33.8],
    "population": 412000, "value": 9120, "display": "9,120", "suppressed": false,
    "change": { "value": 140, "display": "140", "suppressed": false },   // new this month
    "changePct": 1.6,                                   // change over last month's total, or null
    "trend": [ "..." ]                                  // 12 presented values
  }],
  "movers": [ "..." ]                                   // the 5 areas with the most new this month (change not suppressed); same shape as areas
}
```

Areas whose figure is suppressed for the viewer sort after the visible ones, by id (never by their hidden size).

## 3. `GET /api/map/area`

`?level=state|sa4|sa3|sa2|h3&id=...&brand&audience&month` (`brand=all` default, `audience=both`, month current). The id of an
`h3` level is an H3 index of resolution 6 or 7.

```jsonc
{
  "query": { "level": "sa2", "id": "125041717", "brand": "all", "audience": "both", "month": "2026-11" },
  "area": { "level": "sa2", "id": "125041717", "name": "Parramatta - Rosehill", "parent": "Greater Sydney, NSW",
            "parents": [ { "level": "sa3", "id": "12504", "name": "Parramatta" }, { "level": "sa4", "id": "125", "name": "Sydney - Parramatta" },
                         { "level": "state", "id": "NSW", "name": "New South Wales" } ],
            "population": 21850, "centroid": [151.004, -33.826], "areaKm2": 7.4 },   // areaKm2 is null for an H3 cell; a cell also has "res"
  "selection": {
    "unit": "people",
    "value": { "value": 412, "display": "412", "suppressed": false },
    "per1000": 18.9, "nationalPer1000": 20.0,           // per1000 is null while the value is suppressed
    "newThisMonth": { "value": 3, "display": "<10", "suppressed": true },
    "growthPct": 0.7,
    "rank": { "rank": 12, "of": 41, "within": "Parramatta" }   // among the areas with the same parent (an H3 cell: among the cells in its SA2); rank is null while suppressed
  },
  "brands": [ { "brand": "yourtal", "name": "YourTal", "people": { "...": 0 }, "businesses": { "...": 0 } } ],  // a brand lead gets only their own
  "god": { "people": { "...": 0 }, "businesses": { "...": 0 } },    // all of GOD, each person counted once; null for a brand lead
  "series": { "months": ["2024-12", "..."], "values": [ 20, 24, "..." ] },   // the selection's running total, up to 24 months ending at `month`
  "ageMix": [ { "band": "13–17", "teen": true, "people": { "value": 0, "display": "<20", "suppressed": true }, "share": null },
              { "band": "18–24", "teen": false, "people": { "...": 0 }, "share": 0.21 } ]   // people aged 13+; [] when audience is businesses
}
```

`ageMix` teen figures use the teen threshold (`<20`). `share` is the band's part of the bands the viewer can see (null for a
suppressed band), so a hidden band cannot be worked back out from the others.

## 4. Activity map

`GET /api/map/activity` is as before (`category`, `ageBand`, `month`, `h3=5|6|7`, `bbox`; `bbox` required at 7 (the UI sends one from 6); **`h3=8` is a
400**), and now each heat cell has `name`, `parent` and `centroid`:
`heat: [{ id, name, parent, centroid, value, display, suppressed, band }]`. Merchants are unchanged (id, name, category, lat, lon,
value, display, suppressed). A brand lead gets only people who also use their brand.

### `GET /api/map/hotspots`

`?category=...&ageBand=...&month=...&bbox=w,s,e,n&limit=1..50` (10). The top activity areas (H3 res 7 cells) in the box, by people
active with the category and age filters. Areas under the threshold are left out.

```jsonc
{
  "query": { "month": "2026-11", "category": "cafe", "ageBand": "25–34", "bbox": [ ... ], "limit": 10 },
  "hotspots": [{ "rank": 1, "id": "87be0e9a4ffffff", "name": "Parramatta", "parent": "Greater Sydney, NSW", "centroid": [151.0, -33.81],
                 "value": 840, "display": "840", "suppressed": false,
                 "mix": [ { "category": "cafe", "name": "Cafés & takeaway", "sensitive": false,
                            "value": 190, "display": "190", "suppressed": false, "share": 0.23 } ] }]   // the category mix (age filter applied, category filter not)
}
```

### `GET /api/map/activity-area`

`?level=h3|sa2&id=...&month&category&ageBand`. One heat cell (H3 res 5 to 7) or one SA2 (activity cells assigned to the SA2 that
holds their centre). Teen rules apply.

```jsonc
{
  "query": { "level": "h3", "id": "...", "month": "2026-11" },
  "area": { "level": "h3", "id": "...", "name": "Parramatta", "parent": "Greater Sydney, NSW", "centroid": [151.0, -33.81] },
  "total": { "value": 840, "display": "840", "suppressed": false },
  "categoryMix": [ { "category": "cafe", "name": "...", "sensitive": false, "people": { "...": 0 }, "share": 0.23 } ],   // sensitive categories absent for teens
  "ageMix": [ { "band": "18–24", "teen": false, "people": { "...": 0 }, "share": 0.2 } ],   // the teen band is absent when the category is sensitive
  "merchants": [ { "id": "M-0100", "name": "Harbour & Bean Parramatta", "category": "cafe", "suburb": "Parramatta",
                   "lat": -33.81, "lon": 151.0, "value": 150, "display": "150", "suppressed": false } ]   // top 10 by receipts, businesses only
}
```

## 5. Boundaries

Static, same-origin, generated from `@god/geo` when the dashboard is built or run (`node packages/geo/scripts/emit-public.mjs`,
called by `dev` and `build`), so there is one copy of the data in git, not two. They are not in git.

| File | Features |
|---|---|
| `/geo/state.json` | 9 |
| `/geo/sa4.json` | 89 |
| `/geo/sa3.json` | 340 |
| `/geo/sa2.json` | 2,454 |

Plain GeoJSON `FeatureCollection`. Each feature has `id` and `properties: { code, name }`; `code` is the id the API uses (a state's
`code` is `NSW`). Join with `cells[].id`. `mapMeta()` (the server passes it to the map pages) carries `geo.version` and `geo.levels` (the URLs with
`?v=<version>`). Those URLs are served with `Cache-Control: public, max-age=31536000, immutable`; the version changes whenever the
data does. The CSP stays `connect-src 'self'`.

## 6. Speed

Target p95 under 300 ms for every endpoint on the sample, measured in `map-api.test.ts` (printed, and written to
`node_modules/.cache/god-timings.txt`). The sample, the H3 indexes and the polygon index are built at server start.
