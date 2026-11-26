import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { LayersList } from "@deck.gl/core";
import type { ActivityHeatCell, ActivityMerchant, PresentedActivity } from "@/server/data";
import { heatAlpha, withAlpha, type MapTokens, type RGB, type RGBA } from "./colors";
import { LABEL_FONT } from "./influence-layers";
import { CAPITALS, stateLabels, type StateCollection, type StateLabel } from "./states";
import { HEX_WIDTH_KM } from "./zoom";

export interface ActivityLayerInput {
  states: StateCollection | null;
  data: PresentedActivity | null;
  tokens: MapTokens;
  /** Category ids switched off in the chips. */
  off: ReadonlySet<string>;
  heat: boolean;
  /** The selected merchant id ("M-0012") or heat cell (an h3 index). */
  selected: string | null;
  hasBasemap: boolean;
  fontReady: boolean;
  /** Which labels to draw: state codes at the national view, capitals once zoomed in. */
  labels: "states" | "capitals";
  /** Zoomed out far enough that heat cells are only a few pixels across: draw them stronger so they show. */
  lowZoom: boolean;
  /** Merchant dots appear once the map is close enough to read them. */
  showMerchants: boolean;
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

/** Merchants to draw: not switched off in the chips. */
export function visibleMerchants(data: PresentedActivity | null, off: ReadonlySet<string>): ActivityMerchant[] {
  return data ? data.merchants.filter((m) => !off.has(m.category)) : [];
}

/**
 * The heat layer is built from the server's H3 aggregates and nothing else: every cell is a count of people active in
 * about 2 to 15 km, already thresholded, so no person-level point exists to draw. Each cell becomes three soft discs of
 * falling size and rising opacity, so neighbouring cells blend into a surface where they cluster. A cell under the
 * threshold draws almost nothing, and one the viewer may not see (value 0) draws only its faint outer disc.
 */
const RINGS: readonly { m: number; a: number }[] = [
  { m: 1.9, a: 0.18 },
  { m: 1.15, a: 0.38 },
  { m: 0.55, a: 0.8 },
];

interface Blob {
  p: [number, number];
  m: number;
  a: number;
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
    const res = data.query.h3;
    const base = (HEX_WIDTH_KM[res] ?? 5.6) * 1000 * 0.62;
    const boost = (a: number) => (i.lowZoom ? Math.min(1, a * 1.5 + (a > 0.1 ? 0.1 : 0)) : a);
    const blobs: Blob[] = [];
    for (const h of data.heat) {
      const a = boost(heatAlpha(h.band, bands));
      for (const r of RINGS) blobs.push({ p: h.centroid, m: r.m, a: a * r.a });
    }
    layers.push(
      new ScatterplotLayer<Blob>({
        id: "heat-glow",
        data: blobs,
        pickable: false,
        getPosition: (d) => d.p,
        getRadius: (d) => base * d.m,
        radiusUnits: "meters",
        radiusMinPixels: 2,
        stroked: false,
        filled: true,
        getFillColor: (d) => withAlpha(tokens.heat, d.a),
        updateTriggers: { getRadius: [res], getFillColor: [data, tokens, i.lowZoom] },
      }),
    );
    // The cells themselves are what you point at: invisible, but they pick, highlight and show the chosen one's edge.
    const clear: RGBA = [0, 0, 0, 2];
    layers.push(
      new H3HexagonLayer<ActivityHeatCell>({
        id: "heat",
        data: data.heat,
        pickable: true,
        autoHighlight: true,
        highlightColor: withAlpha(tokens.ink, 0.12),
        getHexagon: (d) => d.id,
        getFillColor: clear,
        getLineColor: (d) => (d.id === selected ? withAlpha(tokens.ink, 1) : withAlpha(tokens.heat, 0)),
        getLineWidth: (d) => (d.id === selected ? 2.5 : 0),
        stroked: true,
        filled: true,
        extruded: false,
        lineWidthUnits: "pixels",
        updateTriggers: { getLineColor: [data, tokens, selected], getLineWidth: [selected] },
      }),
    );
  }

  if (data && i.showMerchants) {
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
        // Small counts are drawn as a ring: the dot is there, the number is not.
        getFillColor: (d) => withAlpha(categoryRgb(tokens, d.category), d.suppressed ? 0.12 : 0.92),
        getLineColor: (d) =>
          d.id === selected ? withAlpha(tokens.ink, 1) : withAlpha(tokens.bg, d.suppressed ? 0 : 0.9),
        getLineWidth: (d) => (d.id === selected ? 3 : d.suppressed ? 0 : 0.75),
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
