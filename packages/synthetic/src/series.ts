import { mulberry32 } from "./rng";
import { MONTH_COUNT } from "./world";

/** A noisy ramp from `start` to `end` over the months. Used for KPIs that are not derived from points. */
export function trend(seed: number, start: number, end: number, noise = 0.03, power = 1.25): number[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: MONTH_COUNT }, (_, i) =>
    Math.round((start + (end - start) * Math.pow(i / (MONTH_COUNT - 1), power)) * (1 + (rnd() - 0.5) * noise * 2)),
  );
}
