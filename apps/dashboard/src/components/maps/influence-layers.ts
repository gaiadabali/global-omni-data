import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { LayersList } from "@deck.gl/core";
import type { InfluenceCell, PresentedInfluence } from "@/server/data";
import { boundaryCode, type BoundaryCollection, type BoundaryFeature } from "./boundaries";
import { bandColor, labelColors, withAlpha, type MapTokens, type RGB, type RGBA } from "./colors";
import { bubbleMaxPx, bubbleRadius } from "./pd-lib";
import { CAPITALS, stateCode, type StateCollection, type StateFeature, type StateLabel } from "./states";
import type { BrandChoice, MapMode } from "./url-state";
import type { InfluenceLevel } from "./zoom";

/** Inter, already loaded by the page, so deck.gl's text atlas needs no glyph server. */
export const LABEL_FONT = '"Inter Variable", Inter, system-ui, sans-serif';
export const LABEL_FONT_SPEC = '600 14px "Inter Variable"';

export interface InfluenceLayerInput {
  states: StateCollection | null;
  /** The outlines of the shown SA4, SA3 or SA2 level, once loaded. */
  areas: BoundaryCollection | null;
  labels: StateLabel[];
  data: PresentedInfluence | null;
  tokens: MapTokens;
  brand: BrandChoice;
  selected: string | null;
  /** True when the base map already draws the land (PMTiles). */
  hasBasemap: boolean;
  fontReady: boolean;
  mode: MapMode;
  /** The value that gets the biggest bubble at this level. The same across months, so a time-lapse shows growth. */
  bubbleRef: number;
  /** Bubble size multiplier: smaller on a phone. */
  bubbleScale: number;
}

/** The brand colour the scale runs to. */
export function brandRgb(tokens: MapTokens, brand: BrandChoice): RGB {
  return tokens.brands[brand];
}

/** One fill colour per legend band, in order. */
export function bandPalette(data: PresentedInfluence, tokens: MapTokens, brand: BrandChoice): RGBA[] {
  const n = data.legend.length;
  return data.legend.map((b) => withAlpha(bandColor(b.band, n, tokens.base, brandRgb(tokens, brand)), 0.96));
}

/** What the answer on screen is made of: an area level or an H3 resolution. */
export function levelOfData(data: PresentedInfluence | null): InfluenceLevel {
  if (!data) return "state";
  return typeof data.query.level === "object" ? (data.query.level.h3 as 6 | 7) : data.query.level;
}

/**
 * How the answer is drawn. Bubbles are circles at the cells' centres. Everything else is a colour fill: real outlines
 * from state to SA2, hexagons at the H3 levels. Hexagon mode below the zoom where H3 starts falls back to the area fill.
 */
export type Drawing = "bubbles" | "fill";
export function drawingFor(mode: MapMode): Drawing {
  return mode === "bubbles" ? "bubbles" : "fill";
}

