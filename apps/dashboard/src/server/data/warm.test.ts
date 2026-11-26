import { mkdirSync, writeFileSync } from "node:fs";
import { STATE_CODES, getWorld } from "@god/synthetic";
import { describe, expect, it } from "vitest";
import { warmSynthetic } from "./synthetic";

/**
 * The cold start: the sample (about 200k weighted points placed by real SA2 population), the polygon index, every H3
 * index and the merchants. The server does this in the background at start. This file runs first in a fresh worker, so
 * the number is the whole cost. The brief asks for under about 5 seconds on server-f.
 */
describe("warm-up", () => {
  it("builds everything in under 5 seconds, and writes the sample's totals next to the time", () => {
    const t0 = performance.now();
    warmSynthetic();
    const ms = Math.round(performance.now() - t0);

    const w = getWorld();
    const people = w.peopleByMonth.god[23]!;
    const byState = new Float64Array(8);
    for (let i = 0; i < w.n; i++) if (!w.isBusiness[i]) byState[w.state[i]!] = byState[w.state[i]!]! + w.weight[i]!;
    const lines = [
      `cold start warm-up ${ms} ms`,
      `points ${w.n}; registered people ${people}; businesses ${w.businessesByMonth.god[23]}; teens ${w.teenPeople} (${((100 * w.teenPeople) / people).toFixed(2)}%)`,
      ...(["yourtal", "snapapp", "ftr"] as const).map((b) => `${b}: people ${w.peopleByMonth[b][23]}, businesses ${w.businessesByMonth[b][23]}`),
      `people by state: ${STATE_CODES.map((c, i) => `${c} ${((100 * byState[i]!) / people).toFixed(1)}%`).join(", ")}`,
    ];
    console.log(`WARM-UP cold start: ${ms} ms\n${lines.join("\n")}`);
    mkdirSync("node_modules/.cache", { recursive: true });
    writeFileSync("node_modules/.cache/god-warmup.txt", `${lines.join("\n")}\n`);
    expect(ms).toBeLessThan(5000);
  });
});
