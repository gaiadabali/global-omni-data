import { describe, expect, it } from "vitest";
import { dayRange, fmtDate, fmtDateTime, isIsoDate } from "./dates";
import { classifyPersonQuery } from "./person-query";
import { isExactSmall, isHidden, shareRows, shareText } from "./pnum";

const n = (value: number, display: string, suppressed = false) => ({ value, display, suppressed });

describe("dates", () => {
  it("prints the same text on the server and in the browser", () => {
    expect(fmtDate("2026-11-24")).toBe("24 Nov 2026");
    expect(fmtDate("nonsense")).toBe("nonsense");
    // 09:12 Australian Eastern time (+11:00) is 22:12 UTC the day before.
    expect(fmtDateTime("2026-11-25T22:12:00Z")).toBe("26 Nov 2026, 09:12");
    expect(fmtDateTime("2026-11-26T09:12:00+11:00")).toBe("26 Nov 2026, 09:12");
  });
  it("knows a real date from an impossible one", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
    expect(dayRange("2026-11-24")).toEqual({
      start: Date.parse("2026-11-24T00:00:00+11:00"),
      end: Date.parse("2026-11-25T00:00:00+11:00") - 1,
    });
    expect(dayRange("x")).toBeNull();
  });
});

describe("person search query", () => {
  it("accepts a GOD id or the start of one", () => {
    expect(classifyPersonQuery("")).toBe("empty");
    expect(classifyPersonQuery("   ")).toBe("empty");
    expect(classifyPersonQuery("G-7F3K-29QD")).toBe("id");
    expect(classifyPersonQuery("g-7f3k")).toBe("id");
  });
  it("turns away a name, an email and a phone number", () => {
    expect(classifyPersonQuery("Jane Citizen")).toBe("not-an-id");
    expect(classifyPersonQuery("jane@example.com")).toBe("not-an-id");
    expect(classifyPersonQuery("+61 412 345 678")).toBe("not-an-id");
    expect(classifyPersonQuery("0412345678")).toBe("not-an-id");
  });
});

describe("printing thresholded counts", () => {
  const hidden = n(0, "<10", true);
  const small = n(7, "7", true);
  const big = n(250, "250");
  const whole = n(1000, "1,000");

  it("tells hidden from exact-small from normal", () => {
    expect(isHidden(hidden)).toBe(true);
    expect(isHidden(small)).toBe(false);
    expect(isExactSmall(small)).toBe(true);
    expect(isExactSmall(hidden)).toBe(false);
    expect(isHidden(big)).toBe(false);
  });

  it("shows a share when allowed and the threshold text when not", () => {
    expect(shareText(big, whole)).toBe("25%");
    expect(shareText(hidden, whole)).toBe("<10");
    expect(shareText(small, whole)).toBe("7 (small)");
    expect(shareText(big, hidden)).toBe("250");
  });

  it("a hidden count draws no bar", () => {
    const s = shareRows(
      [
        { label: "a", value: big },
        { label: "b", value: hidden },
      ],
      whole,
    );
    expect(s.values).toEqual([25, 0]);
    expect(s.valueLabels).toEqual(["25%", "<10"]);
  });
});
