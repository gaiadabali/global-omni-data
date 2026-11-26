import areasJson from "../data/areas.json";
import populationJson from "../data/population.json";
import suburbsJson from "../data/suburbs.json";
import manifestJson from "../data/manifest.json";
import type { Area, BBox, Level, LonLat, Suburb } from "./types";

/**
 * The bundled ABS data, turned into indexed arrays once (lazily, on first use). Everything here is read-only.
 * Types are cast from `unknown` on purpose: the JSON files are large and TypeScript need not infer their shapes.
 */
interface AreaRow {
  id: string;
  name: string;
  state?: string;
  sa3?: string;
  sa4?: string;
  gccName?: string;
  areaKm2: number;
  centroid: LonLat;
  bbox: BBox;
}
const AREAS = areasJson as unknown as { ste: AreaRow[]; sa4: AreaRow[]; sa3: AreaRow[]; sa2: AreaRow[] };
const POP = populationJson as unknown as { asAt: string; ageGroups: string[]; sa2: Record<string, number[]> };
const SUBURBS = suburbsJson as unknown as { cols: string[]; rows: (string | number)[][] };
const MANIFEST = manifestJson as unknown as { version?: string };

export interface Store {
  levels: Record<Level, Area[]>;
  byId: Record<Level, Map<string, Area>>;
  /** Per area (by index), residents by ABS 5-year age group: [total, ...18 groups]. */
  ages: Record<Level, Float64Array[]>;
  suburbs: Suburb[];
  suburbByCode: Map<string, Suburb>;
  suburbsByName: Map<string, Suburb[]>;
}

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;
  const rows: Record<Level, AreaRow[]> = { state: AREAS.ste, sa4: AREAS.sa4, sa3: AREAS.sa3, sa2: AREAS.sa2 };
  const parentOf: Record<Level, (r: AreaRow) => string | null> = {
    state: () => null,
    sa4: (r) => r.state ?? null,
    sa3: (r) => r.sa4 ?? null,
    sa2: (r) => r.sa3 ?? null,
  };

  const levels = {} as Record<Level, Area[]>;
  const byId = {} as Record<Level, Map<string, Area>>;
  for (const level of ["state", "sa4", "sa3", "sa2"] as const) {
    levels[level] = rows[level].map((r, index) => ({
      level,
      id: r.id,
      name: r.name,
      parentId: parentOf[level](r),
      state: level === "state" ? r.id : (r.state ?? ""),
      centroid: r.centroid,
      bbox: r.bbox,
      areaKm2: r.areaKm2,
      population: 0,
      index,
      ...(r.gccName !== undefined ? { gccName: r.gccName } : {}),
    }));
    byId[level] = new Map(levels[level].map((a) => [a.id, a]));
  }
  // SA3 and SA2 rows carry their state; give every SA2 and SA3 the state of its parent chain when the row has none.
  for (const a of levels.sa3) if (!a.state) a.state = byId.sa4.get(a.parentId ?? "")?.state ?? "";
  for (const a of levels.sa2) if (!a.state) a.state = byId.sa3.get(a.parentId ?? "")?.state ?? "";

  // Residents by age group, rolled up from the SA2 rows.
  const width = 1 + POP.ageGroups.length;
  const ages = {
    state: levels.state.map(() => new Float64Array(width)),
    sa4: levels.sa4.map(() => new Float64Array(width)),
    sa3: levels.sa3.map(() => new Float64Array(width)),
    sa2: levels.sa2.map(() => new Float64Array(width)),
  } satisfies Record<Level, Float64Array[]>;
  for (const sa2 of levels.sa2) {
    const row = POP.sa2[sa2.id];
    if (!row) continue;
    const chain: Area[] = [sa2];
    let cur: Area | undefined = sa2;
    while (cur?.parentId) {
      const up: Area | undefined = byId[cur.level === "sa2" ? "sa3" : cur.level === "sa3" ? "sa4" : "state"].get(cur.parentId);
      if (!up) break;
      chain.push(up);
      cur = up;
    }
    for (const a of chain) {
      const dst = ages[a.level][a.index]!;
      for (let k = 0; k < width; k++) dst[k] = dst[k]! + (row[k] ?? 0);
    }
  }
  for (const level of ["state", "sa4", "sa3", "sa2"] as const) {
    for (const a of levels[level]) a.population = ages[level][a.index]![0]!;
  }

  const suburbs: Suburb[] = SUBURBS.rows.map((r) => ({
    code: r[0] as string,
    name: r[1] as string,
    state: r[2] as string,
    lon: r[3] as number,
    lat: r[4] as number,
    sa2: r[5] as string,
    areaKm2: r[6] as number,
  }));
  const suburbsByName = new Map<string, Suburb[]>();
  for (const s of suburbs) {
    const k = s.name.toLowerCase();
    const l = suburbsByName.get(k);
    if (l) l.push(s);
    else suburbsByName.set(k, [s]);
  }

  store = {
    levels,
    byId,
    ages,
    suburbs,
    suburbByCode: new Map(suburbs.map((s) => [s.code, s])),
    suburbsByName,
  };
  return store;
}

/** The ABS age groups, "0–4" ... "85 and over". */
export const ABS_AGE_GROUPS: readonly string[] = POP.ageGroups;
/** The date of the population estimate. */
export const POPULATION_AS_AT: string = POP.asAt;
/** A short hash of the data files, for cache-busting the static boundary files. */
export const GEO_VERSION: string = MANIFEST.version ?? "dev";
