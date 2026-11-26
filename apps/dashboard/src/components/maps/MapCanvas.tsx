"use client";

/**
 * The map surface shared by /map and /activity: MapLibre GL for the base map, deck.gl drawn into the same WebGL
 * context (MapboxOverlay, interleaved) for the data layers, and the zoom buttons and hover tooltip. The panels that float
 * over the map are passed in as children and positioned by CSS; elements marked data-occ-d (desktop) or data-occ-c
 * (phone and tablet) with a side name tell the camera how much of the canvas they cover, so a "fly to" lands in the part
 * of the map you can see.
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
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
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

/** How many pixels of each side of the canvas the floating panels cover. */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
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
  busy: boolean;
  reducedMotion: boolean;
  /** Called after the map loads, after every move and after the canvas changes size. */
  onView: (v: MapViewChange) => void;
  onClick: (info: PickingInfo) => void;
  /** What to show in the tooltip for a hovered object, or null for none. */
  describe: (info: PickingInfo) => TipContent | null;
  handleRef: Ref<MapHandle>;
  /** True while a detail panel covers the right edge, so the zoom buttons step aside. */
  detailOpen?: boolean;
  /** The panels, legend and bars that float over the map. */
  children?: ReactNode;
}

let initialised = false;
function initMapLibre(): void {
  if (initialised) return;
  initialised = true;
  setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${getVersion()}`);
  const protocol = new Protocol();
  addProtocol("pmtiles", protocol.tile as unknown as Parameters<typeof addProtocol>[1]);
}

function currentView(map: MapLibreMap): MapViewChange {
  const c = map.getCenter();
  const b = map.getBounds();
  return { z: map.getZoom(), lat: c.lat, lon: c.lng, bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] };
}

/** The sides of the canvas covered by floating panels, read from the DOM when a camera move starts. */
function readInsets(stage: HTMLElement): Insets {
  const compact = window.matchMedia("(max-width: 1100px)").matches;
  const out: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  const box = stage.getBoundingClientRect();
  stage.querySelectorAll<HTMLElement>(compact ? "[data-occ-c]" : "[data-occ-d]").forEach((el) => {
    if (el.getClientRects().length === 0) return;
    const side = (compact ? el.dataset.occC : el.dataset.occD) as keyof Insets | undefined;
    if (!side || !(side in out)) return;
    const r = el.getBoundingClientRect();
    const v =
      side === "left" ? r.right - box.left : side === "right" ? box.right - r.left : side === "top" ? r.bottom - box.top : box.bottom - r.top;
    out[side] = Math.max(out[side], Math.max(0, Math.round(v)));
  });
  // Never let the panels take more than most of the canvas: the camera needs room to fit anything.
  const maxX = Math.max(0, Math.floor(box.width * 0.7) - 32);
  const maxY = Math.max(0, Math.floor(box.height * 0.6) - 32);
  const sx = out.left + out.right > maxX ? maxX / (out.left + out.right) : 1;
  const sy = out.top + out.bottom > maxY ? maxY / (out.top + out.bottom) : 1;
  return {
    left: Math.round(out.left * sx),
    right: Math.round(out.right * sx),
    top: Math.round(out.top * sy),
    bottom: Math.round(out.bottom * sy),
  };
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMercY = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/**
 * Fit a box into the part of the canvas the panels leave free. Worked out here, from the Web Mercator maths, and applied
 * with the camera's `offset` (which does not persist): MapLibre's own `padding` option is stored on the camera and then
 * counted again on the next fit, which drifted the view when the panels were wide.
 */
function fitBox(map: MapLibreMap, b: BBox, ins: Insets, pad: number, maxZoom: number, duration: number): void {
  const el = map.getContainer();
  const rw = Math.max(80, el.clientWidth - ins.left - ins.right - pad * 2);
  const rh = Math.max(80, el.clientHeight - ins.top - ins.bottom - pad * 2);
  const dx = (b[2] - b[0]) / 360;
  const dy = (mercY(b[3]) - mercY(b[1])) / (2 * Math.PI);
  const z = Math.log2(Math.min(rw / dx, rh / dy) / 512);
  const zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, z));
  const lon = (b[0] + b[2]) / 2;
  const lat = invMercY((mercY(b[1]) + mercY(b[3])) / 2);
  goTo(map, lon, lat, zoom, ins, duration);
}

/**
 * Move the camera so a place lands in the middle of the free part of the canvas. The centre is worked out first; then, once
 * the move is over, the place's real position on screen is read back and any difference is panned away, so the result does
 * not depend on how the camera treats the centre.
 */
function goTo(map: MapLibreMap, lon: number, lat: number, zoom: number, ins: Insets, duration: number): void {
  const settle = () => {
    const el = map.getContainer();
    const want = [el.clientWidth / 2 + (ins.left - ins.right) / 2, el.clientHeight / 2 + (ins.top - ins.bottom) / 2];
    const at = map.project([lon, lat]);
    const dx = at.x - want[0]!;
    const dy = at.y - want[1]!;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) map.panBy([dx, dy], { duration: 0 });
  };
  map.easeTo({ center: centreFor(lon, lat, zoom, ins), zoom, duration });
  if (duration === 0) settle();
  else map.once("moveend", settle);
}

/**
 * The map centre that puts a place in the middle of the free part of the canvas. The place sits at the centre of the
 * canvas plus half the difference of the insets; the centre of the map is that many pixels the other way. Plain
 * Web Mercator arithmetic, so it does not depend on how the camera treats an offset.
 */
function centreFor(lon: number, lat: number, zoom: number, ins: Insets): [number, number] {
  const world = 512 * 2 ** zoom;
  const ox = (ins.left - ins.right) / 2;
  const oy = (ins.top - ins.bottom) / 2;
  return [lon - (ox * 360) / world, invMercY(mercY(lat) + (oy * 2 * Math.PI) / world)];
}

export function MapCanvas(props: MapCanvasProps) {
  const { basemapUrl, ariaLabel, tokens, layers, dataReady, busy, handleRef, detailOpen, children } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const latest = useLatest(props);
  // True once the view is no longer the first national fit (the person moved it, or the page flew it somewhere).
  const touchedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  // Milliseconds from the start of the page load to the first drawn answer (shown with ?perf=1).
  const [readyMs, setReadyMs] = useState<number | null>(null);
  // ?perf=1 shows timings and errors on the map; ?perf=pan also pans the map in small steps (to count requests).
  const [perfMode] = useState(() => new URLSearchParams(window.location.search).get("perf"));
  const perf = perfMode !== null;
  const [failed, setFailed] = useState<string | null>(null);
  // With ?perf the camera and the panel insets are printed, to check that a fit lands beside the panels.
  const [camera, setCamera] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: TipContent } | null>(null);

  useImperativeHandle(
    handleRef,
    () => ({
      zoomBy(delta) {
        const map = mapRef.current;
        if (!map) return;
        touchedRef.current = true;
        map.easeTo({
          zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, map.getZoom() + delta)),
          duration: latest.current.reducedMotion ? 0 : 250,
        });
      },
      reset() {
        const map = mapRef.current;
        const stage = stageRef.current;
        if (!map || !stage) return;
        touchedRef.current = false;
        fitBox(map, AUSTRALIA_BOUNDS, readInsets(stage), 16, MAX_ZOOM, latest.current.reducedMotion ? 0 : 400);
      },
      flyTo(lon, lat, zoom) {
        const map = mapRef.current;
        const stage = stageRef.current;
        if (!map) return;
        const i = stage ? readInsets(stage) : { left: 0, right: 0, top: 0, bottom: 0 };
        const z = zoom ?? map.getZoom();
        touchedRef.current = true;
        goTo(map, lon, lat, z, i, latest.current.reducedMotion ? 0 : 500);
      },
      fitBounds(b) {
        const map = mapRef.current;
        const stage = stageRef.current;
        if (!map || !stage) return;
        touchedRef.current = true;
        fitBox(map, b, readInsets(stage), 32, 9, latest.current.reducedMotion ? 0 : 500);
      },
    }),
    [latest],
  );

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    const stage = stageRef.current;
    if (!container || !stage) return;
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
          : { center: [133.5, -28.5] as [number, number], zoom: 3.4 }),
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        attributionControl: false,
        // The map fills the screen and the page does not scroll, so the wheel and one finger belong to the map.
        cooperativeGestures: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
        // With a single world MapLibre will not move the centre east of where the world's edge would show, which is exactly
        // where the national view has to go to sit beside a panel. Nothing is drawn in the copies (the land is Australia's
        // own outline, once), and they are 4,000 px away at this zoom.
        renderWorldCopies: true,
      });
      if (sameOrigin) map.addControl(new AttributionControl({ compact: false, customAttribution: BASEMAP_ATTRIBUTION }));
      if (!initialView) fitBox(map, AUSTRALIA_BOUNDS, readInsets(stage), 16, MAX_ZOOM, 0);
    } catch (e) {
      // No WebGL, or the worker could not start: say so instead of leaving an empty box.
      queueMicrotask(() => setFailed(e instanceof Error ? e.message : "The map could not start."));
      return;
    }
    // MapLibre 6 no longer has map.transform, which deck.gl's overlay still reads (the map height, to scale the
    // near and far planes). Give it the one value it needs.
    if ((map as unknown as { transform?: unknown }).transform === undefined) {
      Object.defineProperty(map, "transform", { configurable: true, get: () => ({ height: container.clientHeight }) });
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

    // Has the person moved the map themselves? Until then a change of canvas size re-fits Australia.
    touchedRef.current = initialView !== null;
    // Only the person's own hands count as moving the map. (MapLibre's movestart also fires for its own resizes.)
    const touch = () => {
      touchedRef.current = true;
    };
    const touchEvents = ["pointerdown", "wheel", "keydown", "touchstart"] as const;
    for (const ev of touchEvents) container.addEventListener(ev, touch, { passive: true });
    // The panels settle after the map loads (fonts, the list, the sheet), so keep fitting Australia into what they leave
    // free until the view is touched. Watching the panels' own size catches every late change.
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!touchedRef.current) fitBox(map, AUSTRALIA_BOUNDS, readInsets(stage), 16, MAX_ZOOM, 0);
      });
    };
    const panelWatcher = new ResizeObserver(refit);
    stage.querySelectorAll("[data-occ-d],[data-occ-c]").forEach((el) => panelWatcher.observe(el));

    map.on("load", () => {
      map.addControl(overlay as unknown as IControl);
      setLoaded(true);
      latest.current.onView(currentView(map));
      // Once the page around the map has settled, fit Australia into the part the panels leave free (the panels were
      // measured while the layout was still arriving). Nothing happens if the person has already moved the map.
      map.once("idle", refit);
    });
    const wantCamera = new URLSearchParams(window.location.search).has("perf");
    map.on("moveend", () => {
      latest.current.onView(currentView(map));
      if (wantCamera) {
        const i = readInsets(stage);
        const c = map.getCenter();
        const el = map.getContainer();
        setCamera(
          `canvas ${el.clientWidth}x${el.clientHeight} z${map.getZoom().toFixed(2)} centre ${c.lng.toFixed(2)},${c.lat.toFixed(2)} insets L${i.left} R${i.right} T${i.top} B${i.bottom}`,
        );
      }
    });
    // The canvas settles after the first view was reported (the layout and the fonts arrive after the map loads, so the
    // first box can be a small one). A resize is not a move, so report the view again: the page asks for a bigger box.
    map.on("resize", () => {
      refit();
      latest.current.onView(currentView(map));
    });
    const watcher = new ResizeObserver(() => map.resize());
    watcher.observe(container);
    map.on("error", (e) => {
      const message = (e as unknown as { error?: { message?: string } }).error?.message ?? "";
      // A tile or worker that cannot load is shown; ordinary tile misses are not worth a banner.
      if (/worker|webgl/i.test(message)) setFailed(message);
    });

    return () => {
      watcher.disconnect();
      panelWatcher.disconnect();
      for (const ev of touchEvents) container.removeEventListener(ev, touch);
      cancelAnimationFrame(frame);
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
      for (const [prop, value] of Object.entries(values))
        map.setPaintProperty(id, prop as Parameters<typeof map.setPaintProperty>[1], value);
    }
  }, [tokens, loaded, basemapUrl]);

  // With ?perf=1 an uncaught error is shown on the map, with the top of its stack: a debugging aid.
  useEffect(() => {
    if (!perf) return;
    const onError = (ev: ErrorEvent) => {
      const stack = typeof ev.error?.stack === "string" ? ev.error.stack.split("\n").slice(0, 5).join(" | ") : "";
      setFailed(`${ev.message} ${stack}`);
    };
    window.addEventListener("error", onError);
    return () => window.removeEventListener("error", onError);
  }, [perf]);

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

  // The pan probe: twelve small drags (about 1.2 degrees in all at street-level zoom), to count the requests a pan makes.
  useEffect(() => {
    if (perfMode !== "pan" || readyMs === null) return;
    const map = mapRef.current;
    if (!map) return;
    let n = 0;
    const t = setInterval(() => {
      if (n++ >= 12) {
        clearInterval(t);
        return;
      }
      // Down the coast, about 110 px a step: it leaves the box already fetched after four or five steps.
      map.panBy([n % 2 ? 20 : 10, -110], { duration: 0 });
    }, 450);
    return () => clearInterval(t);
  }, [perfMode, readyMs]);

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

  const zoomVia = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    touchedRef.current = true;
    map.easeTo({
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, map.getZoom() + delta)),
      duration: props.reducedMotion ? 0 : 250,
    });
  };

  return (
    <div
      ref={stageRef}
      className="gm-stage"
      data-map-ready={dataReady && readyMs !== null ? "true" : "false"}
      data-detail={detailOpen ? "open" : "closed"}
      aria-busy={busy}
    >
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
      {children}
      <div className="gm-zoom" role="group" aria-label="Map zoom">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomVia(1)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomVia(-1)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3 8h10" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Show all of Australia"
          title="Show all of Australia"
          onClick={() => {
            const map = mapRef.current;
            const stage = stageRef.current;
            if (!map || !stage) return;
            touchedRef.current = false;
            fitBox(map, AUSTRALIA_BOUNDS, readInsets(stage), 16, MAX_ZOOM, props.reducedMotion ? 0 : 400);
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
          </svg>
        </button>
      </div>
      {perf && readyMs !== null ? (
        <div className="gm-perf" data-perf-ready>
          first map {readyMs} ms
          {camera ? ` · ${camera}` : ""}
        </div>
      ) : null}
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
