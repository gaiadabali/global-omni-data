import { areas, bandResidents, ageGroupCounts, isOtherTerritory } from "@god/geo";
import { CITIES, STATE_CODES, kmBetween } from "./geo";
import { cumulative, hash01 } from "./rng";

/**
 * Where the weighted sample puts people: by real population. Each SA2 gets a weight per brand,
 *
 *   weight = residents (ABS ERP, 30 June 2025) x the brand's affinity for the nearest big place x a fixed
 *            per-SA2 wobble (so the maps are not a flat copy of population),
 *
 * and a person goes to an SA2 by weight, then to a random point inside its outline. More people live where more
 * people live. The affinities are the ones the old city model carried (YourTal strong in Brisbane and the Gold
 * Coast, SnapApp in Melbourne, and so on); an SA2 takes those of the nearest modelled place within 4 spreads of it,
 * and the default mix otherwise. Everything here depends on the geography only, not on the seed.
 */
export interface Placement {
  /** Cumulative SA2 weights for a person whose first brand is YourTal, SnapApp or FTR (index 0..2). */
  brandCum: number[][];
  /** Cumulative SA2 weights for a business: residents, leaning to the denser SA2s. */
  bizCum: number[];
  /** Chance that a YourTal or SnapApp person in this SA2 is a teen (the national 9.3% scaled by the SA2's age mix). */
  teenP: Float64Array;
  /** State index (as in STATE_CODES) of each SA2, -1 for the Other Territories. */
  sa2State: Int8Array;
}

const DEFAULT_AFFINITY = [0.9, 0.6, 1.3] as const;
/** Teens are about 8% of users, on YourTal and SnapApp only. Matches world.ts. */
const TEEN_PROBABILITY = 0.0932;

let cached: Placement | null = null;

export function getPlacement(): Placement {
  if (cached) return cached;
  const sa2 = areas("sa2");
  const n = sa2.length;
  const sa2State = new Int8Array(n).fill(-1);
  const affinity: (readonly number[])[] = [];
  const bizW = new Float64Array(n);
  const popW = new Float64Array(n);
  const wobble = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];

  sa2.forEach((a, i) => {
    sa2State[i] = isOtherTerritory(a) ? -1 : STATE_CODES.indexOf(a.state as (typeof STATE_CODES)[number]);
    // The affinity of the nearest modelled place within four spreads, else the default.
    let best = -1;
    let bd = Infinity;
    for (const c of CITIES) {
      const d = kmBetween(a.centroid[1], a.centroid[0], c.lat, c.lon);
      if (d < bd && d <= Math.max(35, 4 * c.spreadKm)) {
        bd = d;
        best = c.index;
      }
    }
    affinity.push(best >= 0 ? CITIES[best]!.affinity : DEFAULT_AFFINITY);
    for (let b = 0; b < 3; b++) wobble[b]![i] = Math.exp((hash01(`${a.id}:${b}`) - 0.5) * 0.8);
    const pop = sa2State[i]! < 0 ? 0 : a.population;
    popW[i] = pop;
    const density = a.areaKm2 > 0 ? pop / a.areaKm2 : 0;
    bizW[i] = pop * Math.pow(1 + density, 0.25) * Math.exp((hash01(`${a.id}:biz`) - 0.5) * 0.8);
  });

  const brandCum = [0, 1, 2].map((b) => cumulative(Array.from(popW, (p, i) => p * affinity[i]![b]! * wobble[b]![i]!)));
  const bizCum = cumulative(Array.from(bizW));

  // Teen share of each SA2's residents aged 13 and over, against the national share.
  const share = new Float64Array(n);
  let teens = 0;
  let adults13 = 0;
  sa2.forEach((a, i) => {
    const counts = ageGroupCounts("sa2", a.id);
    if (!counts || sa2State[i]! < 0) return;
    const bands = bandResidents(counts);
    const total = bands.reduce((x, y) => x + y, 0);
    share[i] = total > 0 ? bands[0]! / total : 0;
    teens += bands[0]!;
    adults13 += total;
  });
  const national = adults13 > 0 ? teens / adults13 : 0.08;
  const factor = new Float64Array(n);
  let weighted = 0;
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    factor[i] = national > 0 ? Math.min(2.2, Math.max(0.4, share[i]! / national)) : 1;
    // The average weight over the three first brands stands for who gets sampled.
    const w = (popW[i]! * (affinity[i]![0]! + affinity[i]![1]!)) / 2;
    weighted += w * factor[i]!;
    wsum += w;
  }
  const norm = wsum > 0 ? weighted / wsum : 1;
  const teenP = new Float64Array(n);
  for (let i = 0; i < n; i++) teenP[i] = Math.min(0.5, (TEEN_PROBABILITY * factor[i]!) / norm);

  cached = { brandCum, bizCum, teenP, sa2State };
  return cached;
}
