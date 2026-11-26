/** The four area levels, coarsest first. Every area has one parent at the next level up (a state has none). */
export const LEVELS = ["state", "sa4", "sa3", "sa2"] as const;
export type Level = (typeof LEVELS)[number];

/** west, south, east, north, in degrees. */
export type BBox = [west: number, south: number, east: number, north: number];

/** A point as [longitude, latitude]. */
export type LonLat = [lon: number, lat: number];

export interface Area {
  level: Level;
  /** A state is its usual abbreviation ("NSW"); every other level is the ABS code ("101", "10102", "101021007"). */
  id: string;
  name: string;
  /** The id of the area one level up, or null for a state. */
  parentId: string | null;
  /** State abbreviation ("NSW"). A state's own. */
  state: string;
  /** A point inside the area, near its middle (not always the true centroid, which can fall outside a crescent). */
  centroid: LonLat;
  bbox: BBox;
  areaKm2: number;
  /** Estimated resident population, 30 June 2025. */
  population: number;
  /** Position in `areas(level)`. Stable: areas are sorted by id. */
  index: number;
  /** SA4 only: the Greater Capital City Statistical Area it belongs to ("Greater Sydney", "Rest of NSW"). */
  gccName?: string;
}

export interface Suburb {
  /** ABS locality (SAL) code. */
  code: string;
  /** The name without ABS's disambiguating suffix: "Richmond", not "Richmond (Vic.)". */
  name: string;
  state: string;
  lon: number;
  lat: number;
  /** The SA2 the point is in. */
  sa2: string;
  areaKm2: number;
}

/** What is at a point: the suburb it is in (nearest, allowing for size), the SA2, and a label for the area. */
export interface Place {
  /** The suburb name, or the SA2 name when no suburb is near. */
  name: string;
  suburb: Suburb | null;
  sa2: Area | null;
  /** "Greater Sydney, NSW". */
  parent: string;
}
