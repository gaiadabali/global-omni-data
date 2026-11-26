# @god/synthetic

Seeded synthetic people, businesses, merchants and aggregates. Nothing here is real. Pure functions: the same
seed gives byte-identical output, and there is no I/O at runtime apart from the bundled JSON below.

| Piece | File |
|---|---|
| Seeded random numbers | `src/rng.ts` |
| Australia: states, about 100 population centres (now only their brand affinities), the old suburb list, place names from `@god/geo` | `src/geo.ts` |
| Where people go: real SA2 population, brand affinities, teen share by SA2 age mix | `src/placement.ts` |
| The world: about 200k weighted points (people and businesses) placed by real SA2 population, adoption curves, h3 keys (res 7 and coarser) | `src/world.ts` |
| Fictional merchant chains with exact shop locations, each in a real suburb | `src/merchants.ts` |
| About 200 pseudonymous profiles (ids like `G-7F3K-29QD`, no names, emails or phones) | `src/profiles.ts` |
| Brand KPI series that are not derived from points | `src/series.ts` |

`getWorld()` builds the sample once per seed and memoises it. Callers aggregate with `world.aggregate(...)` and the
per-point key arrays (`world.stateKeys`, `world.cellKeys(res)`, `world.activityKeys(res)`); they never loop over rows
of people outside this package.

## Data source

`src/data/au-states.json`: Natural Earth 50m admin-1 states and provinces of Australia, public domain
(https://www.naturalearthdata.com/, "Admin 1 - States, Provinces"), copied unchanged from the approved prototype
(`god-holding/prototypes/dashboard/au-states.json`, 2026-11-26). Used once, at generation time, with d3-geo
`geoContains`, now only for the backdrop dots and `stateAt`.

## Real placement (2026-11-26)

People and businesses are placed by real population, from `@god/geo` (ABS ASGS Edition 3, ERP at 30 June 2025): a person
goes to an SA2 by weight, then to a random point inside that SA2's outline, so more people are where more people live.
The weight is the SA2's residents, times the brand's affinity for the nearest modelled place (the old city table, now used
only for that), times a fixed per-SA2 wobble so the maps are not a copy of population. Teens follow each SA2's age mix
(ABS 5-year groups; 13 to 17 is pro-rated from 10-14 and 15-19) and keep the national share of about 8%. The totals are
unchanged: the same 184,820 people points and 13,350 business points, so about 554k registered people. Merchants sit in
real suburbs (ABS localities), weighted by the SA2's residents, and their addresses use the suburb name; the chains stay
fictional. H3 indexes stop at res 7 (about 2 km): there is no street level.
