"use client";

import type { PickingInfo } from "@deck.gl/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Callout, Num, Segmented, Select } from "@/components/ui";
import { fmtInt, monthLong } from "@/lib/format";
import type { InfluenceCell, PresentedInfluence } from "@/server/data";
import { MapCanvas, type MapHandle, type MapViewChange, type TipContent } from "./MapCanvas";
import { ControlSheet, Legend, MonthControl, PerfLine } from "./MapUi";
import {
  useFontReady,
  useLatest,
  useMapLoader,
  useMapQuery,
  useMapTokens,
  useBoundaries,
  useReducedMotion,
  useStateOutlines,
} from "./hooks";
import { boundaryCode, type BoundaryFeature } from "./boundaries";
import { LABEL_FONT_SPEC, influenceLayers } from "./influence-layers";
import { planInfluence, type ShownInfluence } from "./plan";
import { stateBounds, stateCode, stateLabels, type StateFeature } from "./states";
import { topBy } from "./top";
import {
  serialiseInfluenceState,
  type Audience,
  type BrandChoice,
  type InfluenceState,
  type MapMetaLike,
  type Measure,
} from "./url-state";
import { MAX_ZOOM, finerLevel, inBBox, levelLabel, levelStartZoom, type InfluenceLevel } from "./zoom";

export interface InfluenceMapProps {
  initial: InfluenceState;
  meta: MapMetaLike;
  /** From GOD_BASEMAP_PMTILES, read on the server: a same-origin PMTiles path, or null. */
  basemapUrl: string | null;
  /** A brand lead's one brand. The control is fixed to it, and the API refuses any other. */
  lockedBrand: BrandChoice | null;
  /** Owner and Data team see exact small numbers (the page marks them). */
  seesExact: boolean;
}

const BRAND_NAMES: Record<BrandChoice, string> = {
  all: "All of GOD",
  yourtal: "YourTal",
  snapapp: "SnapApp",
  ftr: "Free Tax Returns",
};
const AUDIENCE_NAMES: Record<Audience, string> = {
  both: "Both",
  businesses: "Registered businesses",
  people: "Registered people",
};
const WHO: Record<Audience, string> = {
  both: "registered people and businesses",
  businesses: "registered businesses",
  people: "registered people",
};
const WHO_SHORT: Record<Audience, string> = { both: "People and businesses", businesses: "Businesses", people: "People" };

interface Ui {
  brand: BrandChoice;
  audience: Audience;
  measure: Measure;
  month: string;
  sel: string | null;
}

/** The level the answer on screen is for: an area level, or an H3 resolution. null before the first answer. */
function levelOf(q: PresentedInfluence["query"] | undefined): InfluenceLevel | null {
  if (!q) return null;
  return typeof q.level === "object" ? (q.level.h3 as 6 | 7) : q.level;
}

const LEVEL_KICKER: Record<string, string> = {
  state: "State or territory",
  sa4: "SA4 region",
  sa3: "SA3 area",
  sa2: "SA2 area",
};

/** The area a click or hover landed on: a state code, an ABS area code or an h3 index. */
function idOf(info: PickingInfo): string | null {
  if (!info.object) return null;
  if (info.layer?.id === "states") return stateCode(info.object as StateFeature);
  if (info.layer?.id === "areas") return boundaryCode(info.object as BoundaryFeature);
  if (info.layer?.id === "hex") return (info.object as InfluenceCell).id;
  return null;
}

