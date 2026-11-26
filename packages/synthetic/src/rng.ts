/** Seeded random numbers. Same seed, same sequence, on every machine. */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a, mapped to [0, 1). */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function gaussian(rnd: Rng): number {
  const u = 1 - rnd();
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Cumulative-weights lookup: returns the first index whose cumulative weight is >= u * total. */
export function pickCum(cum: readonly number[], u: number): number {
  const total = cum[cum.length - 1] ?? 0;
  const target = u * total;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] ?? 0) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function cumulative(weights: readonly number[]): number[] {
  const out: number[] = [];
  let s = 0;
  for (const w of weights) {
    s += w;
    out.push(s);
  }
  return out;
}
