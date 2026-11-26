import type { LayersList } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { GeoJsonLayer, LineLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { PersonAreaKind } from "@/server/data";
import { areaKey, outlierKey, outlierLabels, type ActivityOutlier, type PersonActivity } from "./activity-model";

/* ---------------- colour: read from the page, so both themes follow it ---------------- */

export type RGB = [number, number, number];
type RGBA = [number, number, number, number];

export interface ActivityTokens {
  dark: boolean;
  sea: RGB;
  land: RGB;
  line: RGB;
  ink: RGB;
  kinds: Record<PersonAreaKind, RGB>;
  outlier: RGB;
}

const FALLBACK: ActivityTokens = {
  dark: false,
  sea: [233, 235, 246],
  land: [250, 250, 254],
  line: [169, 174, 203],
  ink: [16, 18, 43],
  kinds: { home: [37, 125, 224], work: [0, 138, 23], weekend: [242, 166, 0] },
  outlier: [236, 70, 71],
};

/** "#0c158e", "#fff" or "rgb(12, 21, 142)" as numbers, or null. */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const v = parseInt(m[1]!, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return [parseInt(m[1]! + m[1]!, 16), parseInt(m[2]! + m[2]!, 16), parseInt(m[3]! + m[3]!, 16)];
  const r = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/.exec(s);
  return r ? [Math.round(+r[1]!), Math.round(+r[2]!), Math.round(+r[3]!)] : null;
}

export function readActivityTokens(el: Element): ActivityTokens {
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: RGB): RGB => parseColor(cs.getPropertyValue(name)) ?? fallback;
  const sea = get("--map-bg", FALLBACK.sea);
  return {
    sea,
    land: get("--map-land", FALLBACK.land),
    line: get("--map-line", FALLBACK.line),
    ink: get("--ink", FALLBACK.ink),
    kinds: {
      home: get("--pa-home", FALLBACK.kinds.home),
      work: get("--pa-work", FALLBACK.kinds.work),
      weekend: get("--pa-weekend", FALLBACK.kinds.weekend),
    },
    outlier: get("--pa-outlier", FALLBACK.outlier),
    dark: 0.2126 * sea[0] + 0.7152 * sea[1] + 0.0722 * sea[2] < 110,
  };
}

export const rgbCss = (c: RGB): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const withAlpha = (c: RGB, a: number): RGBA => [c[0], c[1], c[2], Math.round(Math.max(0, Math.min(1, a)) * 255)];

/** Inter, already loaded by the page, so deck.gl's text atlas needs no glyph server. */
export const LABEL_FONT = '"Inter Variable", Inter, system-ui, sans-serif';
export const LABEL_FONT_SPEC = '600 13px "Inter Variable"';

/* ---------------- layers ---------------- */

export interface ActivityLayerInput {
  activity: PersonActivity;
  tokens: ActivityTokens;
  /** The state outlines, for land at the national view. */
  states: unknown;
  /** True while the map is zoomed out to the country: land is then the state outlines. */
  national: boolean;
  /** The id under the pointer or the list row (area:home, out:o1), or null. */
  hover: string | null;
  /** The id that was clicked. */
  selected: string | null;
  fontReady: boolean;
}

/** Below this zoom the land is the state outlines; above it, the SA2 outlines (a finer coast). */
export const STATE_ZOOM = 6.8;

interface FenceProps {
  id: string;
  kind: PersonAreaKind;
}

export function fenceCollection(a: PersonActivity, only?: (k: PersonAreaKind) => boolean) {
  return {
    type: "FeatureCollection" as const,
    features: a.areas
      .filter((x) => !only || only(x.kind))
      .map((x) => ({ type: "Feature" as const, properties: { id: areaKey(x.kind), kind: x.kind } satisfies FenceProps, geometry: x.fence })),
  };
}

export function contextCollection(a: PersonActivity) {
  return {
    type: "FeatureCollection" as const,
    features: a.context.map((c) => ({ type: "Feature" as const, properties: { code: c.code }, geometry: c.geometry })),
  };
}

