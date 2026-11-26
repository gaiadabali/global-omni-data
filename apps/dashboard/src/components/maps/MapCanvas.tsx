"use client";

/**
 * The map surface shared by /map and /activity: MapLibre GL for the base map, deck.gl drawn into the same WebGL
 * context (MapboxOverlay, interleaved) for the data layers, and the zoom buttons, level label and hover tooltip.
 *
 * Under the app's CSP (no unsafe-eval, style-src 'self' + nonce, worker-src 'self' blob:):
 *  - MapLibre 6 loads its worker from a file, which the app serves at /map/maplibre-worker (same origin);
 *  - the CSS is MapLibre's own file (bundled by Next as a stylesheet), not inline styles;
 *  - positions and sizes are set through the CSSOM (element.style.x = ...), which style-src does not block.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import { AttributionControl, Map as MapLibreMap, addProtocol, getVersion, setWorkerUrl, type IControl } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { LayersList, PickingInfo } from "@deck.gl/core";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { BASEMAP_ATTRIBUTION, basemapPaint, buildStyle } from "./basemap";
import type { MapTokens } from "./colors";
import { useLatest } from "./hooks";
import { AUSTRALIA_BOUNDS } from "./states";
import type { ViewState } from "./url-state";
import { MAX_ZOOM, MIN_ZOOM, type BBox } from "./zoom";

export interface MapViewChange extends ViewState {
  /** The visible box. */
  bbox: BBox;
}

export interface MapHandle {
  zoomBy(delta: number): void;
  /** Back to the whole of Australia. */
  reset(): void;
  flyTo(lon: number, lat: number, zoom?: number): void;
  fitBounds(b: BBox): void;
}

export interface TipContent {
  title: string;
  rows: [label: string, value: string][];
}

export interface MapCanvasProps {
  /** A same-origin PMTiles path, or null for the plain background (land is drawn by the state layer). */
  basemapUrl: string | null;
  ariaLabel: string;
  initialView: ViewState | null;
  layers: LayersList;
  tokens: MapTokens;
  /** True once the first answer from the API has been given to `layers`. */
  dataReady: boolean;
  /** "States", "Areas about 15 km across" ... */
  levelText: string;
  busy: boolean;
  reducedMotion: boolean;
  /** Called after the map loads and after every move. */
  onView: (v: MapViewChange) => void;
  onClick: (info: PickingInfo) => void;
  /** What to show in the tooltip for a hovered object, or null for none. */
  describe: (info: PickingInfo) => TipContent | null;
  handleRef: Ref<MapHandle>;
  /** "Fill the map with ..." hint line. */
  hint: string;
}

let initialised = false;
function initMapLibre(): void {
  if (initialised) return;
  initialised = true;
  setWorkerUrl(`/map/maplibre-worker?v=${getVersion()}`);
  const protocol = new Protocol();
  addProtocol("pmtiles", protocol.tile as unknown as Parameters<typeof addProtocol>[1]);
}

function currentView(map: MapLibreMap): MapViewChange {
  const c = map.getCenter();
  const b = map.getBounds();
  return { z: map.getZoom(), lat: c.lat, lon: c.lng, bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] };
}

