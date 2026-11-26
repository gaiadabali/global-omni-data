"use client";

/**
 * The map inside Person 360: MapLibre GL for the camera and deck.gl, drawn into the same WebGL context, for the
 * fences, dots and labels. No street base map (the founder decided Person 360 stays at suburb level), so the land is
 * the state outlines at the country view and faint SA2 outlines near the areas.
 *
 * Under the app's CSP (no unsafe-eval, style-src 'self' + nonce, worker-src 'self' blob:): MapLibre's worker is the
 * same-origin file at /map/maplibre-worker; positions are set through the CSSOM (element.style.x = ...), never in markup.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, getVersion, setWorkerUrl, type IControl } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fmtDate } from "@/lib/dates";
import {
  areaKey,
  outlierKey,
  tipForArea,
  tipForOutlier,
  type ActivityView,
  type PersonActivity,
  type TipContent,
} from "./activity-model";
import { LABEL_FONT_SPEC, activityLayers, readActivityTokens, rgbCss, type ActivityTokens } from "./activity-layers";

export interface MapFocus {
  /** area:home, out:o1 ... */
  key: string;
  /** Changes on every request, so asking for the same feature twice moves the camera twice. */
  n: number;
}

export interface PersonMapProps {
  activity: PersonActivity;
  view: ActivityView;
  /** Changes when the person asks to fit the view again. */
  fitN: number;
  hover: string | null;
  selected: string | null;
  focus: MapFocus | null;
  ariaLabel: string;
  onHover: (key: string | null) => void;
  onSelect: (key: string | null) => void;
}

const MIN_ZOOM = 2.5;
const MAX_ZOOM = 13;
/** Below this the land is the state outlines (the SA2 outlines only cover the neighbourhood of the areas). */
const NATIONAL_ZOOM = 6.8;

let workerSet = false;
function initMapLibre(): void {
  if (workerSet) return;
  workerSet = true;
  setWorkerUrl(`/map/maplibre-worker?v=${getVersion()}`);
}

/* ---------------- theme tokens, motion, fonts, states ---------------- */

let tokenCache: ActivityTokens | null = null;
function subscribeTheme(onChange: () => void): () => void {
  const refresh = () => {
    tokenCache = null;
    onChange();
  };
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", refresh);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", refresh);
  };
}
function useTokens(): ActivityTokens | null {
  return useSyncExternalStore<ActivityTokens | null>(
    subscribeTheme,
    () => (tokenCache ??= readActivityTokens(document.documentElement)),
    () => null,
  );
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function useFontReady(spec: string): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => {
      if (live) setReady(true);
    };
    document.fonts.load(spec).then(done, done);
    return () => {
      live = false;
    };
  }, [spec]);
  return ready;
}

