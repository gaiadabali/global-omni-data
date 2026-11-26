import sa2 from "../data/sa2.topo.js";
import sa3 from "../data/sa3.topo.js";
import sa4 from "../data/sa4.topo.js";
import ste from "../data/ste.topo.js";
import { getArea } from "./areas";
import { toFeatureCollection, type GeoFeatureCollection, type Topology } from "./topo";
import type { Level } from "./types";

export type BoundaryCollection = GeoFeatureCollection;

const TOPO: Record<Level, Topology> = {
  state: ste as unknown as Topology,
  sa4: sa4 as unknown as Topology,
  sa3: sa3 as unknown as Topology,
  sa2: sa2 as unknown as Topology,
};

export const boundaryLevels: readonly Level[] = ["state", "sa4", "sa3", "sa2"];

/** Display boundaries of a level as GeoJSON: each feature has `id` and `properties.code` (the area id) and `name`. */
export function boundaryGeoJSON(level: Level): BoundaryCollection {
  return toFeatureCollection(TOPO[level], (id) => ({ code: id, name: getArea(level, id)?.name ?? id }));
}
