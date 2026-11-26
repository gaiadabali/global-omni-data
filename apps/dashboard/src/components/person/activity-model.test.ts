import { describe, expect, it } from "vitest";
import {
  areaLine,
  defaultView,
  hasFarOutliers,
  mapAltText,
  outlierLabels,
  pct,
  tipForOutlier,
  type ActivityArea,
  type ActivityOutlier,
  type PersonActivity,
} from "./activity-model";

const box = (w: number, s: number, e: number, n: number) => ({ west: w, south: s, east: e, north: n });
const poly = { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const num = (v: number) => ({ value: v, display: String(v), suppressed: v < 10 });

const home: ActivityArea = {
  kind: "home",
  label: "Parramatta",
  suburbs: ["Parramatta", "Harris Park", "Granville", "Rosehill", "Camellia", "Clyde"],
  basis: "receipts",
  receipts: num(24),
  share: 0.42,
  categories: [{ category: "groc", label: "Groceries", receipts: num(10), share: 0.42 }],
  centre: { lon: 151, lat: -33.8 },
  fence: poly,
};

const out = (id: string, suburb: string, km: number): ActivityOutlier => ({
  id,
  date: "2026-11-02",
  suburb,
  state: "VIC",
  category: "cafe",
  categoryName: "Cafés & takeaway",
  merchant: `Harbour & Bean ${suburb}`,
  lon: 145,
  lat: -37.8,
  distanceKm: km,
  from: "home",
  distanceText: `${km} km from home area`,
});

function activity(outliers: ActivityOutlier[], all = box(150.9, -33.9, 151.1, -33.7)): PersonActivity {
  return {
    days: 90,
    totalReceipts: num(57),
    areas: [home],
    points: [],
    outliers,
    view: { areas: box(150.9, -33.9, 151.1, -33.7), all },
    context: [],
  };
}

describe("activity model", () => {
  it("prints shares, with <1% for a sliver", () => {
    expect(pct(0.42)).toBe("42%");
    expect(pct(0.001)).toBe("<1%");
    expect(pct(0)).toBe("0%");
  });

  it("an area row says how big the area is, from the presented count", () => {
    expect(areaLine(home)).toBe("24 receipts · 42% of the last 90 days");
    expect(areaLine({ ...home, receipts: { value: 1, display: "1", suppressed: true } })).toBe("1 receipt · 42% of the last 90 days");
  });

  it("opens on the whole picture unless an outlier is far away", () => {
    expect(defaultView(activity([]))).toBe("areas");
    const near = activity([out("o1", "Ryde", 8)], box(150.9, -33.9, 151.2, -33.7));
    expect(hasFarOutliers(near)).toBe(false);
    expect(defaultView(near)).toBe("all");
    const far = activity([out("o1", "Ballarat", 600)], box(143, -37.9, 151.1, -33.7));
    expect(hasFarOutliers(far)).toBe(true);
    expect(defaultView(far)).toBe("areas");
  });

  it("labels each outlier suburb once", () => {
    const a = activity([out("o1", "Ballarat", 600), out("o2", "Ballarat", 600), out("o3", "Bendigo", 580)]);
    expect(outlierLabels(a).map((o) => o.id)).toEqual(["o1", "o3"]);
  });

  it("gives the map a text alternative that counts the lists", () => {
    const text = mapAltText(activity([out("o1", "Ballarat", 600)]));
    expect(text).toContain("1 activity area");
    expect(text).toContain("home area around Parramatta");
    expect(text).toContain("1 outlier: Ballarat, VIC, 600 km from home area");
    expect(mapAltText(activity([]))).toContain("no outliers");
  });

  it("an outlier's detail has its date, suburb, category and merchant", () => {
    const tip = tipForOutlier(out("o1", "Ballarat", 600), (d) => `on ${d}`);
    expect(tip.title).toBe("Ballarat, VIC");
    expect(tip.rows.map((r) => r[0])).toEqual(["Date", "Category", "Merchant", "Distance"]);
    expect(tip.rows[0]![1]).toBe("on 2026-11-02");
  });
});
