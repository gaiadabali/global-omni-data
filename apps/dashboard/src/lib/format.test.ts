import { describe, expect, it } from "vitest";
import { deltaText, fmtAud, fmtCompact, fmtInt, fmtPct, monthLabels, monthLong } from "./format";

describe("format", () => {
  it("groups thousands without Intl", () => {
    expect([0, 999, 1000, 554439, -12345].map(fmtInt)).toEqual(["0", "999", "1,000", "554,439", "-12,345"]);
  });
  it("compacts with lower case k and m", () => {
    expect([950, 1284, 12400, 1250000, 24000000].map(fmtCompact)).toEqual(["950", "1.2k", "12k", "1.3m", "24m"]);
  });
  it("formats money, shares and months", () => {
    expect(fmtAud(238814)).toBe("A$238,814");
    expect(fmtAud(2600000)).toBe("A$2.6m");
    expect(fmtPct(0.058, 1)).toBe("5.8%");
    expect(monthLong("2026-11")).toBe("Nov 2026");
    expect(monthLabels(["2024-12"]).short).toEqual(["Dec 24"]);
  });
  it("describes change, or nothing when there is no base", () => {
    expect(deltaText(105, 100)).toEqual({ text: "+5.0%", up: true });
    expect(deltaText(94, 100)).toEqual({ text: "-6.0%", up: false });
    expect(deltaText(5, 0)).toBeNull();
  });
});
