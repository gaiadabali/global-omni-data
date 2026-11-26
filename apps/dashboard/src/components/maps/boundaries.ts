/**
 * The ABS area outlines served as static files (/geo/state.json, sa4.json, sa3.json, sa2.json), generated from
 * @god/geo. Each feature has `properties.code`, the id the map API uses for that area.
 */
import type { StateFeature } from "./states";

export interface BoundaryFeature {
  type: "Feature";
  id?: string;
  properties: { code: string; name: string };
  geometry: StateFeature["geometry"];
}

export interface BoundaryCollection {
  type: "FeatureCollection";
  features: BoundaryFeature[];
}

export function boundaryCode(f: BoundaryFeature): string {
  return f.properties.code;
}
