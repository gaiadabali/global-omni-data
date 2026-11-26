import { describe, expect, it } from "vitest";
import { MapLoader, MapRequestError, QueryCache, isAbort, type Fetcher } from "./query-cache";

describe("QueryCache", () => {
  it("drops the least recently used entry past the limit", () => {
    const c = new QueryCache<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1); // a is now the freshest
    c.set("c", 3);
    expect(c.has("b")).toBe(false);
    expect(c.has("a")).toBe(true);
    expect(c.has("c")).toBe(true);
    expect(c.size).toBe(2);
  });
});

/** A fetcher whose responses the test releases by hand. */
function controlled() {
  const pending: { url: string; resolve: (v: unknown, status?: number) => void; signal: AbortSignal }[] = [];
  const fetcher: Fetcher = (url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      pending.push({
        url,
        signal,
        resolve: (v, status = 200) => resolve({ ok: status === 200, status, json: async () => v }),
      });
    });
  return { fetcher, pending };
}

describe("MapLoader", () => {
  it("fetches once, then answers from the cache", async () => {
    const { fetcher, pending } = controlled();
    const l = new MapLoader<{ n: number }>(fetcher);
    const first = l.load("/api/map/influence?month=2026-11");
    pending[0]!.resolve({ n: 1 });
    expect(await first).toEqual({ n: 1 });
    expect(await l.load("/api/map/influence?month=2026-11")).toEqual({ n: 1 });
    expect(l.stats).toEqual({ requests: 1, aborted: 0, hits: 1 });
  });

  it("aborts the request in flight when a newer query replaces it", async () => {
    const { fetcher, pending } = controlled();
    const l = new MapLoader<{ n: number }>(fetcher);
    const first = l.load("/a");
    const second = l.load("/b");
    expect(pending[0]!.signal.aborted).toBe(true);
    expect(pending[1]!.signal.aborted).toBe(false);
    await expect(first).rejects.toSatisfy(isAbort);
    pending[1]!.resolve({ n: 2 });
    expect(await second).toEqual({ n: 2 });
    expect(l.stats.aborted).toBe(1);
    expect(l.cached("/a")).toBeUndefined();
  });

  it("a cache hit also cancels a slower request that is still in flight", async () => {
    const { fetcher, pending } = controlled();
    const l = new MapLoader<{ n: number }>(fetcher);
    const a = l.load("/a");
    pending[0]!.resolve({ n: 1 });
    await a;
    const slow = l.load("/slow");
    expect(await l.load("/a")).toEqual({ n: 1 });
    expect(pending[1]!.signal.aborted).toBe(true);
    await expect(slow).rejects.toSatisfy(isAbort);
  });

  it("turns an error body into a message", async () => {
    const { fetcher, pending } = controlled();
    const l = new MapLoader<unknown>(fetcher);
    const p = l.load("/bad");
    pending[0]!.resolve({ error: "sensitive categories never appear in teen figures" }, 400);
    await expect(p).rejects.toThrow(MapRequestError);
    await expect(p).rejects.toMatchObject({ status: 400, message: "sensitive categories never appear in teen figures" });
  });

  it("prefetch fills the cache without aborting the live request", async () => {
    const { fetcher, pending } = controlled();
    const l = new MapLoader<{ n: number }>(fetcher);
    const live = l.load("/now");
    l.prefetch("/next");
    expect(pending[0]!.signal.aborted).toBe(false);
    pending[1]!.resolve({ n: 9 });
    pending[0]!.resolve({ n: 1 });
    await live;
    await new Promise((r) => setTimeout(r, 0));
    expect(l.cached("/next")).toEqual({ n: 9 });
    l.prefetch("/next");
    expect(pending).toHaveLength(2);
  });
});
