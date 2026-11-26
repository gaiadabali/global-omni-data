import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { LayersList } from "@deck.gl/core";
import type { ActivityHeatCell, ActivityMerchant, PresentedActivity } from "@/server/data";
import { heatAlpha, withAlpha, type MapTokens, type RGB, type RGBA } from "./colors";
import { LABEL_FONT } from "./influence-layers";
import { CAPITALS, stateLabels, type StateCollection, type StateLabel } from "./states";

export interface ActivityLayerInput {
  states: StateCollection | null;
  data: PresentedActivity | null;
  tokens: MapTokens;
  /** Category ids switched off in the legend. */
  off: ReadonlySet<string>;
  heat: boolean;
  selected: string | null;
  hasBasemap: boolean;
  fontReady: boolean;
  /** Which labels to draw: state codes at the national view, capitals once zoomed in. */
  labels: "states" | "capitals";
  /** Zoomed out far enough that heat cells are only a few pixels across: draw them stronger so they show. */
  lowZoom: boolean;
  /** Dot size multiplier by zoom band (changes a few times across the whole range, not on every frame). */
  dotScale: number;
}

const GREY: RGB = [128, 128, 128];

export function categoryRgb(tokens: MapTokens, id: string): RGB {
  return tokens.categories[id] ?? GREY;
}

/** Dot radius in px from the receipts shown. A suppressed count is 0 here, so those dots are the smallest. */
export function dotRadius(value: number): number {
  return Math.min(8, 2.6 + Math.sqrt(Math.max(0, value)) / 12);
}

/** Merchants to draw: not switched off in the legend. */
export function visibleMerchants(data: PresentedActivity | null, off: ReadonlySet<string>): ActivityMerchant[] {
  return data ? data.merchants.filter((m) => !off.has(m.category)) : [];
}

export function activityLayers(i: ActivityLayerInput): LayersList {
  const { data, tokens, selected } = i;
  const layers: LayersList = [];

  if (i.states) {
    layers.push(
      new GeoJsonLayer({
        id: "land",
        data: i.states as never,
        pickable: false,
        stroked: true,
        filled: true,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 1,
        getFillColor: i.hasBasemap ? ([0, 0, 0, 0] as RGBA) : withAlpha(tokens.land, 1),
        getLineColor: withAlpha(tokens.line, 1),
        updateTriggers: { getFillColor: [tokens, i.hasBasemap], getLineColor: [tokens] },
      }),
    );
  }

  if (data && i.heat) {
    const bands = data.legend.length;
    // Cells are only a few pixels wide at the national view, so they get more opacity and an edge there.
    const boost = (a: number) => (i.lowZoom ? Math.min(1, a * 1.7 + (a > 0.1 ? 0.12 : 0)) : a);
    const palette: RGBA[] = data.legend.map((b) => withAlpha(tokens.heat, boost(heatAlpha(b.band, bands))));
    const last = palette[palette.length - 1] ?? withAlpha(tokens.heat, 0.5);
    layers.push(
      new H3HexagonLayer<ActivityHeatCell>({
        id: "heat",
        data: data.heat,
        pickable: true,
        autoHighlight: true,
        highlightColor: withAlpha(tokens.ink, 0.18),
        getHexagon: (d) => d.id,
        getFillColor: (d) => palette[d.band] ?? last,
        getLineColor: (d) => (d.id === selected ? withAlpha(tokens.ink, 1) : withAlpha(tokens.heat, d.band === 0 ? 0.2 : 0.9)),
        getLineWidth: (d) => (d.id === selected ? 3 : i.lowZoom ? 1 : 0),
        stroked: true,
        filled: true,
        extruded: false,
        lineWidthUnits: "pixels",
        updateTriggers: {
          getFillColor: [data, tokens, i.lowZoom],
          getLineColor: [data, tokens, selected],
          getLineWidth: [selected, i.lowZoom],
        },
      }),
    );
  }

  if (data) {
    const dots = visibleMerchants(data, i.off);
    layers.push(
      new ScatterplotLayer<ActivityMerchant>({
        id: "merchants",
        data: dots,
        pickable: true,
        autoHighlight: true,
        highlightColor: withAlpha(tokens.ink, 0.3),
        getPosition: (d): [number, number] => [d.lon, d.lat],
        getRadius: (d) => dotRadius(d.value),
        radiusUnits: "pixels",
        radiusScale: i.dotScale,
        radiusMinPixels: 2,
        radiusMaxPixels: 12,
        stroked: true,
        filled: true,
        lineWidthUnits: "pixels",
        // Small counts are drawn as a ring, as in the approved design: the dot is there, the number is not.
        getFillColor: (d) => withAlpha(categoryRgb(tokens, d.category), d.suppressed ? 0.12 : 0.92),
        getLineColor: (d) => (d.id === selected ? withAlpha(tokens.ink, 1) : withAlpha(categoryRgb(tokens, d.category), 1)),
        getLineWidth: (d) => (d.id === selected ? 3 : d.suppressed ? 1.4 : 0.6),
        updateTriggers: {
          getFillColor: [data, tokens],
          getLineColor: [data, tokens, selected],
          getLineWidth: [data, selected],
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
      sizeUnits: "pixels" as const,
      pickable: false,
    };
    if (i.labels === "states" && i.states) {
      layers.push(
        new TextLayer<StateLabel>({
          id: "labels",
          data: stateLabels(i.states),
          getPosition: (d) => d.position,
          getText: (d) => d.code,
          getSize: 13,
          ...text,
        }),
      );
    } else if (i.labels === "capitals") {
      layers.push(
        new TextLayer<(typeof CAPITALS)[number]>({
          id: "labels",
          data: CAPITALS,
          getPosition: (d) => d.position,
          getText: (d) => d.name,
          getSize: 12,
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
