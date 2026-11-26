import { describe, expect, it } from "vitest";
import {
  bandValue,
  bubbleMaxPx,
  bubbleRadius,
  changeText,
  levelOfId,
  matchRows,
  monthBefore,
  ordinal,
  shareText,
  signedPct,
  versusText,
  visibleCount,
} from "./pd-lib";

describe("levelOfId", () => {
  it("reads the level from the shape of the id", () => {
    expect(levelOfId("NSW")).toBe("state");
    expect(levelOfId("WA")).toBe("state");
    expect(levelOfId("125")).toBe("sa4");
    expect(levelOfId("12504")).toBe("sa3");
    expect(levelOfId("125041717")).toBe("sa2");
    expect(levelOfId("87be0e9a4ffffff")).toBe("h3");
  });
  it("refuses anything else", () => {
    expect(levelOfId("")).toBeNull();
    expect(levelOfId("M-0100")).toBeNull();
    expect(levelOfId("12")).toBeNull();
    expect(levelOfId("nsw")).toBeNull();
  });
});

describe("ordinal", () => {
  it("handles the teens and the endings", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "101st",
      "111th",
    ]);
  });
});

describe("signedPct and months", () => {
  it("signs a change and skips a missing one", () => {
    expect(signedPct(1.7)).toBe("+1.7%");
    expect(signedPct(0)).toBe("+0.0%");
    expect(signedPct(-2.5)).toBe("−2.5%");
    expect(signedPct(null)).toBeNull();
  });
  it("finds the month before", () => {
    expect(monthBefore(["2026-09", "2026-10", "2026-11"], "2026-11")).toBe("2026-10");
    expect(monthBefore(["2026-09", "2026-10"], "2026-09")).toBeNull();
    expect(monthBefore(["2026-09"], "2030-01")).toBeNull();
  });
});

describe("bubbles", () => {
  it("is proportional to the square root of the value, capped at the level's size", () => {
    const max = bubbleMaxPx("sa3");
    expect(bubbleRadius(100, 100, max)).toBeCloseTo(max);
    expect(bubbleRadius(25, 100, max)).toBeCloseTo(max / 2);
    expect(bubbleRadius(400, 100, max)).toBe(max);
  });
  it("never draws nothing for a count, and nothing for zero", () => {
    expect(bubbleRadius(1, 1_000_000, 30)).toBe(3);
    expect(bubbleRadius(0, 100, 30)).toBe(0);
    expect(bubbleRadius(5, 0, 30)).toBe(3);
  });
  it("is smaller at the finer levels", () => {
    expect(bubbleMaxPx("state")).toBeGreaterThan(bubbleMaxPx("sa4"));
    expect(bubbleMaxPx("sa2")).toBeGreaterThan(bubbleMaxPx(6));
    expect(bubbleMaxPx(6)).toBeGreaterThan(bubbleMaxPx(7));
  });
  it("gives a legend band the value its bubble stands for", () => {
    expect(bandValue({ band: 0, min: 0, max: 10 })).toBe(0);
    expect(bandValue({ band: 2, min: 25, max: 100 })).toBe(50);
    expect(bandValue({ band: 6, min: 2000, max: null })).toBe(3000);
    expect(bandValue({ band: 1, min: 0, max: 0.5 })).toBe(0.25);
  });
});

describe("matchRows", () => {
  const rows = [
    { name: "Parramatta", parent: "Greater Sydney, NSW" },
    { name: "Melbourne City", parent: "Greater Melbourne, VIC" },
    { name: "Sydney - Inner West", parent: "Greater Sydney, NSW" },
  ];
  it("keeps everything for an empty search", () => {
    expect(matchRows(rows, "  ")).toHaveLength(3);
  });
  it("matches words in the name or the parent, in any case and order", () => {
    expect(matchRows(rows, "parra").map((r) => r.name)).toEqual(["Parramatta"]);
    expect(matchRows(rows, "SYDNEY nsw").map((r) => r.name)).toEqual(["Parramatta", "Sydney - Inner West"]);
    expect(matchRows(rows, "perth")).toEqual([]);
  });
});

describe("counts", () => {
  it("gives a number only when the viewer may have it", () => {
    expect(visibleCount({ value: 412, display: "412", suppressed: false })).toBe(412);
    expect(visibleCount({ value: 0, display: "<10", suppressed: true })).toBeNull();
    // An Owner or Data team viewer: small, but exact.
    expect(visibleCount({ value: 4, display: "4", suppressed: true })).toBe(4);
  });
  it("words a change and a share", () => {
    expect(changeText({ value: 140, display: "140", suppressed: false })).toBe("+140");
    expect(changeText({ value: 0, display: "<10", suppressed: true })).toBe("<10 new");
    expect(shareText(0.236)).toBe("24%");
    expect(shareText(0.004)).toBe("<1%");
    expect(shareText(null)).toBeNull();
  });
  it("compares a rate with the national one", () => {
    expect(versusText(22, 20)).toBe("10% above Australia");
    expect(versusText(15, 20)).toBe("25% below Australia");
    expect(versusText(20.1, 20)).toBe("In line with Australia");
    expect(versusText(5, 0)).toBe("No national figure to compare with");
  });
});
