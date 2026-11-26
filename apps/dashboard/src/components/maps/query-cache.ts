/**
 * Fetching for the maps: one request in flight at a time per screen (a newer one aborts the older), responses
 * cached by their full query string, and a counter so the page can report how many requests a pan made.
 * Pure TypeScript with no React, so it is tested on its own.
 */
export class QueryCache<T> {
  private store = new Map<string, T>();
  constructor(private readonly limit = 48) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (hit !== undefined) {
      // Least recently used goes first out: re-insert on a hit.
      this.store.delete(key);
      this.store.set(key, hit);
    }
    return hit;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  set(key: string, value: T): void {
    this.store.delete(key);
    this.store.set(key, value);
    while (this.store.size > this.limit) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  get size(): number {
    return this.store.size;
  }
}

export class MapRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MapRequestError";
  }
}

export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface LoaderStats {
  /** Network requests started (cache hits do not count). */
  requests: number;
  /** Requests that were aborted because a newer query replaced them. */
  aborted: number;
  hits: number;
}

/**
 * A loader for one kind of response. `load(url)` returns the cached body at once, or fetches it; calling it again
 * with another url aborts the one still in flight. `prefetch(url)` warms the cache without aborting anything.
 */
export class MapLoader<T> {
  readonly cache: QueryCache<T>;
  readonly stats: LoaderStats = { requests: 0, aborted: 0, hits: 0 };
  private current: { url: string; controller: AbortController } | null = null;
  private prefetching = new Set<string>();

  constructor(
    private readonly fetcher: Fetcher,
    limit = 48,
  ) {
    this.cache = new QueryCache<T>(limit);
  }

  cached(url: string): T | undefined {
    return this.cache.get(url);
  }

  async load(url: string): Promise<T | null> {
    const hit = this.cache.get(url);
    if (hit !== undefined) {
      this.stats.hits++;
      this.abortCurrent();
      return hit;
    }
    this.abortCurrent();
    const controller = new AbortController();
    this.current = { url, controller };
    this.stats.requests++;
    try {
      const body = await this.fetchBody(url, controller.signal);
      this.cache.set(url, body);
      return controller.signal.aborted ? null : body;
    } finally {
      if (this.current?.controller === controller) this.current = null;
    }
  }

  prefetch(url: string): void {
    if (this.cache.has(url) || this.prefetching.has(url) || this.current?.url === url) return;
    this.prefetching.add(url);
    this.stats.requests++;
    const controller = new AbortController();
    this.fetchBody(url, controller.signal)
      .then((b) => this.cache.set(url, b))
      .catch(() => undefined)
      .finally(() => this.prefetching.delete(url));
  }

  abortCurrent(): void {
    if (this.current) {
      this.current.controller.abort();
      this.stats.aborted++;
      this.current = null;
    }
  }

  private async fetchBody(url: string, signal: AbortSignal): Promise<T> {
    const res = await this.fetcher(url, { signal });
    if (!res.ok) {
      let message = `The map could not load (error ${res.status}).`;
      try {
        const j = (await res.json()) as { error?: unknown };
        if (typeof j.error === "string") message = j.error;
      } catch {
        // Keep the default message.
      }
      throw new MapRequestError(message, res.status);
    }
    return (await res.json()) as T;
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}