export function influenceLayers(i: InfluenceLayerInput): LayersList {
  const { data, tokens, selected } = i;
  const level = levelOfData(data);
  const stateLevel = data === null || data.query.level === "state";
  // SA4, SA3 and SA2 are real outlines joined to the cells by area code; H3 is hexagons.
  const outlineLevel = data !== null && typeof data.query.level === "string" && data.query.level !== "state";
  const hexLevel = data !== null && !stateLevel && !outlineLevel;
  const drawing = drawingFor(i.mode);
  const palette = data ? bandPalette(data, tokens, i.brand) : [];
  const brand = brandRgb(tokens, i.brand);
  const cellById = new Map<string, InfluenceCell>();
  if (data && (stateLevel || outlineLevel)) for (const c of data.cells) cellById.set(c.id, c);

  const layers: LayersList = [];

  if (i.states) {
    const landFill: RGBA = i.hasBasemap ? [0, 0, 0, 0] : withAlpha(tokens.land, 1);
    const fillStates = drawing === "fill" && stateLevel && data !== null;
    layers.push(
      new GeoJsonLayer({
        id: "states",
        // The outlines are plain GeoJSON; deck.gl's own Feature type is stricter than this file needs.
        data: i.states as never,
        pickable: fillStates,
        stroked: true,
        filled: true,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 1,
        autoHighlight: fillStates,
        highlightColor: withAlpha(tokens.ink, 0.14),
        getFillColor: (f: unknown) => {
          if (!fillStates) return landFill;
          const code = stateCode(f as StateFeature);
          const cell = code ? cellById.get(code) : undefined;
          return cell ? (palette[cell.band] ?? palette[palette.length - 1] ?? landFill) : landFill;
        },
        getLineColor: (f: unknown) =>
          fillStates && selected !== null && stateCode(f as StateFeature) === selected
            ? withAlpha(tokens.ink, 1)
            : withAlpha(tokens.line, 1),
        getLineWidth: (f: unknown) => (fillStates && selected !== null && stateCode(f as StateFeature) === selected ? 3 : 1),
        updateTriggers: {
          getFillColor: [data, tokens, i.brand, i.hasBasemap, drawing],
          getLineColor: [tokens, selected, fillStates],
          getLineWidth: [selected, fillStates],
        },
      }),
    );
  }

  // Area outlines: filled and pickable as a choropleth; as bubbles' context only the coarse levels keep a hairline
  // (SA2 has thousands of outlines and the bubbles say the same thing).
  if (data && outlineLevel && i.areas && (drawing === "fill" || level !== "sa2")) {
    const none: RGBA = [0, 0, 0, 0];
    const fill = drawing === "fill";
    layers.push(
      new GeoJsonLayer({
        id: "areas",
        data: i.areas as never,
        pickable: fill,
        autoHighlight: fill,
        highlightColor: withAlpha(tokens.ink, 0.16),
        stroked: true,
        filled: fill,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: fill ? 0.5 : 0.75,
        getFillColor: (f: unknown) => {
          const cell = cellById.get(boundaryCode(f as BoundaryFeature));
          return cell ? (palette[cell.band] ?? palette[palette.length - 1] ?? none) : none;
        },
        getLineColor: (f: unknown) =>
          fill
            ? selected !== null && boundaryCode(f as BoundaryFeature) === selected
              ? withAlpha(tokens.ink, 1)
              : withAlpha(tokens.bg, 0.85)
            : withAlpha(tokens.line, 0.8),
        getLineWidth: (f: unknown) =>
          fill && selected !== null && boundaryCode(f as BoundaryFeature) === selected ? 3 : fill ? 0.6 : 0.75,
        updateTriggers: {
          getFillColor: [data, tokens, i.brand, i.areas, drawing],
          getLineColor: [tokens, selected, data, drawing],
          getLineWidth: [selected, data, drawing],
        },
      }),
    );
  }

  if (data && hexLevel && drawing === "fill") {
    const last = palette[palette.length - 1] ?? withAlpha(brand, 1);
    // Cells under the threshold get a brand-coloured outline, so "<10" reads differently from empty land.
    const lowLine = withAlpha(brand, 0.7);
    const edge = withAlpha(tokens.bg, 0.9);
    layers.push(
      new H3HexagonLayer<InfluenceCell>({
        id: "hex",
        data: data.cells,
        pickable: true,
        autoHighlight: true,
        highlightColor: withAlpha(tokens.ink, 0.16),
        getHexagon: (d) => d.id,
        getFillColor: (d) => palette[d.band] ?? last,
        getLineColor: (d) => (d.id === selected ? withAlpha(tokens.ink, 1) : d.band === 0 ? lowLine : edge),
        getLineWidth: (d) => (d.id === selected ? 3 : 1),
        stroked: true,
        filled: true,
        extruded: false,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 0.5,
        updateTriggers: {
          getFillColor: [data, tokens, i.brand],
          getLineColor: [data, tokens, i.brand, selected],
          getLineWidth: [selected],
        },
      }),
    );
  }

  if (data && drawing === "bubbles") {
    const maxPx = bubbleMaxPx(level) * i.bubbleScale;
    // Biggest first, so the small ones are drawn on top and are never buried.
    const cells = [...data.cells].sort((a, b) => b.value - a.value);
    const fillA = tokens.dark ? 0.42 : 0.34;
    layers.push(
      new ScatterplotLayer<InfluenceCell>({
        id: "bubbles",
        data: cells,
        pickable: true,
        autoHighlight: true,
        highlightColor: withAlpha(tokens.ink, 0.25),
        getPosition: (d): [number, number] => d.centroid,
        // A count under the threshold, hidden from this viewer (value 0), is a small ring, never a blank.
        getRadius: (d) => (d.value > 0 ? bubbleRadius(d.value, i.bubbleRef, maxPx) : 3),
        radiusUnits: "pixels",
        stroked: true,
        filled: true,
        lineWidthUnits: "pixels",
        getFillColor: (d) => withAlpha(brand, d.value > 0 ? fillA : 0.08),
        getLineColor: (d) => withAlpha(brand, d.value > 0 ? 0.95 : 0.7),
        getLineWidth: (d) => (d.value > 0 ? 1.25 : 1),
        updateTriggers: {
          getRadius: [data, i.bubbleRef, level],
          getFillColor: [data, tokens, i.brand],
          getLineColor: [data, tokens, i.brand],
        },
      }),
    );
    // The signature: the logo's dot, with a ring, marks the area you opened.
    const sel = selected ? data.cells.find((c) => c.id === selected) : undefined;
    if (sel) {
      const r = sel.value > 0 ? bubbleRadius(sel.value, i.bubbleRef, maxPx) : 3;
      const clear: RGBA = [0, 0, 0, 0];
      const marks = [
        { p: sel.centroid, r: r + 5, ring: true },
        { p: sel.centroid, r: 3, ring: false },
      ];
      layers.push(
        new ScatterplotLayer<(typeof marks)[number]>({
          id: "selected",
          data: marks,
          pickable: false,
          getPosition: (d): [number, number] => d.p,
          getRadius: (d) => d.r,
          radiusUnits: "pixels",
          stroked: true,
          filled: true,
          lineWidthUnits: "pixels",
          getFillColor: (d) => (d.ring ? clear : withAlpha(tokens.ink, 1)),
          getLineColor: withAlpha(tokens.ink, 1),
          getLineWidth: (d) => (d.ring ? 2 : 0),
          updateTriggers: { getFillColor: [tokens], getLineColor: [tokens] },
        }),
      );
    }
  }

  if (i.fontReady) {
    const text = {
      fontFamily: LABEL_FONT,
      fontWeight: 600,
      fontSettings: { sdf: true },
      outlineWidth: 0.25,
      getTextAnchor: "middle" as const,
      getAlignmentBaseline: "center" as const,
      sizeUnits: "pixels" as const,
      pickable: false,
    };
    if (stateLevel && drawing === "bubbles" && data) {
      // A label sits inside a bubble big enough to hold it, at the bubble's centre, with a halo so it reads over any
      // bubble it overlaps. Small bubbles go without: the list and the tooltip name them.
      const big = data.cells
        .filter((c) => c.value > 0 && bubbleRadius(c.value, i.bubbleRef, bubbleMaxPx(level) * i.bubbleScale) >= 15)
        .map((c) => ({ code: c.id, position: c.centroid }));
      layers.push(
        new TextLayer<(typeof big)[number]>({
          id: "state-labels",
          data: big,
          getPosition: (d) => d.position,
          getText: (d) => d.code,
          getSize: 13,
          getColor: withAlpha(tokens.ink, 1),
          ...text,
          outlineWidth: 3,
          outlineColor: withAlpha(tokens.bg, 0.95),
          updateTriggers: { getColor: [tokens] },
        }),
      );
    } else if (stateLevel) {
      // Each label takes the colour that reads on its own fill: white on a dark state, ink on a light one. As bubbles the
      // label sits on the land or on a translucent bubble, so it takes the ink.
      const labels = i.labels.map((l) => {
        const cell = cellById.get(l.code);
        const fill = cell && drawing === "fill" ? (palette[cell.band] ?? palette[palette.length - 1]) : undefined;
        return { ...l, ...labelColors(fill, tokens) };
      });
      layers.push(
        new TextLayer<(typeof labels)[number]>({
          id: "state-labels",
          data: labels,
          getPosition: (d) => d.position,
          getText: (d) => d.code,
          getSize: 13,
          getColor: (d) => d.color,
          outlineColor: [0, 0, 0, 0],
          ...text,
          updateTriggers: { getColor: [data, tokens, i.brand, drawing] },
        }),
      );
    } else {
      layers.push(
        new TextLayer<(typeof CAPITALS)[number]>({
          id: "capitals",
          data: CAPITALS,
          getPosition: (d) => d.position,
          getText: (d) => d.name,
          getSize: 12,
          getColor: withAlpha(tokens.ink, 1),
          outlineColor: [0, 0, 0, 0],
          // A soft box behind the name: it has to read over any colour.
          background: true,
          getBackgroundColor: withAlpha(tokens.bg, 0.82),
          backgroundPadding: [4, 2],
          ...text,
        }),
      );
    }
  }
  return layers;
}
