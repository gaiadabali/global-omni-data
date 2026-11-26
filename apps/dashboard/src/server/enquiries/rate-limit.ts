/**
 * The contact form's rate limit, in memory (a restart resets it; nginx has its own limit_req in front, see
 * infra/dashboard/RUNBOOK.md). Sliding window: at most `perPrefix` requests per network prefix and `global` in total
 * in any `windowMs`. The prefix is checked first, and only a request that passes it counts against the global limit,
 * so one noisy network cannot use up everyone else's turn.
 */
export const ENQUIRY_WINDOW_MS = 3_600_000;
export const ENQUIRY_PER_PREFIX = 5;
export const ENQUIRY_GLOBAL = 100;
/** The most prefixes remembered at once. Past it, the oldest idle ones are dropped, so the map cannot grow without bound. */
const MAX_PREFIXES = 10_000;

export type LimitResult =
  | { ok: true }
  | { ok: false; scope: "prefix" | "global"; retryAfterSeconds: number };

export interface EnquiryLimiter {
  take(prefix: string, now: number): LimitResult;
}

export function createEnquiryLimiter(
  opts: { windowMs?: number; perPrefix?: number; global?: number } = {},
): EnquiryLimiter {
  const windowMs = opts.windowMs ?? ENQUIRY_WINDOW_MS;
  const perPrefix = opts.perPrefix ?? ENQUIRY_PER_PREFIX;
  const globalMax = opts.global ?? ENQUIRY_GLOBAL;
  const hits = new Map<string, number[]>();
  let all: number[] = [];
  const live = (list: number[] | undefined, now: number) => (list ?? []).filter((t) => now - t < windowMs);
  const wait = (list: number[], now: number) =>
    Math.max(1, Math.ceil(((list[0] ?? now) + windowMs - now) / 1000));

  return {
    take(prefix, now) {
      all = live(all, now);
      for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      if (hits.size >= MAX_PREFIXES) for (const k of [...hits.keys()].slice(0, hits.size - MAX_PREFIXES + 1)) hits.delete(k);

      const mine = live(hits.get(prefix), now);
      if (mine.length >= perPrefix) return { ok: false, scope: "prefix", retryAfterSeconds: wait(mine, now) };
      if (all.length >= globalMax) return { ok: false, scope: "global", retryAfterSeconds: wait(all, now) };
      mine.push(now);
      all.push(now);
      hits.set(prefix, mine);
      return { ok: true };
    },
  };
}

type Holder = { __godEnquiryLimiter?: EnquiryLimiter };

/** The one limiter for this process, on globalThis so every route bundle shares it. */
export function getEnquiryLimiter(): EnquiryLimiter {
  const g = globalThis as Holder;
  g.__godEnquiryLimiter ??= createEnquiryLimiter();
  return g.__godEnquiryLimiter;
}