const dash = new PathStyleExtension({ dash: true });

export function activityLayers(i: ActivityLayerInput): LayersList {
  const { activity: a, tokens: t, hover, selected } = i;
  const emphasised = (id: string) => id === hover || id === selected;
  const anyActive = hover !== null || selected !== null;
  const layers: LayersList = [];

  if (i.states) {
    layers.push(
      new GeoJsonLayer({
        id: "states",
        data: i.states as never,
        visible: i.national,
        pickable: false,
        stroked: true,
        filled: true,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 1,
        getFillColor: withAlpha(t.land, 1),
        getLineColor: withAlpha(t.line, 1),
        updateTriggers: { getFillColor: [t], getLineColor: [t] },
      }),
    );
  }

  // The SA2 outlines near the areas: land and faint context. Same fill as the states, so only the edge differs.
  layers.push(
    new GeoJsonLayer({
      id: "context",
      data: contextCollection(a) as never,
      pickable: false,
      stroked: true,
      filled: true,
      lineWidthUnits: "pixels",
      getLineWidth: 0.75,
      getFillColor: withAlpha(t.land, 1),
      getLineColor: withAlpha(t.line, t.dark ? 0.55 : 0.7),
      updateTriggers: { getFillColor: [t], getLineColor: [t] },
    }),
  );

  const fences = fenceCollection(a);
  layers.push(
    new GeoJsonLayer({
      id: "fence-fill",
      data: fences as never,
      pickable: true,
      stroked: false,
      filled: true,
      getFillColor: ((f: { properties: FenceProps }) => {
        const c = t.kinds[f.properties.kind];
        if (emphasised(f.properties.id)) return withAlpha(c, t.dark ? 0.42 : 0.34);
        return withAlpha(c, anyActive ? (t.dark ? 0.16 : 0.12) : t.dark ? 0.26 : 0.2);
      }) as never,
      updateTriggers: { getFillColor: [t, hover, selected] },
    }),
    new GeoJsonLayer({
      id: "fence-line",
      data: fenceCollection(a, (k) => k !== "weekend") as never,
      pickable: false,
      stroked: true,
      filled: false,
      lineWidthUnits: "pixels",
      lineJointRounded: true,
      getLineColor: ((f: { properties: FenceProps }) => withAlpha(t.kinds[f.properties.kind], 1)) as never,
      getLineWidth: ((f: { properties: FenceProps }) => (emphasised(f.properties.id) ? 3.5 : 2.25)) as never,
      updateTriggers: { getLineColor: [t], getLineWidth: [hover, selected] },
    }),
    // The weekend area is drawn dashed: its colour is never the only thing that tells it from the others.
    new GeoJsonLayer({
      id: "fence-dash",
      data: fenceCollection(a, (k) => k === "weekend") as never,
      pickable: false,
      stroked: true,
      filled: false,
      lineWidthUnits: "pixels",
      lineJointRounded: true,
      lineCapRounded: true,
      getLineColor: ((f: { properties: FenceProps }) => withAlpha(t.kinds[f.properties.kind], 1)) as never,
      getLineWidth: ((f: { properties: FenceProps }) => (emphasised(f.properties.id) ? 3.5 : 2.25)) as never,
      getDashArray: [5, 3] as never,
      dashJustified: true,
      extensions: [dash],
      updateTriggers: { getLineColor: [t], getLineWidth: [hover, selected] },
    } as never),
  );

  // A faint line from each outlier to the area it is measured from.
  const centreOf = new Map(a.areas.map((x) => [x.kind, [x.centre.lon, x.centre.lat] as [number, number]]));
  const links = a.outliers.filter((o) => o.from !== "home suburb" && centreOf.has(o.from));
  layers.push(
    new LineLayer<ActivityOutlier>({
      id: "outlier-links",
      data: links,
      pickable: false,
      getSourcePosition: (o) => [o.lon, o.lat],
      getTargetPosition: (o) => centreOf.get(o.from as PersonAreaKind)!,
      getColor: (o) => withAlpha(t.outlier, emphasised(outlierKey(o.id)) ? 0.8 : 0.32),
      getWidth: (o) => (emphasised(outlierKey(o.id)) ? 1.5 : 1),
      widthUnits: "pixels",
      updateTriggers: { getColor: [t, hover, selected], getWidth: [hover, selected] },
    }),
  );

  // Receipt dots, inside the fences. Each is a cell centre (or a suburb point), with the receipts stacked on it.
  layers.push(
    new ScatterplotLayer({
      id: "receipt-dots",
      data: a.points,
      pickable: false,
      getPosition: (d: PersonActivity["points"][number]): [number, number] => [d.lon, d.lat],
      getRadius: (d: PersonActivity["points"][number]) => Math.min(7.5, 3.4 + Math.sqrt(Math.max(1, d.receipts.value)) * 0.8),
      radiusUnits: "pixels",
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1.5,
      getFillColor: (d: PersonActivity["points"][number]) => withAlpha(t.kinds[d.area], 1),
      getLineColor: withAlpha(t.land, 1),
      updateTriggers: { getFillColor: [t], getLineColor: [t] },
    }),
  );

  // Outliers: hollow rings in a different colour, so they never read as part of an area.
  layers.push(
    new ScatterplotLayer<ActivityOutlier>({
      id: "outlier-ring",
      data: a.outliers.filter((o) => emphasised(outlierKey(o.id))),
      pickable: false,
      getPosition: (o) => [o.lon, o.lat],
      getRadius: 13,
      radiusUnits: "pixels",
      stroked: true,
      filled: false,
      lineWidthUnits: "pixels",
      getLineWidth: 2,
      getLineColor: withAlpha(t.ink, 0.9),
      updateTriggers: { getLineColor: [t] },
    }),
    new ScatterplotLayer<ActivityOutlier>({
      id: "outliers",
      data: a.outliers,
      pickable: true,
      getPosition: (o) => [o.lon, o.lat],
      getRadius: (o) => (emphasised(outlierKey(o.id)) ? 8.5 : 7),
      radiusUnits: "pixels",
      stroked: true,
      filled: true,
      lineWidthUnits: "pixels",
      getLineWidth: 2.5,
      getFillColor: withAlpha(t.land, 0.9),
      getLineColor: withAlpha(t.outlier, 1),
      updateTriggers: { getRadius: [hover, selected], getFillColor: [t], getLineColor: [t] },
    }),
  );

  if (i.fontReady) {
    const text = {
      fontFamily: LABEL_FONT,
      fontWeight: 600,
      fontSettings: { sdf: true },
      outlineWidth: 0.28,
      outlineColor: withAlpha(t.land, 1),
      getColor: withAlpha(t.ink, 1),
      sizeUnits: "pixels" as const,
      pickable: false,
    };
    layers.push(
      new TextLayer<PersonActivity["areas"][number]>({
        id: "area-labels",
        data: a.areas,
        getPosition: (d) => [d.centre.lon, d.centre.lat],
        getText: (d) => d.label,
        getSize: (d) => (emphasised(areaKey(d.kind)) ? 14 : 12.5),
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        getPixelOffset: [0, -10],
        updateTriggers: { getSize: [hover, selected], getColor: [t], outlineColor: [t] },
        ...text,
      }),
      new TextLayer<ActivityOutlier>({
        id: "outlier-labels",
        data: outlierLabels(a),
        getPosition: (d) => [d.lon, d.lat],
        getText: (d) => d.suburb,
        getSize: 12,
        getTextAnchor: "start",
        getAlignmentBaseline: "center",
        getPixelOffset: [13, 0],
        updateTriggers: { getColor: [t], outlineColor: [t] },
        ...text,
        getColor: withAlpha(t.dark ? t.outlier : [180, 30, 38], 1),
      }),
    );
  }
  return layers;
}
