import { describe, expect, it } from "vitest";
import { canonicalUrl, isCurrent, NAV, normalisePath } from "./site";

describe("navigation helpers", () => {
  it("compares paths with and without a trailing slash", () => {
    expect(normalisePath("/about/")).toBe("/about");
    expect(normalisePath("/")).toBe("/");
    expect(isCurrent("/brands/", "/brands")).toBe(true);
    expect(isCurrent("/brands/", "/for-brands/")).toBe(false);
  });

  it("marks exactly one nav item as current on each page", () => {
    for (const item of NAV) {
      expect(NAV.filter((n) => isCurrent(n.href, item.href))).toHaveLength(1);
    }
    expect(NAV.filter((n) => isCurrent(n.href, "/404.html"))).toHaveLength(0);
  });

  it("builds canonical URLs on the live host with a trailing slash", () => {
    expect(canonicalUrl("/")).toBe("https://god.gaiada.com/");
    expect(canonicalUrl("/about")).toBe("https://god.gaiada.com/about/");
    expect(canonicalUrl("/for-brands/")).toBe("https://god.gaiada.com/for-brands/");
  });
});
