import { ABS_AGE_GROUPS, getStore } from "./data";
import type { Area, BBox, Level } from "./types";
import { LEVELS } from "./types";

/** Areas of a level, sorted by id. The position of an area in this array is its `index`. */
export function areas(level: Level): readonly Area[] {
  return getStore().levels[level];
}

export function getArea(level: Level, id: string): Area | undefined {
  return getStore().byId[level].get(id);
}

/** The area one level up, or undefined for a state. */
export function parentOf(area: Area): Area | undefined {
  if (!area.parentId) return undefined;
  const up: Level = area.level === "sa2" ? "sa3" : area.level === "sa3" ? "sa4" : "state";
  return getStore().byId[up].get(area.parentId);
}

/** The area itself, then its parent, and so on up to its state: [SA2, SA3, SA4, state]. */
export function parentChain(level: Level, id: string): Area[] {
  const out: Area[] = [];
  let cur = getArea(level, id);
  while (cur) {
    out.push(cur);
    cur = parentOf(cur);
  }
  return out;
}

/** The name people read for an area: a state's full name, or the ABS name of the area. */
export function displayName(level: Level, id: string): string {
  return getArea(level, id)?.name ?? id;
}

/**
 * Where an area is, in a few words: "Greater Sydney, NSW". A state is "Australia". An SA4 is placed by its capital-city
 * region ("Greater Sydney, NSW", "Rest of NSW"); an SA3 or SA2 in Greater Sydney, Melbourne and the other capitals
 * says so, and elsewhere is placed by its SA4 ("Capital Region, NSW").
 */
export function parentLabel(level: Level, id: string): string {
  const a = getArea(level, id);
  if (!a) return "";
  if (level === "state") return "Australia";
  const sa4 = level === "sa4" ? a : parentChain(level, id).find((x) => x.level === "sa4");
  const gcc = sa4?.gccName ?? "";
  const withState = (name: string) =>
    name === a.state || /^Rest of /.test(name) || name === stateName(a.state) ? name : `${name}, ${a.state}`;
  if (/^Greater /.test(gcc)) return withState(gcc);
  if (level === "sa4") return withState(gcc || stateName(a.state));
  return withState(sa4?.name ?? stateName(a.state));
}

export function stateName(abbr: string): string {
  return getArea("state", abbr)?.name ?? abbr;
}

/** "Parramatta, Greater Sydney, NSW" style: a name and where it is. */
export function fullLabel(level: Level, id: string): string {
  const name = displayName(level, id);
  const parent = parentLabel(level, id);
  return level === "state" ? name : `${name}, ${parent}`;
}

/** For each area at `from` (by index), the index of its ancestor at `to`. `to` must be the same level or coarser. */
const rollups = new Map<string, Uint16Array>();
export function rollup(from: Level, to: Level): Uint16Array {
  const key = `${from}>${to}`;
  const hit = rollups.get(key);
  if (hit) return hit;
  const fi = LEVELS.indexOf(from);
  const ti = LEVELS.indexOf(to);
  if (ti > fi) throw new RangeError(`cannot roll ${from} up to ${to}`);
  const list = areas(from);
  const out = new Uint16Array(list.length);
  list.forEach((a, i) => {
    let cur: Area | undefined = a;
    while (cur && cur.level !== to) cur = parentOf(cur);
    out[i] = cur ? cur.index : 0;
  });
  rollups.set(key, out);
  return out;
}

/** True for the Other Territories (Christmas Island, Cocos, Norfolk, Jervis Bay): no maps cell, no sample people. */
export function isOtherTerritory(a: Pick<Area, "state">): boolean {
  return a.state === "OT";
}

/** Areas of a level whose bounding box meets `bbox`, Other Territories left out. Without a box: all of them. */
export function areasIn(level: Level, bbox?: BBox): Area[] {
  return areas(level).filter((a) => {
    if (isOtherTerritory(a)) return false;
    if (!bbox) return true;
    return a.bbox[0] <= bbox[2] && a.bbox[2] >= bbox[0] && a.bbox[1] <= bbox[3] && a.bbox[3] >= bbox[1];
  });
}

/* ---------------- population ---------------- */

/** Residents of all of Australia's states and territories (not the Other Territories), 30 June 2025. */
export function nationalPopulation(): number {
  let n = 0;
  for (const a of areas("state")) if (!isOtherTerritory(a)) n += a.population;
  return n;
}

/** Residents by ABS 5-year age group, with the total first: [total, "0–4", ..., "85 and over"]. */
export function ageGroupCounts(level: Level, id: string): readonly number[] | undefined {
  const a = getArea(level, id);
  return a ? getStore().ages[level][a.index] : undefined;
}

export const AGE_GROUP_LABELS: readonly string[] = ABS_AGE_GROUPS;

/** The dashboard's seven age bands: 13–17, 18–24, 25–34, 35–44, 45–54, 55–64, 65+. */
export const BAND_LABELS = ["13–17", "18–24", "25–34", "35–44", "45–54", "55–64", "65+"] as const;

/**
 * Residents aged 13 and over in the dashboard's seven bands. The ABS gives 5-year groups, so 13–17 is taken as
 * 2/5 of the 10–14 group plus 3/5 of the 15–19 group, and 18–24 as 2/5 of 15–19 plus all of 20–24.
 */
export function bandResidents(counts: ArrayLike<number>): number[] {
  const g = (i: number) => counts[1 + i] ?? 0; // group i, after the total
  return [
    0.4 * g(2) + 0.6 * g(3),
    0.4 * g(3) + g(4),
    g(5) + g(6),
    g(7) + g(8),
    g(9) + g(10),
    g(11) + g(12),
    g(13) + g(14) + g(15) + g(16) + g(17),
  ];
}

/** The seven-band residents of an area. */
export function bandResidentsOf(level: Level, id: string): number[] | undefined {
  const c = ageGroupCounts(level, id);
  return c ? bandResidents(c) : undefined;
}
