import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { readTokens, type MapTokens } from "./colors";
import { MapLoader, isAbort, type Fetcher } from "./query-cache";
import type { BoundaryCollection } from "./boundaries";
import type { StateCollection } from "./states";

/* ---------------- theme tokens ---------------- */

let tokenCache: MapTokens | null = null;

function subscribeTheme(onChange: () => void): () => void {
  const refresh = () => {
    tokenCache = null;
    onChange();
  };
  // The theme toggle sets data-theme on <html>; "system" follows the device, so listen for that too.
  const observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", refresh);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", refresh);
  };
}

function tokenSnapshot(): MapTokens {
  tokenCache ??= readTokens(document.documentElement);
  return tokenCache;
}

/** The app's theme tokens as map colours. null on the server and until the first client render. */
export function useMapTokens(): MapTokens | null {
  return useSyncExternalStore<MapTokens | null>(subscribeTheme, tokenSnapshot, () => null);
}

/* ---------------- reduced motion ---------------- */

function subscribeMotion(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True when the device asks for reduced motion: no autoplay, no animated camera moves. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** True while the screen is a phone: the map keeps its size but circles and controls get smaller. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(max-width: 860px)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(max-width: 860px)").matches,
    () => false,
  );
}

/* ---------------- data ---------------- */

const browserFetcher: Fetcher = (url, init) =>
  fetch(url, { signal: init.signal, credentials: "same-origin", headers: { Accept: "application/json" } });

/** One loader per mounted map screen: its own cache, its own abort, its own request count. */
export function useMapLoader<T>(): MapLoader<T> {
  const [loader] = useState(() => new MapLoader<T>(browserFetcher));
  return loader;
}

export interface Loaded<T> {
  /** The query this body answers. */
  url: string;
  body: T;
}

export interface QueryState<T> {
  /** The last body that arrived. It stays on screen while the next one loads, so the map never flashes. */
  data: Loaded<T> | null;
  /** True while `url` has not been answered yet. */
  loading: boolean;
  error: string | null;
}

/**
 * Runs the query at `url` (null waits) and keeps the last good answer. A newer url aborts the one in flight; a url
 * already answered comes straight from the cache.
 */
export function useMapQuery<T>(
  loader: MapLoader<T>,
  url: string | null,
  /** Called when an answer arrives, before it is drawn. Lets the caller remember what is on screen. */
  onArrive?: (url: string, body: T) => void,
): QueryState<T> {
  const arrive = useLatest(onArrive);
  const [state, setState] = useState<{
    data: Loaded<T> | null;
    error: { url: string; message: string } | null;
  }>({ data: null, error: null });

  useEffect(() => {
    if (url === null) return;
    let live = true;
    loader.load(url).then(
      (body) => {
        if (!live || body === null) return;
        arrive.current?.(url, body);
        setState((s) => ({ ...s, data: { url, body }, error: null }));
      },
      (e: unknown) => {
        if (!live || isAbort(e)) return;
        const message = e instanceof Error ? e.message : "The map could not load.";
        setState((s) => ({ ...s, error: { url, message } }));
      },
    );
    return () => {
      live = false;
      loader.abortCurrent();
    };
  }, [loader, url, arrive]);

  const answered = state.data?.url === url;
  const failed = state.error?.url === url;
  return {
    data: state.data,
    loading: url !== null && !answered && !failed,
    error: failed ? (state.error?.message ?? null) : null,
  };
}

/* ---------------- small helpers ---------------- */

/** A value that follows `value` after it has been still for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

/** Keeps the latest value in a ref without writing it during render. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/* ---------------- state outlines and fonts ---------------- */

/** The Australian state outlines from public/geo/au-states.json (same origin, fetched once per screen). */
export function useStateOutlines(): StateCollection | null {
  const [fc, setFc] = useState<StateCollection | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/geo/au-states.json", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: StateCollection | null) => {
        if (live && j) setFc(j);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return fc;
}

const boundaryCache = new Map<string, Promise<BoundaryCollection | null>>();

/**
 * The outlines of one area level (SA4, SA3 or SA2) from the same-origin static file named in the map meta. Fetched once
 * per page load and shared between screens (the URL carries the data version, so the browser keeps it for good).
 */
export function useBoundaries(url: string | null): BoundaryCollection | null {
  const [state, setState] = useState<{ url: string; fc: BoundaryCollection } | null>(null);
  useEffect(() => {
    if (url === null) return;
    let live = true;
    let p = boundaryCache.get(url);
    if (!p) {
      p = fetch(url, { credentials: "same-origin" })
        .then((r) => (r.ok ? (r.json() as Promise<BoundaryCollection>) : null))
        .catch(() => null);
      boundaryCache.set(url, p);
    }
    void p.then((fc) => {
      if (live && fc) setState({ url, fc });
    });
    return () => {
      live = false;
    };
  }, [url]);
  return state !== null && state.url === url ? state.fc : null;
}

/** True once the page's own copy of a font is loaded, so a canvas text atlas draws in it. */
export function useFontReady(spec: string): boolean {
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
