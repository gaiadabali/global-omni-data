# @god/geo

Real Australian geography from the ABS (ASGS Edition 3): states, SA4, SA3, SA2, 15,000 suburb points, and residents
by SA2 and age. Pure TypeScript over bundled JSON, deterministic, no I/O at runtime. Sources, licence and the build:
`SOURCES.md`.

```ts
import { areas, getArea, parentChain, parentLabel, pointToSa2, nearestSuburb, placeAt, placeForCell } from "@god/geo";

getArea("sa2", "125041717");            // { level, id, name, parentId, state, centroid, bbox, areaKm2, population, index }
parentChain("sa2", id);                  // [SA2, SA3, SA4, state]
parentLabel("sa2", id);                  // "Greater Sydney, NSW"
pointToSa2(151.0035, -33.815);           // the SA2 containing a point, or null in the sea
nearestSuburb(151.0035, -33.815);        // { suburb: { name: "Parramatta", ... }, distanceKm }
placeForCell(h3Index);                   // { name: "Parramatta", suburb, sa2, parent: "Greater Sydney, NSW" }
```

| File | What |
|---|---|
| `src/areas.ts` | levels, lookups by code, parent chain, labels, `rollup(from, to)`, population and age bands |
| `src/locate.ts` | spatial index over the SA2 polygons, point to SA2, random point in an SA2, nearest suburb, places |
| `src/topo.ts`, `src/shape.ts` | TopoJSON reader and plane geometry. No imports, erasable TypeScript only, so the build scripts can import them |
| `src/boundaries.ts` | `boundaryGeoJSON(level)`: the display boundaries as GeoJSON |
| `data/*.js` | generated and committed (`scripts/build-data.mjs`); about 6.7 MB. Each is `export default JSON.parse("...")` with a one-line `.d.ts`: a plain `.json` made TypeScript infer a type for every number (out of memory), and an object literal made Turbopack parse hundreds of thousands of them (out of memory). `manifest.json` stays JSON |
| `scripts/emit-public.mjs` | writes the four boundary files as GeoJSON into the dashboard's `public/geo` at dev and build time |

Ids: a state is its abbreviation (`NSW`); SA4, SA3 and SA2 use the ABS codes. `index` is the position in
`areas(level)` (sorted by id), so a sample can keep a `Uint16Array` of SA2 indexes and roll it up with `rollup`.

The "Other Territories" (Christmas Island, Cocos, Norfolk Island, Jervis Bay) are in the data as state `OT`, and left
out of `areasIn` and `nationalPopulation`.

Rebuild the data: `bash scripts/server-f/remote-build.sh <tree> geo-data <name>`, then commit `packages/geo/data`.
