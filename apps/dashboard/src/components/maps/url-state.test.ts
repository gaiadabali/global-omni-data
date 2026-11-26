import { describe, expect, it } from "vitest";
import {
  parseActivityState,
  parseInfluenceState,
  parseView,
  serialiseActivityState,
  serialiseInfluenceState,
  type MapMetaLike,
} from "./url-state";

const months = Array.from({ length: 24 }, (_, i) => {
  const idx = 2024 * 12 + 11 + i;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
});
const meta: MapMetaLike = {
  months,
  currentMonth: "2026-11",
  ageBands: ["13–17", "18–24", "25–34", "35–44", "45–54", "55–64", "65+"],
  teenBand: 0,
  categories: [
    { id: "fuel", name: "Fuel", sensitive: false },
    { id: "cafe", name: "Cafés & takeaway", sensitive: false },
    { id: "pharm", name: "Pharmacy & health", sensitive: true },
  ],
};
const sp = (s: string) => new URLSearchParams(s);

describe("view", () => {
  it("needs z, lat and lon together", () => {
    expect(parseView(sp("z=9.6&lat=-33.87&lon=151.2"))).toEqual({ z: 9.6, lat: -33.87, lon: 151.2 });
    expect(parseView(sp("z=9.6&lat=-33.87"))).toBeNull();
    expect(parseView(sp(""))).toBeNull();
  });
  it("ignores nonsense and clamps zoom", () => {
    expect(parseView(sp("z=abc&lat=-33&lon=151"))).toBeNull();
    expect(parseView(sp("z=9&lat=-120&lon=151"))).toBeNull();
    expect(parseView(sp("z=99&lat=-33&lon=151"))?.z).toBe(11.4);
    expect(parseView(sp("z=0&lat=-33&lon=151"))?.z).toBe(2);
    expect(parseView(sp("z=&lat=&lon="))).toBeNull();
  });
  it("reads a Next searchParams object as well as URLSearchParams", () => {
    expect(parseView({ z: "7", lat: "-30", lon: ["150", "151"] })).toEqual({ z: 7, lat: -30, lon: 150 });
  });
});

describe("influence state", () => {
  it("has the defaults", () => {
    expect(parseInfluenceState(sp(""), meta)).toEqual({
      brand: "all",
      audience: "both",
      measure: "count",
      month: "2026-11",
      view: null,
      sel: null,
    });
  });

  it("reads every parameter", () => {
    const s = parseInfluenceState(
      sp("brand=snapapp&audience=people&measure=per1000&month=2026-05&z=6.5&lat=-33&lon=148&sel=NSW"),
      meta,
    );
    expect(s).toEqual({
      brand: "snapapp",
      audience: "people",
      measure: "per1000",
      month: "2026-05",
      view: { z: 6.5, lat: -33, lon: 148 },
      sel: "NSW",
    });
  });

  it("falls back on bad values and a month outside the 24", () => {
    const s = parseInfluenceState(sp("brand=nope&audience=x&measure=y&month=2019-01&sel=%27%3Bdrop"), meta);
    expect(s.brand).toBe("all");
    expect(s.audience).toBe("both");
    expect(s.measure).toBe("count");
    expect(s.month).toBe("2026-11");
    expect(s.sel).toBeNull();
  });

  it("holds a brand lead on their brand whatever the URL says", () => {
    expect(parseInfluenceState(sp("brand=all"), meta, "yourtal").brand).toBe("yourtal");
    expect(parseInfluenceState(sp("brand=ftr"), meta, "yourtal").brand).toBe("yourtal");
  });

  it("round-trips and leaves out defaults", () => {
    const s = parseInfluenceState(sp("brand=ftr&measure=per1000&month=2025-03&z=7&lat=-30&lon=150"), meta);
    const qs = serialiseInfluenceState(s, meta);
    expect(qs).toBe("brand=ftr&measure=per1000&month=2025-03&z=7&lat=-30&lon=150");
    expect(parseInfluenceState(sp(qs), meta)).toEqual(s);
    expect(serialiseInfluenceState(parseInfluenceState(sp(""), meta), meta)).toBe("");
  });

  it("rounds the view so the URL stays short", () => {
    const qs = serialiseInfluenceState(
      { ...parseInfluenceState(sp(""), meta), view: { z: 9.123456, lat: -33.8712345, lon: 151.2093456 } },
      meta,
    );
    expect(qs).toBe("z=9.12&lat=-33.871&lon=151.209");
  });
});

describe("activity state", () => {
  it("has the defaults, with the heat layer on", () => {
    expect(parseActivityState(sp(""), meta)).toEqual({
      category: "all",
      ageBand: "all",
      month: "2026-11",
      heat: true,
      off: [],
      view: null,
      sel: null,
    });
  });

  it("reads the teen band with a hyphen or an en dash", () => {
    expect(parseActivityState(sp("ageBand=13-17"), meta).ageBand).toBe("13–17");
    expect(parseActivityState(sp("ageBand=13%E2%80%9317"), meta).ageBand).toBe("13–17");
    expect(parseActivityState(sp("ageBand=65%2B"), meta).ageBand).toBe("65+");
    expect(parseActivityState(sp("ageBand=99-100"), meta).ageBand).toBe("all");
  });

  it("drops a sensitive category when the age band is 13–17", () => {
    expect(parseActivityState(sp("ageBand=13-17&category=pharm"), meta).category).toBe("all");
    expect(parseActivityState(sp("ageBand=25-34&category=pharm"), meta).category).toBe("pharm");
    expect(parseActivityState(sp("ageBand=13-17&category=cafe"), meta).category).toBe("cafe");
  });

  it("reads the legend toggles and ignores unknown ones", () => {
    const s = parseActivityState(sp("off=fuel,cafe,nope,fuel&heat=0"), meta);
    expect(s.off).toEqual(["fuel", "cafe"]);
    expect(s.heat).toBe(false);
  });

  it("round-trips with a hyphen in the URL and an en dash in the state", () => {
    const url = "category=cafe&ageBand=13-17&month=2026-02&heat=0&off=fuel&z=9&lat=-37.81&lon=144.96&sel=M-0012";
    const s = parseActivityState(sp(url), meta);
    expect(s.ageBand).toBe("13–17");
    const qs = serialiseActivityState(s, meta);
    expect(qs).toBe(url);
    expect(parseActivityState(sp(qs), meta)).toEqual(s);
  });
});
