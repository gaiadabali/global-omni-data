import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { warmSynthetic } from "./synthetic";

/**
 * The cold start: the sample (about 200k weighted points placed by real SA2 population), the polygon index, every H3
 * index and the merchants. The server does this in the background at start. This file runs first in a fresh worker, so
 * the number is the whole cost. The brief asks for under about 5 seconds on server-f.
 */
describe("warm-up", () => {
  it("builds everything in under 5 seconds", () => {
    const t0 = performance.now();
    warmSynthetic();
    const ms = Math.round(performance.now() - t0);
    console.log(`WARM-UP cold start: ${ms} ms`);
    mkdirSync("node_modules/.cache", { recursive: true });
    writeFileSync("node_modules/.cache/god-warmup.txt", `cold start warm-up ${ms} ms\n`);
    expect(ms).toBeLessThan(5000);
  });
});