export function MapCanvas(props: MapCanvasProps) {
  const { basemapUrl, ariaLabel, tokens, layers, dataReady, levelText, busy, handleRef, hint } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const latest = useLatest(props);
  const [loaded, setLoaded] = useState(false);
  // Milliseconds from the start of the page load to the first drawn answer (shown with ?perf=1).
  const [readyMs, setReadyMs] = useState<number | null>(null);
  const [perf] = useState(() => new URLSearchParams(window.location.search).has("perf"));
  const [failed, setFailed] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: TipContent } | null>(null);

  useImperativeHandle(
    handleRef,
    () => ({
      zoomBy(delta) {
        const map = mapRef.current;
        if (!map) return;
        map.easeTo({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, map.getZoom() + delta)), duration: latest.current.reducedMotion ? 0 : 250 });
      },
      reset() {
        mapRef.current?.fitBounds(AUSTRALIA_BOUNDS, { padding: 8, duration: latest.current.reducedMotion ? 0 : 400 });
      },
      flyTo(lon, lat, zoom) {
        const map = mapRef.current;
        if (!map) return;
        map.easeTo({ center: [lon, lat], zoom: zoom ?? map.getZoom(), duration: latest.current.reducedMotion ? 0 : 500 });
      },
      fitBounds(b) {
        mapRef.current?.fitBounds(
          [
            [b[0], b[1]],
            [b[2], b[3]],
          ],
          { padding: 40, maxZoom: 9, duration: latest.current.reducedMotion ? 0 : 500 },
        );
      },
    }),
    [latest],
  );

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const { tokens: t0, initialView, basemapUrl: base } = latest.current;
    let map: MapLibreMap;
    try {
      initMapLibre();
      const absolute = base === null ? null : new URL(base, window.location.origin).href;
      // Only this origin: a tile URL on another host would be a third party at runtime.
      const sameOrigin = absolute !== null && new URL(absolute).origin === window.location.origin;
      const style = buildStyle(t0, sameOrigin ? absolute : null);
      map = new MapLibreMap({
        container,
        style: style as unknown as ConstructorParameters<typeof MapLibreMap>[0]["style"],
        ...(initialView
          ? { center: [initialView.lon, initialView.lat] as [number, number], zoom: initialView.z }
          : { bounds: AUSTRALIA_BOUNDS as [number, number, number, number], fitBoundsOptions: { padding: 8 } }),
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        attributionControl: false,
        cooperativeGestures: true,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
        renderWorldCopies: false,
      });
      if (sameOrigin) map.addControl(new AttributionControl({ compact: false, customAttribution: BASEMAP_ATTRIBUTION }));
    } catch (e) {
      // No WebGL, or the worker could not start: say so instead of leaving an empty box.
      queueMicrotask(() => setFailed(e instanceof Error ? e.message : "The map could not start."));
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.getCanvas().setAttribute("aria-label", latest.current.ariaLabel);

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      onClick: (info: PickingInfo) => {
        if (info.object) latest.current.onClick(info);
      },
      onHover: (info: PickingInfo) => {
        const canvas = map.getCanvas();
        canvas.style.cursor = info.object ? "pointer" : "";
        const content = info.object ? latest.current.describe(info) : null;
        setTip(content ? { x: info.x, y: info.y, content } : null);
      },
    });
    mapRef.current = map;
    overlayRef.current = overlay;

    map.on("load", () => {
      map.addControl(overlay as unknown as IControl);
      setLoaded(true);
      latest.current.onView(currentView(map));
    });
    map.on("moveend", () => latest.current.onView(currentView(map)));
    map.on("error", (e) => {
      const message = (e as unknown as { error?: { message?: string } }).error?.message ?? "";
      // A tile or worker that cannot load is shown; ordinary tile misses are not worth a banner.
      if (/worker|webgl/i.test(message)) setFailed(message);
    });

    return () => {
      mapRef.current = null;
      overlayRef.current = null;
      setLoaded(false);
      setReadyMs(null);
      try {
        map.removeControl(overlay as unknown as IControl);
      } catch {
        // The overlay was never added (the map was removed before it loaded).
      }
      try {
        overlay.finalize();
      } catch {
        // Already released by removeControl.
      }
      map.remove();
    };
  }, [latest, basemapUrl]);

  // Follow the theme.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const paint = basemapPaint(tokens, basemapUrl !== null);
    for (const [id, values] of Object.entries(paint)) {
      if (!map.getLayer(id)) continue;
      for (const [prop, value] of Object.entries(values)) map.setPaintProperty(id, prop as Parameters<typeof map.setPaintProperty>[1], value);
    }
  }, [tokens, loaded, basemapUrl]);

  // Hand the data layers to deck.gl.
  useEffect(() => {
    if (!loaded) return;
    overlayRef.current?.setProps({ layers });
    mapRef.current?.triggerRepaint();
  }, [layers, loaded]);

  // Ready once the first answer has been drawn: the map is idle, then a short settle for deck.gl's last frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !dataReady || readyMs !== null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onIdle = () => {
      timer = setTimeout(() => setReadyMs(Math.round(performance.now())), 250);
    };
    map.once("idle", onIdle);
    map.triggerRepaint();
    return () => {
      map.off("idle", onIdle);
      if (timer) clearTimeout(timer);
    };
  }, [loaded, dataReady, readyMs]);

  // Put the tooltip next to the pointer, kept inside the map.
  useLayoutEffect(() => {
    const el = tipRef.current;
    const box = containerRef.current;
    if (!el || !box || !tip) return;
    const maxLeft = box.clientWidth - el.offsetWidth - 6;
    const left = tip.x + 14 > maxLeft ? Math.max(6, tip.x - 14 - el.offsetWidth) : tip.x + 14;
    const top = Math.max(6, Math.min(tip.y + 14, box.clientHeight - el.offsetHeight - 6));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [tip]);

  return (
    <div className="gm-stage" data-map-ready={dataReady && readyMs !== null ? "true" : "false"}>
      <div
        ref={containerRef}
        className="gm-canvas"
        role="group"
        aria-label={ariaLabel}
        onPointerLeave={() => setTip(null)}
      />
      {failed ? (
        <div className="gm-failed" role="alert">
          <p>The map could not start in this browser.</p>
          <p className="small muted">{failed}</p>
        </div>
      ) : null}
      <div className="gm-level" aria-live="polite">
        {levelText}
        {busy ? <span className="gm-busy"> · updating</span> : null}
      </div>
      <div className="gm-zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoomVia(mapRef.current, 1, props.reducedMotion)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomVia(mapRef.current, -1, props.reducedMotion)}>
          −
        </button>
        <button type="button" aria-label="Show all of Australia" title="Show all of Australia" onClick={() => mapRef.current?.fitBounds(AUSTRALIA_BOUNDS, { padding: 8, duration: props.reducedMotion ? 0 : 400 })}>
          ⌂
        </button>
      </div>
      <div className="gm-hint">
        {hint}
        {perf && readyMs !== null ? <span data-perf-ready> · first map {readyMs} ms</span> : null}
      </div>
      {tip ? (
        <div ref={tipRef} className="gm-tip" role="presentation">
          <b>{tip.content.title}</b>
          {tip.content.rows.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function zoomVia(map: MapLibreMap | null, delta: number, reduced: boolean): void {
  if (!map) return;
  map.easeTo({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, map.getZoom() + delta)), duration: reduced ? 0 : 250 });
}
