# @god/synthetic

Seeded synthetic people, businesses, merchants and aggregates. Nothing here is real. Pure functions: the same
seed gives byte-identical output, and there is no I/O at runtime apart from the bundled JSON below.

| Piece | File |
|---|---|
| Seeded random numbers | `src/rng.ts` |
| Australia: states, about 100 population centres, suburbs, population density | `src/geo.ts` |
| The world: about 200k weighted points (people and businesses), adoption curves, h3 keys | `src/world.ts` |
| Fictional merchant chains with exact shop locations | `src/merchants.ts` |
| About 200 pseudonymous profiles (ids like `G-7F3K-29QD`, no names, emails or phones) | `src/profiles.ts` |
| Brand KPI series that are not derived from points | `src/series.ts` |

`getWorld()` builds the sample once per seed and memoises it. Callers aggregate with `world.aggregate(...)` and the
per-point key arrays (`world.stateKeys`, `world.cellKeys(res)`, `world.activityKeys(res)`); they never loop over rows
of people outside this package.

## Data source

`src/data/au-states.json`: Natural Earth 50m admin-1 states and provinces of Australia, public domain
(https://www.naturalearthdata.com/, "Admin 1 - States, Provinces"), copied unchanged from the approved prototype
(`god-holding/prototypes/dashboard/au-states.json`, 2026-11-26). Used once, at generation time, with d3-geo
`geoContains` to give each point its state.
