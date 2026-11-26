import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer, TextLayer } from "@deck.gl/layers";
import type { LayersList } from "@deck.gl/core";
import type { InfluenceCell, PresentedInfluence } from "@/server/data";
import { bandColor, withAlpha, type MapTokens, type RGB, type RGBA } from "./colors";
import { CAPITALS, stateCode, type StateCollection, type StateFeature, type StateLabel } from "./states";
import type { BrandChoice } from "./url-state";

/** Inter, already loaded by the page, so deck.gl's text atlas needs no glyph server. */
export const LABEL_FONT = '"Inter Variable", Inter, system-ui, sans-serif';
export const LABEL_FONT_SPEC = '600 14px "Inter Variable"';

export interface InfluenceLayerInput {
  states: StateCollection | null;
  labels: StateLabel[];
  data: PresentedInfluence | null;
  tokens: MapTokens;
  brand: BrandChoice;
  selected: string | null;
  /** True when the base map already draws the land (PMTiles). */
  hasBasemap: boolean;
  fontReady: boolean;
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

export function influenceLayers(i: InfluenceLayerInput): LayersList {
  const { data, tokens, selected } = i;
  const stateLevel = data === null || data.query.level === "state";
  const palette = data ? bandPalette(data, tokens, i.brand) : [];
  const brand = brandRgb(tokens, i.brand);
  const cellById = new Map<string, InfluenceCell>();
  if (data && stateLevel) for (const c of data.cells) cellById.set(c.id, c);

  const layers: LayersList = [];

  if (i.states) {
    const landFill: RGBA = i.hasBasemap ? [0, 0, 0, 0] : withAlpha(tokens.land, 1);
    layers.push(
      new GeoJsonLayer({
        id: "states",
        // The outlines are plain GeoJSON; deck.gl's own Feature type is stricter than this file needs.
        data: i.states as never,
        pickable: stateLevel && data !== null,
        stroked: true,
        filled: true,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 1,
        autoHighlight: stateLevel && data !== null,
        highlightColor: withAlpha(tokens.ink, 0.14),
        getFillColor: (f: unknown) => {
          if (!stateLevel) return landFill;
          const code = stateCode(f as StateFeature);
          const cell = code ? cellById.get(code) : undefined;
          return cell ? (palette[cell.band] ?? palette[palette.length - 1] ?? landFill) : landFill;
        },
        getLineColor: (f: unknown) =>
          stateLevel && selected !== null && stateCode(f as StateFeature) === selected
            ? withAlpha(tokens.ink, 1)
            : withAlpha(tokens.line, 1),
        getLineWidth: (f: unknown) =>
          stateLevel && selected !== null && stateCode(f as StateFeature) === selected ? 3 : 1,
        updateTriggers: {
          getFillColor: [data, tokens, i.brand, i.hasBasemap],
          getLineColor: [tokens, selected, stateLevel],
          getLineWidth: [selected, stateLevel],
        },
      }),
    );
  }

  if (data && !stateLevel) {
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

  if (i.fontReady) {
    const text = {
      fontFamily: LABEL_FONT,
      fontWeight: 600,
      fontSettings: { sdf: true },
      outlineWidth: 0.2,
      outlineColor: withAlpha(tokens.bg, 1),
      getColor: withAlpha(tokens.ink, 1),
      getTextAnchor: "middle" as const,
      getAlignmentBaseline: "center" as const,
      pickable: false,
    };
    if (stateLevel) {
      layers.push(
        new TextLayer<StateLabel>({
          id: "state-labels",
          data: i.labels,
          getPosition: (d) => d.position,
          getText: (d) => d.code,
          getSize: 13,
          sizeUnits: "pixels",
          ...text,
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
          sizeUnits: "pixels",
          ...text,
        }),
      );
    }
  }
  return layers;
}
