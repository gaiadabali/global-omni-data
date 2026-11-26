import { describe, expect, it } from "vitest";
import { countBand, countLegend, rateBand, rateLegend, shortBound } from "./legend";

describe("countLegend", () => {
  it("always starts with <10 and adds bands as values grow", () => {
    expect(countLegend([]).map((b) => b.label)).toEqual(["<10"]);
    expect(countLegend([3, 9]).map((b) => b.label)).toEqual(["<10"]);
    expect(countLegend([3, 14]).map((b) => b.label)).toEqual(["<10", "10+"]);
    expect(countLegend([1, 400]).map((b) => b.label)).toEqual(["<10", "10–24", "25–99", "100+"]);
    expect(countLegend([5, 2500]).map((b) => b.label)).toEqual([
      "<10",
      "10–24",
      "25–99",
      "100–499",
      "500–1.9k",
      "2k+",
    ]);
  });

  it("keeps growing for big values", () => {
    const labels = countLegend([0, 120000]).map((b) => b.label);
    expect(labels).toEqual([
      "<10",
      "10–24",
      "25–99",
      "100–499",
      "500–1.9k",
      "2k–9.9k",
      "10k–49k",
      "50k+",
    ]);
  });

  it("starts with <20 for teen and sensitive figures", () => {
    expect(countLegend([5, 300], 20).map((b) => b.label)).toEqual(["<20", "20–49", "50–199", "200+"]);
  });

  it("puts a value in the right band, with exclusive upper bounds", () => {
    const l = countLegend([0, 2500]);
    expect(countBand(9, l)).toBe(0);
    expect(countBand(10, l)).toBe(1);
    expect(countBand(24, l)).toBe(1);
    expect(countBand(25, l)).toBe(2);
    expect(countBand(1999, l)).toBe(4);
    expect(countBand(2000, l)).toBe(5);
    expect(countBand(999999, l)).toBe(5);
  });

  it("is computed from the values returned", () => {
    expect(countLegend([12, 40]).length).toBeLessThan(countLegend([12, 40000]).length);
  });
});

describe("rateLegend", () => {
  it("starts with the suppressed band and has its own scale", () => {
    const l = rateLegend([0.2, 3.4]);
    expect(l.map((b) => b.label)).toEqual(["<10 people", "<0.5", "0.5–1", "1–2", "2+"]);
    expect(rateBand(0.2, l)).toBe(1);
    expect(rateBand(0.5, l)).toBe(2);
    expect(rateBand(3.4, l)).toBe(4);
  });

  it("copes with no rates at all", () => {
    expect(rateLegend([]).map((b) => b.label)).toEqual(["<10 people", "all"]);
  });
});

describe("shortBound", () => {
  it("formats bounds", () => {
    expect([999, 1000, 1900, 9999, 12400].map(shortBound)).toEqual(["999", "1k", "1.9k", "9.9k", "12k"]);
  });
});