export default function InfluenceMap({ initial, meta, basemapUrl, lockedBrand, seesExact }: InfluenceMapProps) {
  const tokens = useMapTokens();
  const reduced = useReducedMotion();
  const fontReady = useFontReady(LABEL_FONT_SPEC);
  const outlines = useStateOutlines();
  const loader = useMapLoader<PresentedInfluence>();
  const handleRef = useRef<MapHandle>(null);
  const panelRef = useRef<HTMLElement>(null);

  const [ui, setUi] = useState<Ui>({
    brand: initial.brand,
    audience: initial.audience,
    measure: initial.measure,
    month: initial.month,
    sel: initial.sel,
  });
  const uiRef = useLatest(ui);
  const [view, setView] = useState<MapViewChange | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const queryView = useRef<MapViewChange | null>(null);
  const shownRef = useRef<{ url: string; query: ShownInfluence } | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Which request does this view need? Asked in event handlers (never while rendering), because the answer
  // depends on what is already on screen: a view inside the box already fetched needs nothing new.
  const request = useCallback((u: Ui, v: MapViewChange | null) => {
    if (v) setUrl(planInfluence(u, v, shownRef.current));
  }, []);

  // The view on screen follows every move. The request follows it once the map has been still for a moment, so a
  // drag does not send a request per frame. The first view goes straight out.
  const onView = useCallback(
    (v: MapViewChange) => {
      setView(v);
      if (queryView.current === null) {
        queryView.current = v;
        request(uiRef.current, v);
        return;
      }
      clearTimeout(moveTimer.current);
      moveTimer.current = setTimeout(() => {
        queryView.current = v;
        request(uiRef.current, v);
      }, 220);
    },
    [request, uiRef],
  );
  useEffect(() => () => clearTimeout(moveTimer.current), []);

  const change = (patch: Partial<Ui>) => {
    const next = { ...ui, ...patch };
    setUi(next);
    request(next, queryView.current);
  };

  const { data, loading, error } = useMapQuery(loader, url, (answered, body) => {
    shownRef.current = { url: answered, query: body.query as ShownInfluence };
  });
  const shown = data?.body ?? null;

  // The URL carries the view, so it can be shared and opened by the screenshot tool.
  useEffect(() => {
    const qs = serialiseInfluenceState(
      { ...ui, view: view ? { z: view.z, lat: view.lat, lon: view.lon } : null },
      meta,
    );
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, "", next);
  }, [ui, view, meta]);

  const labels = useMemo(() => (outlines ? stateLabels(outlines) : []), [outlines]);
  const hasBasemap = basemapUrl !== null;
  const layers = useMemo(
    () =>
      tokens
        ? influenceLayers({
            states: outlines,
            areas: areaOutlines,
            labels,
            data: shown,
            tokens,
            brand: ui.brand,
            selected: ui.sel,
            hasBasemap,
            fontReady,
          })
        : [],
    [tokens, outlines, areaOutlines, labels, shown, ui.brand, ui.sel, hasBasemap, fontReady],
  );

  const shownLevel = levelOf(shown?.query);
  const stateLevel = shownLevel === null || shownLevel === "state";
  const cellsById = useMemo(() => new Map((shown?.cells ?? []).map((c) => [c.id, c])), [shown]);
  // Every cell carries its centre ([lon, lat]): an area's label point, or the centre of an h3 cell.
  const positions = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const c of shown?.cells ?? []) m.set(c.id, c.centroid);
    return m;
  }, [shown]);

  // Real outlines for SA4, SA3 and SA2 come from the static boundary files.
  const outlineUrl =
    shownLevel === "sa4" || shownLevel === "sa3" || shownLevel === "sa2" ? (meta.geo?.levels[shownLevel] ?? null) : null;
  const areaOutlines = useBoundaries(outlineUrl);

  const nameOf = useCallback((c: InfluenceCell): string => c.name, []);

  const top = useMemo(() => {
    if (!shown) return [];
    const box = view?.bbox;
    return topBy(
      shown.cells,
      (c) => c.value,
      nameOf,
      (c) => {
        if (stateLevel || !box) return true;
        const p = positions.get(c.id);
        return p ? inBBox(p[0], p[1], box) : false;
      },
      10,
    );
  }, [shown, view, stateLevel, positions, nameOf]);

  const selCell = ui.sel ? cellsById.get(ui.sel) : undefined;
  const brandClass = `gm-b-${ui.brand}`;

  const select = useCallback(
    (id: string | null) => {
      setUi((u) => ({ ...u, sel: id }));
      if (id && window.matchMedia("(max-width: 1000px)").matches) {
        panelRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
      }
    },
    [reduced],
  );

  const onClick = useCallback(
    (info: PickingInfo) => {
      const id = idOf(info);
      if (id) select(id);
    },
    [select],
  );

  const measureRate = shown?.query.measure === "per1000";
  const shownAudience = (shown?.query.audience as Audience | undefined) ?? ui.audience;
  const describe = useCallback(
    (info: PickingInfo): TipContent | null => {
      const id = idOf(info);
      const cell = id ? cellsById.get(id) : undefined;
      if (!cell) return null;
      const rows: [string, string][] = [
        measureRate ? ["Per 1,000 residents", cell.display] : [WHO_SHORT[shownAudience], cell.display],
      ];
      rows.push(["Where", cell.parent]);
      if (cell.population) rows.push(["Residents", fmtInt(cell.population)]);
      return { title: nameOf(cell), rows };
    },
    [cellsById, measureRate, shownAudience, nameOf],
  );

  const zoomToSelection = () => {
    if (!ui.sel) return;
    if (stateLevel) {
      const b = outlines ? stateBounds(outlines, ui.sel) : null;
      if (b) handleRef.current?.fitBounds(b);
      return;
    }
    const p = positions.get(ui.sel);
    if (!p || shownLevel === null) return;
    // Into the next finer level, but never past the suburb-size cap.
    handleRef.current?.flyTo(p[0], p[1], Math.min(MAX_ZOOM, levelStartZoom(finerLevel(shownLevel)) + 0.3));
  };

  const prefetch = useCallback(
    (month: string) => {
      const v = queryView.current;
      if (v) loader.prefetch(planInfluence({ ...uiRef.current, month }, v, null));
    },
    [loader, uiRef],
  );

  const brandOptions = (lockedBrand ? [lockedBrand] : (["all", "yourtal", "snapapp", "ftr"] as BrandChoice[])).map(
    (b) => ({ value: b, label: BRAND_NAMES[b] }),
  );
  const unitTitle = measureRate ? "Per 1,000 residents" : WHO_SHORT[shownAudience];
  const shownMonth = shown?.query.month ?? ui.month;
  const summary = `${BRAND_NAMES[ui.brand]} · ${AUDIENCE_NAMES[ui.audience]} · ${monthLong(ui.month)}`;

  return (
    <div className="gm-wrap">
      <ControlSheet summary={summary}>
        <Select
          label="Brand"
          value={ui.brand}
          options={brandOptions}
          disabled={lockedBrand !== null}
          onChange={(v) => change({ brand: v as BrandChoice, sel: null })}
        />
        <Select
          label="Audience"
          value={ui.audience}
          options={(["businesses", "people", "both"] as Audience[]).map((a) => ({ value: a, label: AUDIENCE_NAMES[a] }))}
          onChange={(v) => change({ audience: v as Audience })}
        />
        <div className="ctl">
          <span className="lab">Measure</span>
          <Segmented
            label="Measure"
            value={ui.measure}
            options={[
              { value: "count", label: "Count" },
              { value: "per1000", label: "Per 1,000 residents" },
            ]}
            onChange={(v) => change({ measure: v as Measure })}
          />
        </div>
        <MonthControl
          months={meta.months}
          value={ui.month}
          reducedMotion={reduced}
          onChange={(m) => change({ month: m })}
          onPrefetch={prefetch}
        />
      </ControlSheet>
      {lockedBrand ? <p className="small muted gm-lock">Your role shows {BRAND_NAMES[lockedBrand]} only.</p> : null}

      {error ? (
        <Callout tone="warn" role="alert">
          The map data could not load. {error}
        </Callout>
      ) : null}

      <div className="gm-body">
        <div className="gm-main">
          {tokens ? (
            <MapCanvas
              basemapUrl={basemapUrl}
              ariaLabel="Map of Australia showing where registered people and businesses are. The top areas are listed beside it."
              initialView={initial.view}
              layers={layers}
              tokens={tokens}
              dataReady={shown !== null && outlines !== null}
              levelText={levelLabel(shownLevel)}
              busy={loading}
              reducedMotion={reduced}
              onView={onView}
              onClick={onClick}
              describe={describe}
              handleRef={handleRef}
              hint="Drag to move. Ctrl + scroll, pinch or + and − to zoom."
            />
          ) : (
            <div className="gm-stage" data-map-ready="false" />
          )}
          {shown ? (
            <Legend
              title={unitTitle}
              legend={shown.legend}
              mode="scale"
              brandClass={brandClass}
              noneLabel={stateLevel ? undefined : "None registered"}
              note={
                shown.truncated
                  ? "Showing the largest areas only. Zoom in to see the rest."
                  : "Bands are worked out from the areas on screen."
              }
            />
          ) : null}
        </div>

        <aside className={`gm-panel ${brandClass}`} ref={panelRef} aria-label="Area details and top areas">
          {selCell ? (
            <div className="gm-sel" aria-live="polite">
              <div>
                <div className="gm-kicker">
                  {typeof shownLevel === "string"
                    ? (LEVEL_KICKER[shownLevel] ?? "Area")
                    : `Area, ${levelLabel(shownLevel).replace("Areas ", "")}`}
                </div>
                <h3>{nameOf(selCell)}</h3>
                <div className="small muted">{selCell.parent}</div>
              </div>
              <div>
                <div className="gm-big">
                  <Num n={{ value: selCell.value, display: selCell.display, suppressed: selCell.suppressed }} />
                </div>
                <div className="small muted">
                  {measureRate ? "per 1,000 residents" : WHO[shownAudience]}, to {monthLong(shownMonth)}
                </div>
                <div className="row small gm-pills">
                  {selCell.population ? (
                    <span className="pill plain">{fmtInt(selCell.population)} residents</span>
                  ) : null}
                  <span className="pill plain">New this month {selCell.newThisMonth.display}</span>
                  {!measureRate && selCell.population ? <PerThousand cell={selCell} /> : null}
                </div>
              </div>
              <p className="note">
                {seesExact
                  ? "Groups under 10 are marked as small numbers. Your role sees them in full. Do not share or export them."
                  : 'Groups under 10 show as "<10".'}
              </p>
              <div className="row">
                <button type="button" className="btn sm" onClick={zoomToSelection}>
                  Zoom to this area
                </button>
                <button type="button" className="btn sm" onClick={() => select(null)}>
                  Close
                </button>
              </div>
            </div>
          ) : ui.sel && shown && !loading ? (
            <div className="gm-sel">
              <p className="small muted">Nobody is registered in the selected area for these filters.</p>
              <button type="button" className="btn sm" onClick={() => select(null)}>
                Close
              </button>
            </div>
          ) : null}

          <div className="gm-toplist">
            <div className="gm-kicker">Top areas on screen</div>
            <h3>{stateLevel ? "Where the audience is" : "Largest areas in view"}</h3>
            {top.length ? (
              <ol>
                {top.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => select(c.id)} aria-pressed={c.id === ui.sel}>
                      <span>{nameOf(c)}</span>
                      <b>
                        {c.display}
                        {measureRate ? " per 1,000" : ""}
                      </b>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="small muted">{shown ? "Nothing registered in this view." : "Loading the first view."}</p>
            )}
            <p className="note">Click an area on the map or choose one here to open its detail.</p>
          </div>
        </aside>
      </div>
      <PerfLine stats={loader.stats} />
    </div>
  );
}

/** The per-1,000 figure for a count, worked out from an exact count and the residents. Hidden when the count is. */
function PerThousand({ cell }: { cell: InfluenceCell }) {
  const exact = !cell.display.startsWith("<");
  if (!exact || !cell.population) return <span className="pill plain">Per 1,000 hidden</span>;
  const rate = (cell.value / cell.population) * 1000;
  return <span className="pill acc plain">{rate.toFixed(2)} per 1,000 residents</span>;
}
