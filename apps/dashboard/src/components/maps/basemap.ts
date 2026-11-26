/**
 * The base map. Self-hosted only: no tile CDN, no glyph server, no sprite server.
 *
 *  - GOD_BASEMAP_PMTILES unset (true today): a plain background. The land is drawn from the Australian state
 *    outlines by the deck.gl layers, so the base map itself is one background layer.
 *  - GOD_BASEMAP_PMTILES set (a same-origin path such as /tiles/au.pmtiles): a Protomaps PMTiles source and a
 *    minimal light/dark style (earth, water, a few roads, state borders). No text layers, so no glyphs are
 *    needed: labels are drawn by deck.gl's TextLayer with the Inter font.
 */
import { mix, rgbCss, type MapTokens, type RGB } from "./colors";

/**
 * The server reads GOD_BASEMAP_PMTILES and passes it to the page. Only a path on this origin is accepted
 * ("/tiles/au.pmtiles"): a full URL, a protocol-relative URL or anything with a scheme could point at a third
 * party, and the CSP would refuse it anyway.
 */
export function sanitizeBasemapUrl(raw: string | undefined | null): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\s<>"']/.test(v)) return null;
  if (!/\.pmtiles(\?[A-Za-z0-9=&._-]*)?$/.test(v)) return null;
  return v;
}

export const BASEMAP_ATTRIBUTION = "© OpenStreetMap";

/** A minimal MapLibre style spec, typed here so this file needs no map library. */
export interface BasemapStyle {
  version: 8;
  sources: Record<string, unknown>;
  layers: { id: string; type: string; [k: string]: unknown }[];
}

type Paint = Record<string, string | number>;

/** Paint values for every base-map layer, from the theme tokens. Used for the first style and for theme changes. */
export function basemapPaint(t: MapTokens, withTiles: boolean): Record<string, Paint> {
  const water = mix(t.bg, t.info, t.dark ? 22 : 16);
  const road = mix(t.land, t.line, t.dark ? 70 : 55);
  const park: RGB = mix(t.land, t.brands.snapapp, t.dark ? 10 : 8);
  const out: Record<string, Paint> = {
    background: { "background-color": rgbCss(t.bg) },
  };
  if (!withTiles) return out;
  out.earth = { "fill-color": rgbCss(t.land) };
  out.landuse = { "fill-color": rgbCss(park) };
  out.water = { "fill-color": rgbCss(water) };
  out["roads-minor"] = { "line-color": rgbCss(mix(t.land, road, 60)) };
  out["roads-major"] = { "line-color": rgbCss(road) };
  out.boundaries = { "line-color": rgbCss(t.line) };
  return out;
}

export function buildStyle(t: MapTokens, pmtilesUrl: string | null): BasemapStyle {
  const paint = basemapPaint(t, pmtilesUrl !== null);
  const layers: BasemapStyle["layers"] = [{ id: "background", type: "background", paint: paint.background! }];
  const sources: Record<string, unknown> = {};
  if (pmtilesUrl !== null) {
    sources.protomaps = {
      type: "vector",
      url: `pmtiles://${pmtilesUrl}`,
      attribution: BASEMAP_ATTRIBUTION,
    };
    // Protomaps basemap tiles (v4 schema): earth, landuse, water, roads, boundaries.
    layers.push(
      { id: "earth", type: "fill", source: "protomaps", "source-layer": "earth", paint: paint.earth! },
      {
        id: "landuse",
        type: "fill",
        source: "protomaps",
        "source-layer": "landuse",
        filter: ["in", ["get", "kind"], ["literal", ["park", "forest", "nature_reserve", "national_park", "wood"]]],
        paint: paint.landuse!,
      },
      { id: "water", type: "fill", source: "protomaps", "source-layer": "water", paint: paint.water! },
      {
        id: "roads-minor",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        minzoom: 11,
        filter: ["in", ["get", "kind"], ["literal", ["minor_road", "medium_road"]]],
        paint: { ...paint["roads-minor"]!, "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 14, 1.2] },
      },
      {
        id: "roads-major",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        minzoom: 5,
        filter: ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]],
        paint: { ...paint["roads-major"]!, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 14, 2.4] },
      },
      {
        id: "boundaries",
        type: "line",
        source: "protomaps",
        "source-layer": "boundaries",
        filter: ["in", ["get", "kind"], ["literal", ["country", "region"]]],
        paint: { ...paint.boundaries!, "line-width": 0.8, "line-dasharray": [3, 2] },
      },
    );
  }
  return { version: 8, sources, layers };
}
