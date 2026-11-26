import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  forbidden: () => {
    throw new Error("FORBIDDEN");
  },
}));

import { PAGE_IDS, type PageId } from "@/lib/pages";
import {
  canAccessApi,
  canAccessPage,
  canQueryBrand,
  checkPage,
  homePathFor,
  navFor,
  phoneNavFor,
  requireApi,
  requirePage,
} from "./access";
import type { Viewer } from "./types";
import { DEV_ROLE_VALUES, viewerFromDevCookie } from "./viewer";

const v = (cookie: string): Viewer => {
  const viewer = viewerFromDevCookie(cookie);
  if (!viewer) throw new Error(`no viewer for ${cookie}`);
  return viewer;
};

/** The approved prototype's ALLOW map, with the brand lead narrowed to one brand. */
const EXPECTED: Record<string, PageId[]> = {
  owner: [...PAGE_IDS],
  executive: ["home", "yourtal", "snapapp", "ftr", "map", "activity", "insight", "teens"],
  data: ["home", "yourtal", "snapapp", "ftr", "map", "activity", "insight", "teens", "person", "quality"],
  brand_lead_yourtal: ["yourtal", "map", "activity"],
  brand_lead_snapapp: ["snapapp", "map", "activity"],
  brand_lead_ftr: ["ftr", "map", "activity"],
};

describe("access table", () => {
  for (const cookie of DEV_ROLE_VALUES) {
    it(`${cookie} may open exactly the expected pages`, () => {
      const viewer = v(cookie);
      const allowed = PAGE_IDS.filter((id) => canAccessPage(viewer, id));
      expect(allowed.sort()).toEqual([...EXPECTED[cookie]!].sort());
    });

    it(`${cookie}: the nav is the same set as the allowed pages`, () => {
      const viewer = v(cookie);
      const inNav = navFor(viewer).flatMap((g) => g.items.map((i) => i.id));
      expect(inNav.sort()).toEqual([...EXPECTED[cookie]!].sort());
      expect(phoneNavFor(viewer).length).toBeLessThanOrEqual(4);
      for (const p of phoneNavFor(viewer)) expect(canAccessPage(viewer, p.id)).toBe(true);
    });
  }

  it("a brand lead cannot open another brand's page, even by URL", () => {
    const sam = v("brand_lead_yourtal");
    expect(canAccessPage(sam, "snapapp")).toBe(false);
    expect(canAccessPage(sam, "ftr")).toBe(false);
    expect(checkPage(sam, "snapapp")).toBe("forbidden");
  });

  it("no viewer means sign in, never access", () => {
    for (const id of PAGE_IDS) {
      expect(canAccessPage(null, id)).toBe(false);
      expect(checkPage(null, id)).toBe("signin");
    }
    expect(navFor(null)).toEqual([]);
  });

  it("a brand lead without a brand gets no brand page", () => {
    const broken: Viewer = { id: "x", displayName: "X", role: "brand_lead" };
    for (const id of ["yourtal", "snapapp", "ftr"] as const) expect(canAccessPage(broken, id)).toBe(false);
  });
});

describe("requirePage", () => {
  it("redirects to /signin when nobody is signed in", () => {
    expect(() => requirePage(null, "home")).toThrow("REDIRECT /signin");
  });

  it("refuses with a 403 when the role may not open the page", () => {
    expect(() => requirePage(v("executive"), "admin")).toThrow("FORBIDDEN");
    expect(() => requirePage(v("brand_lead_yourtal"), "snapapp")).toThrow("FORBIDDEN");
    expect(() => requirePage(v("brand_lead_yourtal"), "home")).toThrow("FORBIDDEN");
  });

  it("returns the viewer when allowed", () => {
    const owner = v("owner");
    expect(requirePage(owner, "admin")).toEqual(owner);
  });
});

describe("requireApi and brand scope", () => {
  it("401 without a viewer, ok with one", () => {
    expect(requireApi(null, "map.influence")).toMatchObject({ ok: false, status: 401 });
    expect(requireApi(v("executive"), "map.influence")).toMatchObject({ ok: true });
    expect(canAccessApi(v("brand_lead_ftr"), "map.activity")).toBe(true);
  });

  it("a brand lead may query only their own brand, never all", () => {
    const sam = v("brand_lead_yourtal");
    expect(canQueryBrand(sam, "yourtal")).toBe(true);
    expect(canQueryBrand(sam, "snapapp")).toBe(false);
    expect(canQueryBrand(sam, "all")).toBe(false);
    expect(canQueryBrand(v("executive"), "all")).toBe(true);
    expect(canQueryBrand(null, "yourtal")).toBe(false);
  });

  it("lands a brand lead on their brand page and others on the overview", () => {
    expect(homePathFor(v("brand_lead_snapapp"))).toBe("/brands/snapapp");
    expect(homePathFor(v("owner"))).toBe("/");
  });
});
