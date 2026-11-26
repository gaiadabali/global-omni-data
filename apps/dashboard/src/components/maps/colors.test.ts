import { describe, expect, it } from "vitest";
import { bandColor, fillPct, heatAlpha, mix, parseColor, rgbCss, withAlpha } from "./colors";

describe("parseColor", () => {
  it("reads hex and rgb", () => {
    expect(parseColor("#0c158e")).toEqual([12, 21, 142]);
    expect(parseColor(" #FAFAFE ")).toEqual([250, 250, 254]);
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
    expect(parseColor("rgba(10 20 30 / 0.5)")).toEqual([10, 20, 30]);
  });
  it("returns null for what it cannot read", () => {
    expect(parseColor("")).toBeNull();
    expect(parseColor("color-mix(in srgb, red 10%, blue)")).toBeNull();
    expect(parseColor("#12")).toBeNull();
  });
});

describe("mix", () => {
  it("is the base at 0 and the top at 100", () => {
    expect(mix([0, 0, 0], [200, 100, 50], 0)).toEqual([0, 0, 0]);
    expect(mix([0, 0, 0], [200, 100, 50], 100)).toEqual([200, 100, 50]);
    expect(mix([0, 0, 0], [200, 100, 50], 50)).toEqual([100, 50, 25]);
  });
  it("clamps the percentage", () => {
    expect(mix([10, 10, 10], [20, 20, 20], 500)).toEqual([20, 20, 20]);
    expect(mix([10, 10, 10], [20, 20, 20], -5)).toEqual([10, 10, 10]);
  });
});

describe("band to fill", () => {
  it("gives the <10 band a faint tint that is not zero", () => {
    expect(fillPct(0, 7)).toBe(9);
    expect(fillPct(0, 7)).toBeGreaterThan(0);
  });

  it("rises with the band, from 22 to 90", () => {
    const pcts = [1, 2, 3, 4, 5, 6].map((b) => fillPct(b, 7));
    expect(pcts[0]).toBe(22);
    expect(pcts.at(-1)).toBe(90);
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
  });

  it("copes with a legend of two bands and with a band past the end", () => {
    expect(fillPct(1, 2)).toBe(60);
    expect(fillPct(9, 4)).toBe(fillPct(3, 4));
  });

  it("makes the <10 band differ from the empty colour and from every other band", () => {
    const base: [number, number, number] = [241, 242, 250];
    const brand: [number, number, number] = [177, 39, 155];
    const colors = [0, 1, 2, 3, 4, 5].map((b) => bandColor(b, 6, base, brand).join(","));
    expect(new Set(colors).size).toBe(6);
    expect(colors[0]).not.toBe(base.join(","));
  });

  it("builds the same scale in a dark theme, brightening towards the brand colour", () => {
    const base: [number, number, number] = [16, 20, 58];
    const brand: [number, number, number] = [227, 111, 209];
    const low = bandColor(1, 6, base, brand);
    const high = bandColor(5, 6, base, brand);
    expect(high[0]).toBeGreaterThan(low[0]);
    expect(high[1]).toBeGreaterThan(low[1]);
  });
});

describe("heat", () => {
  it("is faint under the threshold and rises", () => {
    expect(heatAlpha(0, 5)).toBe(0.06);
    expect(heatAlpha(1, 5)).toBe(0.16);
    expect(heatAlpha(4, 5)).toBe(0.88);
    expect(heatAlpha(2, 5)).toBeGreaterThan(heatAlpha(1, 5));
  });
  it("copes with a short legend", () => {
    expect(heatAlpha(1, 2)).toBe(0.6);
  });
});

describe("output formats", () => {
  it("makes deck colours and css colours", () => {
    expect(withAlpha([1, 2, 3], 0.5)).toEqual([1, 2, 3, 128]);
    expect(withAlpha([1, 2, 3], 2)).toEqual([1, 2, 3, 255]);
    expect(rgbCss([1, 2, 3])).toBe("rgb(1, 2, 3)");
  });
});