function useStates(): unknown {
  const [fc, setFc] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    fetch("/geo/au-states.json", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        if (live && j) setFc(j);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return fc;
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/* ---------------- the component ---------------- */

type Box = PersonActivity["view"]["areas"];

function pickKey(info: PickingInfo): string | null {
  if (!info.object || !info.layer) return null;
  if (info.layer.id === "fence-fill") return (info.object as { properties?: { id?: string } }).properties?.id ?? null;
  if (info.layer.id === "outliers") return outlierKey((info.object as { id: string }).id);
  return null;
}

export default function PersonMap(props: PersonMapProps) {
  const { activity, view, fitN, hover, selected, focus, ariaLabel } = props;
  const tokens = useTokens();
  const reduced = useReducedMotion();
  const fontReady = useFontReady(LABEL_FONT_SPEC);
  const states = useStates();
  const latest = useLatest(props);
  const containerRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [national, setNational] = useState(false);
  const [readyMs, setReadyMs] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; content: TipContent } | null>(null);
  const tokensRef = useLatest(tokens);
  const reducedRef = useLatest(reduced);

  const fitBox = (map: MapLibreMap, b: Box, animate: boolean) => {
    const narrow = (containerRef.current?.clientWidth ?? 800) < 520;
    const pad = narrow ? 28 : 48;
    map.fitBounds(
      [
        [b.west, b.south],
        [b.east, b.north],
      ],
      {
        padding: { top: pad + 20, bottom: pad, left: pad, right: pad + (narrow ? 0 : 20) },
        maxZoom: 11.5,
        duration: animate && !reducedRef.current ? 500 : 0,
      },
    );
  };

  // Create the map once.
  useEffect(() => {
    const container = containerRef.current;
    const t0 = tokensRef.current;
    if (!container || !t0) return;
    let map: MapLibreMap;
    try {
      initMapLibre();
      const box = latest.current.activity.view[latest.current.view];
      map = new MapLibreMap({
        container,
        style: {
          version: 8,
          sources: {},
          layers: [{ id: "background", type: "background", paint: { "background-color": rgbCss(t0.sea) } }],
        } as unknown as ConstructorParameters<typeof MapLibreMap>[0]["style"],
        bounds: [box.west, box.south, box.east, box.north],
        fitBoundsOptions: { padding: 48, maxZoom: 11.5 },
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
    } catch (e) {
      queueMicrotask(() => setFailed(e instanceof Error ? e.message : "The map could not start."));
      return;
    }
    // MapLibre 6 no longer has map.transform, which deck.gl's overlay still reads (the map height). Give it that.
    if ((map as unknown as { transform?: unknown }).transform === undefined) {
      Object.defineProperty(map, "transform", { configurable: true, get: () => ({ height: container.clientHeight }) });
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.getCanvas().setAttribute("aria-label", latest.current.ariaLabel);

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
      pickingRadius: 6,
      onClick: (info: PickingInfo) => {
        const key = pickKey(info);
        latest.current.onSelect(key === latest.current.selected ? null : key);
      },
      onHover: (info: PickingInfo) => {
        const key = pickKey(info);
        map.getCanvas().style.cursor = key ? "pointer" : "";
        latest.current.onHover(key);
        if (!key) return setTip(null);
        const a = latest.current.activity;
        const content = key.startsWith("area:")
          ? (a.areas.find((x) => areaKey(x.kind) === key) ?? null)
          : (a.outliers.find((o) => outlierKey(o.id) === key) ?? null);
        if (!content) return setTip(null);
        setTip({
          x: info.x,
          y: info.y,
          content: "kind" in content ? tipForArea(content) : tipForOutlier(content, fmtDate),
        });
      },
    });
    mapRef.current = map;
    overlayRef.current = overlay;

    map.on("load", () => {
      map.addControl(overlay as unknown as IControl);
      setLoaded(true);
      setNational(map.getZoom() < NATIONAL_ZOOM);
    });
    // Only a change of side is worth a render: the land is the states below this zoom, the SA2 outlines above.
    map.on("zoom", () => {
      const n = map.getZoom() < NATIONAL_ZOOM;
      setNational((prev) => (prev === n ? prev : n));
    });
    map.on("error", (e) => {
      const message = (e as unknown as { error?: { message?: string } }).error?.message ?? "";
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
    // The map is made once per mount; everything it reads later comes through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens !== null]);

  // Follow the theme.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !tokens || !map.getLayer("background")) return;
    map.setPaintProperty("background", "background-color", rgbCss(tokens.sea));
  }, [tokens, loaded]);

  // Fit when the view (areas, or all with outliers) changes or the person asks to fit again.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    fitBox(map, activity.view[view], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, fitN, loaded, activity]);

  // A list row asked for a feature: bring it into view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !focus) return;
    const duration = reducedRef.current ? 0 : 500;
    if (focus.key.startsWith("area:")) {
      const a = activity.areas.find((x) => areaKey(x.kind) === focus.key);
      if (!a) return;
      const xs = (a.fence.type === "Polygon" ? [a.fence.coordinates] : a.fence.coordinates).flatMap((p) => p[0] ?? []);
      const b: Box = {
        west: Math.min(...xs.map((p) => p[0]!)),
        east: Math.max(...xs.map((p) => p[0]!)),
        south: Math.min(...xs.map((p) => p[1]!)),
        north: Math.max(...xs.map((p) => p[1]!)),
      };
      fitBox(map, b, true);
    } else {
      const o = activity.outliers.find((x) => outlierKey(x.id) === focus.key);
      if (o) map.easeTo({ center: [o.lon, o.lat], zoom: Math.max(map.getZoom(), 9.5), duration });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const layers = useMemo(
    () => (tokens ? activityLayers({ activity, tokens, states, national, hover, selected, fontReady }) : []),
    [activity, tokens, states, national, hover, selected, fontReady],
  );
  useEffect(() => {
    if (!loaded) return;
    overlayRef.current?.setProps({ layers });
    mapRef.current?.triggerRepaint();
  }, [layers, loaded]);

  // Ready once the first frame with the outlines and labels has been drawn: idle, then a short settle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !fontReady || states === null || readyMs !== null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onIdle = () => {
      timer = setTimeout(() => setReadyMs(Math.round(performance.now())), 350);
    };
    map.once("idle", onIdle);
    map.triggerRepaint();
    return () => {
      map.off("idle", onIdle);
      if (timer) clearTimeout(timer);
    };
  }, [loaded, fontReady, states, readyMs]);

  // The tooltip sits next to the pointer, kept inside the map.
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

  const zoomBy = (d: number) => {
    const map = mapRef.current;
    if (map) map.easeTo({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, map.getZoom() + d)), duration: reduced ? 0 : 250 });
  };

  // What is pinned (clicked): shown in a card on the map, so a touch screen gets the same detail as a hover.
  const pinned: TipContent | null = (() => {
    if (!selected) return null;
    if (selected.startsWith("area:")) {
      const a = activity.areas.find((x) => areaKey(x.kind) === selected);
      return a ? tipForArea(a) : null;
    }
    const o = activity.outliers.find((x) => outlierKey(x.id) === selected);
    return o ? tipForOutlier(o, fmtDate) : null;
  })();
  const pinnedKind = selected?.startsWith("area:") ? selected.slice(5) : "outlier";

  return (
    <div className="pa-stage" data-map-ready={readyMs !== null ? "true" : "false"}>
      <div ref={containerRef} className="pa-canvas" role="group" aria-label={ariaLabel} onPointerLeave={() => setTip(null)} />
      {failed ? (
        <div className="pa-failed" role="alert">
          <p>The map could not start in this browser.</p>
          <p className="small muted">The lists beside it hold the same details.</p>
        </div>
      ) : null}
      <div className="pa-zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)}>
          −
        </button>
      </div>
      {pinned ? (
        <div className="pa-card" data-kind={pinnedKind} role="status">
          <div className="pa-card-h">
            <b>{pinned.title}</b>
            <button type="button" aria-label="Close details" onClick={() => props.onSelect(null)}>
              ×
            </button>
          </div>
          <dl>
            {pinned.rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {tip && !pinned ? (
        <div ref={tipRef} className="pa-tip" role="presentation">
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
