import { describe, expect, it } from "vitest";
import { basemapPaint, buildStyle, sanitizeBasemapUrl } from "./basemap";
import type { MapTokens } from "./colors";

const tokens = (dark: boolean): MapTokens => ({
  bg: dark ? [10, 13, 36] : [233, 235, 246],
  land: dark ? [22, 26, 61] : [250, 250, 254],
  line: dark ? [56, 62, 120] : [169, 174, 203],
  base: dark ? [16, 20, 58] : [241, 242, 250],
  ink: dark ? [236, 237, 252] : [16, 18, 43],
  heat: [210, 86, 27],
  info: dark ? [127, 169, 242] : [42, 98, 184],
  brands: { yourtal: [177, 39, 155], snapapp: [10, 133, 116], ftr: [184, 117, 0], all: [12, 21, 142] },
  categories: {},
  dark,
});

describe("sanitizeBasemapUrl", () => {
  it("accepts a same-origin pmtiles path", () => {
    expect(sanitizeBasemapUrl("/tiles/au.pmtiles")).toBe("/tiles/au.pmtiles");
    expect(sanitizeBasemapUrl("  /tiles/au.pmtiles?v=3 ")).toBe("/tiles/au.pmtiles?v=3");
  });
  it.each([
    undefined,
    null,
    "",
    "https://tiles.example.com/au.pmtiles",
    "//tiles.example.com/au.pmtiles",
    "tiles/au.pmtiles",
    "/tiles/au.mbtiles",
    "/tiles/au.pmtiles\"onload=x",
    "/tiles\\au.pmtiles",
    "javascript:alert(1)",
  ])("refuses %s", (v) => {
    expect(sanitizeBasemapUrl(v)).toBeNull();
  });
});

describe("buildStyle", () => {
  it("is a lone background with no sources when there are no tiles", () => {
    const s = buildStyle(tokens(false), null);
    expect(s.version).toBe(8);
    expect(s.sources).toEqual({});
    expect(s.layers.map((l) => l.id)).toEqual(["background"]);
  });

  it("adds a PMTiles source with the OpenStreetMap credit when tiles are set", () => {
    const s = buildStyle(tokens(false), "/tiles/au.pmtiles");
    expect(s.sources.protomaps).toMatchObject({
      type: "vector",
      url: "pmtiles:///tiles/au.pmtiles",
      attribution: "© OpenStreetMap",
    });
    expect(s.layers.map((l) => l.id)).toEqual([
      "background",
      "earth",
      "landuse",
      "water",
      "roads-minor",
      "roads-major",
      "boundaries",
    ]);
  });

  it("has no text layers, so it needs no glyph server", () => {
    const s = buildStyle(tokens(true), "/tiles/au.pmtiles");
    expect(s.layers.some((l) => l.type === "symbol")).toBe(false);
    expect("glyphs" in s).toBe(false);
    expect("sprite" in s).toBe(false);
  });

  it("follows the theme: every layer has a paint for light and for dark, and they differ", () => {
    const light = basemapPaint(tokens(false), true);
    const dark = basemapPaint(tokens(true), true);
    expect(Object.keys(light)).toEqual(Object.keys(dark));
    expect(light.background).not.toEqual(dark.background);
    expect(light.water).not.toEqual(dark.water);
  });
});
