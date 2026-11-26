import { randomBytes } from "node:crypto";
import { CEREMONY_TIMEOUT_MS } from "./webauthn";

/**
 * Two small pieces of process memory for break-glass. The dashboard is one Node process in one container on Helios
 * (infra/dashboard/compose.yaml), so memory is shared by every request. A restart forgets both, which is safe: an
 * open ceremony simply has to start again, and the rate limit starts again from zero (an attacker cannot restart
 * the container).
 *
 *   ceremonies   each WebAuthn challenge, single-use: taken (read and deleted) before the answer is checked, so a
 *                replayed or second answer finds nothing. Two minutes. Bounded in size.
 *   rate limit   emergency sign-in attempts per network prefix and in total, in a sliding window.
 */

export interface Ceremony {
  kind: "enrol" | "signin";
  challenge: string;
  /** Enrolment only: the session, the Owner and the code's hash it was started with. */
  sessionId?: string;
  ownerId?: string;
  codeHash?: string;
}

export interface CeremonyStore {
  /** Keeps the ceremony; returns its id (random, 128 bits). */
  put(c: Ceremony, now: number): string;
  /** The ceremony, once, if it has not expired; deleted either way. */
  take(id: unknown, now: number): Ceremony | null;
}

const CEREMONY_ID = /^[A-Za-z0-9_-]{22}$/;

export function createCeremonyStore(opts: { ttlMs?: number; max?: number } = {}): CeremonyStore {
  const ttl = opts.ttlMs ?? CEREMONY_TIMEOUT_MS;
  const max = opts.max ?? 200;
  const open = new Map<string, { c: Ceremony; expiresAt: number }>();
  const sweep = (now: number) => {
    for (const [id, o] of open) if (o.expiresAt <= now) open.delete(id);
    // Oldest first (a Map keeps insertion order): a flood can only push out other open ceremonies.
    for (const id of open.keys()) {
      if (open.size < max) break;
      open.delete(id);
    }
  };
  return {
    put(c, now) {
      sweep(now);
      const id = randomBytes(16).toString("base64url");
      open.set(id, { c: { ...c }, expiresAt: now + ttl });
      return id;
    },
    take(id, now) {
      if (typeof id !== "string" || !CEREMONY_ID.test(id)) return null;
      const o = open.get(id);
      open.delete(id);
      if (!o || o.expiresAt <= now) return null;
      return { ...o.c };
    },
  };
}

export const RATE_WINDOW_MS = 15 * 60_000;
export const RATE_PER_PREFIX = 5;
export const RATE_GLOBAL = 20;

export type RateResult =
  | { ok: true }
  | {
      ok: false;
      scope: "prefix" | "global";
      /** True the first time this limit refuses in the current window: audit that one, not a flood. */
      first: boolean;
    };

export interface RateLimiter {
  take(prefix: string, now: number): RateResult;
}

/** Sliding window: at most `perPrefix` attempts per network prefix and `global` in total in any `windowMs`. */
export function createRateLimiter(
  opts: { windowMs?: number; perPrefix?: number; global?: number } = {},
): RateLimiter {
  const windowMs = opts.windowMs ?? RATE_WINDOW_MS;
  const perPrefix = opts.perPrefix ?? RATE_PER_PREFIX;
  const globalMax = opts.global ?? RATE_GLOBAL;
  const hits = new Map<string, number[]>();
  let all: number[] = [];
  const noted = new Map<string, number>();
  const recent = (list: number[] | undefined, now: number) =>
    (list ?? []).filter((t) => now - t < windowMs);
  const firstRefusal = (key: string, now: number) => {
    const last = noted.get(key);
    if (last !== undefined && now - last < windowMs) return false;
    noted.set(key, now);
    return true;
  };
  return {
    take(prefix, now) {
      all = recent(all, now);
      // Forget idle prefixes and old notes so the maps cannot grow without bound.
      for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      for (const [k, t] of noted) if (now - t >= windowMs) noted.delete(k);
      const mine = recent(hits.get(prefix), now);
      if (all.length >= globalMax)
        return { ok: false, scope: "global", first: firstRefusal("*global*", now) };
      if (mine.length >= perPrefix)
        return { ok: false, scope: "prefix", first: firstRefusal(prefix, now) };
      mine.push(now);
      all.push(now);
      hits.set(prefix, mine);
      return { ok: true };
    },
  };
}

type Holder = { __godBreakGlass?: { ceremonies: CeremonyStore; limiter: RateLimiter } };

/** The process's one ceremony store and rate limiter, on globalThis so every route bundle shares them. */
export function getBreakGlassRuntime(): { ceremonies: CeremonyStore; limiter: RateLimiter } {
  const g = globalThis as Holder;
  g.__godBreakGlass ??= { ceremonies: createCeremonyStore(), limiter: createRateLimiter() };
  return g.__godBreakGlass;
}
