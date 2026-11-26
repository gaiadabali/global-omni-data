"use client";

import type { PickingInfo } from "@deck.gl/core";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Callout, Num, Segmented, Select } from "@/components/ui";
import { fmtInt, monthLong, monthShort } from "@/lib/format";
import type { InfluenceCell, PresentedArea, PresentedInfluence, PresentedSummary } from "@/server/data";
import { InfluenceDetail } from "./InfluenceDetail";
import { MapCanvas, type MapHandle, type MapViewChange, type TipContent } from "./MapCanvas";
import {
  HeadlineStrip,
  MapLegend,
  PerfLine,
  RankedList,
  SearchBox,
  TabStrip,
  TimeBar,
  rowSpark,
  type ListRow,
  type Tile,
} from "./pd-ui";
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
import { boundaryCode, type BoundaryCollection, type BoundaryFeature } from "./boundaries";
import { LABEL_FONT_SPEC, influenceLayers, levelOfData } from "./influence-layers";
import {
  bubbleMaxPx,
  changeText,
  levelOfId,
  matchRows,
  monthBefore,
  signedPct,
  visibleCount,
  type IdLevel,
} from "./pd-lib";
import { areaUrl, planInfluence, summaryUrl, type ShownInfluence, type SummaryLevel } from "./plan";
import { stateBounds, stateCode, stateLabels, type StateFeature } from "./states";
import {
  serialiseInfluenceState,
  type Audience,
  type BrandChoice,
  type InfluenceState,
  type MapMetaLike,
  type MapMode,
  type Measure,
} from "./url-state";
import { MAX_ZOOM, inBBox, levelLabel, type InfluenceLevel } from "./zoom";

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
  both: "People and businesses",
  businesses: "Registered businesses",
  people: "Registered people",
};
const WHO: Record<Audience, string> = {
  both: "people and businesses",
  businesses: "businesses",
  people: "people",
};
const MODE_OPTIONS: { value: MapMode; label: string }[] = [
  { value: "bubbles", label: "Bubbles" },
  { value: "shaded", label: "Shaded areas" },
  { value: "hex", label: "Hexagons" },
];
const NOUN: Record<string, string> = { state: "states", sa4: "SA4 regions", sa3: "SA3 areas", sa2: "SA2 areas" };
/** The zoom a selected area is flown to: one step finer than the level it is on. */
const FLY_ZOOM: Record<IdLevel, number> = { state: 5, sa4: 5.9, sa3: 7.2, sa2: 8.4, h3: 10.2 };
const MAX_ROWS = 100;

interface Ui {
  brand: BrandChoice;
  audience: Audience;
  measure: Measure;
  month: string;
  mode: MapMode;
  sel: string | null;
}

/** The level the answer on screen is for: an area level, or an H3 resolution. null before the first answer. */
function levelOf(q: PresentedInfluence["query"] | undefined): InfluenceLevel | null {
  if (!q) return null;
  return typeof q.level === "object" ? (q.level.h3 as 6 | 7) : q.level;
}

const levelKey = (q: PresentedInfluence["query"]): string =>
  `${typeof q.level === "object" ? `h3-${q.level.h3}` : q.level}|${q.brand}|${q.audience}|${q.measure}`;

/** The area a click or hover landed on: a state code, an ABS area code or an h3 index. */
function idOf(info: PickingInfo): string | null {
  if (!info.object) return null;
  if (info.layer?.id === "states") return stateCode(info.object as StateFeature);
  if (info.layer?.id === "areas") return boundaryCode(info.object as BoundaryFeature);
  if (info.layer?.id === "hex" || info.layer?.id === "bubbles") return (info.object as InfluenceCell).id;
  return null;
}

export default function InfluenceMap({ initial, meta, basemapUrl, lockedBrand, seesExact }: InfluenceMapProps) {
  const tokens = useMapTokens();
  const reduced = useReducedMotion();
  const fontReady = useFontReady(LABEL_FONT_SPEC);
  const outlines = useStateOutlines();
  const loader = useMapLoader<PresentedInfluence>();
  const headLoader = useMapLoader<PresentedSummary>();
  const prevLoader = useMapLoader<PresentedSummary>();
  const moversLoader = useMapLoader<PresentedSummary>();
  const areaLoader = useMapLoader<PresentedArea>();
  const handleRef = useRef<MapHandle>(null);

  const [ui, setUi] = useState<Ui>({
    brand: initial.brand,
    audience: initial.audience,
    measure: initial.measure,
    month: initial.month,
    mode: initial.mode,
    sel: initial.sel,
  });
  const uiRef = useLatest(ui);
  const [view, setView] = useState<MapViewChange | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const queryView = useRef<MapViewChange | null>(null);
  const shownRef = useRef<{ url: string; query: ShownInfluence } | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The panels
  const [search, setSearch] = useState("");
  const [listTab, setListTab] = useState<"ranked" | "movers">("ranked");
  const [sheetTab, setSheetTab] = useState<"areas" | "detail">(initial.sel ? "detail" : "areas");
  const [sheetOpen, setSheetOpen] = useState(initial.sel !== null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The value that gets the biggest bubble, per level and filter, learned from the current month so that a time-lapse
  // through earlier months shows the bubbles growing instead of renormalising every frame.
  const [bubbleRefs, setBubbleRefs] = useState<Record<string, number>>({});

  // Which request does this view need? Asked in event handlers (never while rendering), because the answer
  // depends on what is already on screen: a view inside the box already fetched needs nothing new.
  const request = useCallback((u: Ui, v: MapViewChange | null) => {
    if (v) setUrl(planInfluence(u, v, shownRef.current, u.mode === "hex"));
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
    if (body.query.month === meta.currentMonth && body.cells.length > 0) {
      let top = 0;
      for (const c of body.cells) if (c.value > top) top = c.value;
      const key = levelKey(body.query);
      setBubbleRefs((r) => ((r[key] ?? 0) >= top ? r : { ...r, [key]: top }));
    }
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

  const shownLevel = levelOf(shown?.query);
  const stateLevel = shownLevel === null || shownLevel === "state";
  const areaLevel: SummaryLevel = shownLevel === null ? "state" : typeof shownLevel === "string" ? shownLevel : "sa2";

  /* ---------------- the headline, the movers and the detail ---------------- */

  const controls = { brand: ui.brand, audience: ui.audience, measure: ui.measure };
  const headUrl = summaryUrl(controls, ui.month, "state");
  const before = monthBefore(meta.months, ui.month);
  const prevUrl = before ? summaryUrl(controls, before, "state") : null;
  const moversUrl = summaryUrl(controls, ui.month, areaLevel);
  const headQ = useMapQuery(headLoader, headUrl);
  const prevQ = useMapQuery(prevLoader, prevUrl);
  const moversQ = useMapQuery(moversLoader, moversUrl === headUrl ? null : moversUrl);
  const head = headQ.data?.body ?? null;
  const prev = prevQ.data?.body ?? null;
  const movers = (moversUrl === headUrl ? head : (moversQ.data?.body ?? null))?.movers ?? [];

  const selLevel = ui.sel ? levelOfId(ui.sel) : null;
  const detailUrl = ui.sel && selLevel ? areaUrl(controls, ui.month, selLevel, ui.sel) : null;
  const detailQ = useMapQuery(areaLoader, detailUrl);
  const detailBody = detailQ.data && detailQ.data.url === detailUrl ? detailQ.data.body : null;

  /* ---------------- outlines and layers ---------------- */

  // Real outlines for SA4, SA3 and SA2 come from the static boundary files. Bubbles need no SA2 outlines.
  const wantOutlines =
    shownLevel === "sa4" || shownLevel === "sa3" || (shownLevel === "sa2" && ui.mode !== "bubbles") ? shownLevel : null;
  const outlineUrl = wantOutlines ? (meta.geo?.levels[wantOutlines] ?? null) : null;
  const allOutlines = useBoundaries(outlineUrl);
  // Draw only the areas the answer on screen has a cell for: at SA2 level that is the box in view, not all 2,454 outlines
  // (the software renderer in the screenshot tool, and a phone, pay for every vertex of every frame).
  const areaOutlines = useMemo<BoundaryCollection | null>(() => {
    if (!allOutlines || !shown) return null;
    const ids = new Set(shown.cells.map((c) => c.id));
    return { type: "FeatureCollection", features: allOutlines.features.filter((f) => ids.has(boundaryCode(f))) };
  }, [allOutlines, shown]);

  const labels = useMemo(() => (outlines ? stateLabels(outlines) : []), [outlines]);
  const hasBasemap = basemapUrl !== null;
  const dataLevel = levelOfData(shown);
  const shownTop = useMemo(() => {
    let top = 0;
    for (const c of shown?.cells ?? []) if (c.value > top) top = c.value;
    return top;
  }, [shown]);
  const bubbleRef = (shown ? bubbleRefs[levelKey(shown.query)] : undefined) ?? Math.max(1, shownTop);

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
            mode: ui.mode,
            bubbleRef,
          })
        : [],
    [tokens, outlines, areaOutlines, labels, shown, ui.brand, ui.sel, ui.mode, hasBasemap, fontReady, bubbleRef],
  );

  const cellsById = useMemo(() => new Map((shown?.cells ?? []).map((c) => [c.id, c])), [shown]);

  /* ---------------- the list ---------------- */

  const measureRate = shown?.query.measure === "per1000";
  const rankedRows = useMemo<ListRow[]>(() => {
    if (!shown) return [];
    const box = view?.bbox;
    const sorted = shown.cells
      .filter((c) => stateLevel || !box || inBBox(c.centroid[0], c.centroid[1], box) || search.trim() !== "")
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "en-AU"));
    return sorted.map((c) => {
      const fresh = visibleCount(c.newThisMonth);
      const total = visibleCount({ value: c.value, display: c.display, suppressed: c.suppressed });
      // A percentage only from two numbers the API let this viewer see, and only for counts (a rate has no running total).
      const pct =
        !measureRate && !c.suppressed && fresh !== null && total !== null && total - fresh > 0 && !c.newThisMonth.suppressed
          ? (fresh / (total - fresh)) * 100
          : null;
      return {
        id: c.id,
        name: c.name,
        parent: c.parent,
        primary: c.display,
        secondary: signedPct(pct) ?? changeText(c.newThisMonth),
        secondaryTone: pct !== null ? "up" : "plain",
        visual: rowSpark(c.trend),
        centroid: c.centroid,
        title: `${c.name}: ${c.display}${measureRate ? " per 1,000 residents" : ""}. New this month ${changeText(c.newThisMonth)}.`,
      } satisfies ListRow;
    });
  }, [shown, view, stateLevel, search, measureRate]);

  const moverRows = useMemo<ListRow[]>(
    () =>
      movers.map((m) => ({
        id: m.id,
        name: m.name,
        parent: m.parent,
        primary: changeText(m.change),
        secondary: signedPct(m.changePct) ?? `${m.display} in all`,
        secondaryTone: m.changePct !== null ? "up" : "plain",
        visual: rowSpark(m.trend),
        centroid: m.centroid,
        title: `${m.name}: ${changeText(m.change)} this month.`,
      })),
    [movers],
  );

  const matched = useMemo(() => matchRows(rankedRows, search), [rankedRows, search]);
  const listRows = listTab === "ranked" ? matched.slice(0, MAX_ROWS) : matchRows(moverRows, search);

  /* ---------------- selecting and flying ---------------- */

  const flyTo = useCallback(
    (id: string, centroid: [number, number] | null) => {
      const lvl = levelOfId(id);
      if (!lvl) return;
      if (lvl === "state" && outlines) {
        const b = stateBounds(outlines, id);
        if (b) {
          handleRef.current?.fitBounds(b);
          return;
        }
      }
      if (centroid) handleRef.current?.flyTo(centroid[0], centroid[1], Math.min(MAX_ZOOM, FLY_ZOOM[lvl]));
    },
    [outlines],
  );

  const select = useCallback((id: string | null) => {
    setUi((u) => ({ ...u, sel: id }));
    if (id) {
      setSheetTab("detail");
      setSheetOpen(true);
    }
  }, []);

  const pick = useCallback(
    (row: ListRow) => {
      select(row.id);
      flyTo(row.id, row.centroid);
    },
    [select, flyTo],
  );

  const onClick = useCallback(
    (info: PickingInfo) => {
      const id = idOf(info);
      if (id) select(id);
    },
    [select],
  );

  const zoomToSelection = () => {
    if (!ui.sel) return;
    const c = detailBody?.area.centroid ?? cellsById.get(ui.sel)?.centroid ?? null;
    flyTo(ui.sel, c);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape" && ui.sel && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
      select(null);
    }
  };

  const shownAudience = (shown?.query.audience as Audience | undefined) ?? ui.audience;
  const describe = useCallback(
    (info: PickingInfo): TipContent | null => {
      const id = idOf(info);
      const cell = id ? cellsById.get(id) : undefined;
      if (!cell) return null;
      const rows: [string, string][] = [
        measureRate ? ["Per 1,000 residents", cell.display] : [AUDIENCE_NAMES[shownAudience], cell.display],
      ];
      rows.push(["Where", cell.parent]);
      if (cell.population) rows.push(["Residents", fmtInt(cell.population)]);
      return { title: cell.name, rows };
    },
    [cellsById, measureRate, shownAudience],
  );

  const prefetch = useCallback(
    (month: string) => {
      const v = queryView.current;
      if (v) loader.prefetch(planInfluence({ ...uiRef.current, month }, v, null, uiRef.current.mode === "hex"));
    },
    [loader, uiRef],
  );

  /* ---------------- the numbers across the top ---------------- */

  const h = head?.headline ?? null;
  const prevNew = prev ? visibleCount(prev.headline.newThisMonth) : null;
  const newNow = h ? visibleCount(h.newThisMonth) : null;
  const newDelta =
    newNow !== null && prevNew !== null && prevNew > 0 ? ((newNow - prevNew) / prevNew) * 100 : null;
  const inView = useMemo(() => {
    const box = view?.bbox;
    if (!shown) return 0;
    if (stateLevel || !box) return shown.cells.length;
    return shown.cells.filter((c) => inBBox(c.centroid[0], c.centroid[1], box)).length;
  }, [shown, view, stateLevel]);
  const nounKey = typeof shownLevel === "string" ? shownLevel : shownLevel === null ? "state" : "hex";
  const tiles: Tile[] = [
    {
      key: "total",
      label: AUDIENCE_NAMES[ui.audience],
      value: h ? <Num n={h.total} /> : "–",
      sub: `to ${monthLong(ui.month)}`,
    },
    {
      key: "new",
      label: "New this month",
      value: h ? <Num n={h.newThisMonth} /> : "–",
      sub:
        newDelta !== null && before
          ? `${signedPct(newDelta)} on ${monthShort(before)}`
          : before
            ? `on ${monthShort(before)}: not shown`
            : "first month",
      tone: newDelta === null ? "plain" : newDelta >= 0 ? "up" : "down",
    },
    {
      key: "growth",
      label: "Monthly growth",
      value: h ? (signedPct(h.growthPct) ?? "–") : "–",
      sub: "of last month's total",
    },
    {
      key: "per1000",
      label: "Per 1,000, nationally",
      value: h?.per1000 != null ? h.per1000.toFixed(1) : "–",
      sub: "residents of Australia",
    },
    {
      key: "areas",
      label: "Areas covered",
      value: shown ? fmtInt(inView) : "–",
      sub: nounKey === "hex" ? `${levelLabel(shownLevel).toLowerCase()}` : `${NOUN[nounKey] ?? "areas"}${stateLevel || nounKey === "sa4" || nounKey === "sa3" ? "" : " in view"}`,
    },
  ];

  const brandOptions = (lockedBrand ? [lockedBrand] : (["all", "yourtal", "snapapp", "ftr"] as BrandChoice[])).map(
    (b) => ({ value: b, label: BRAND_NAMES[b] }),
  );
  const brandClass = `gm-b-${ui.brand}`;
  const unitTitle = measureRate ? "Per 1,000 residents" : AUDIENCE_NAMES[shownAudience];
  const levelText = levelLabel(shownLevel);
  const hexHint = ui.mode === "hex" && shown !== null && typeof shownLevel !== "number";
  const filterSummary = `${BRAND_NAMES[ui.brand]} · ${AUDIENCE_NAMES[ui.audience]} · ${measureRate || ui.measure === "per1000" ? "per 1,000" : "count"}`;
  const empty = (
    <p className="small muted">
      {shown
        ? search.trim()
          ? `No area here matches “${search.trim()}”. Zoom in or out to search other areas.`
          : "Nothing registered in this view."
        : "Loading the first view."}
    </p>
  );
  const stats = [loader.stats, headLoader.stats, prevLoader.stats, moversLoader.stats, areaLoader.stats];
  const perf = {
    requests: stats.reduce((n, s) => n + s.requests, 0),
    aborted: stats.reduce((n, s) => n + s.aborted, 0),
    hits: stats.reduce((n, s) => n + s.hits, 0),
    urls: loader.stats.urls,
  };

  return (
    <div className="pd" data-pd="influence" onKeyDown={onKeyDown}>
      <h1 className="sr-only">Influence map</h1>
      {error ? (
        <div className="pd-alert">
          <Callout tone="warn" role="alert">
            The map data could not load. {error}
          </Callout>
        </div>
      ) : null}
      {tokens ? (
        <MapCanvas
          basemapUrl={basemapUrl}
          ariaLabel="Map of Australia showing where registered people and businesses are. The ranked list beside it gives the same figures as text."
          initialView={initial.view}
          layers={layers}
          tokens={tokens}
          dataReady={shown !== null && outlines !== null}
          busy={loading}
          reducedMotion={reduced}
          onView={onView}
          onClick={onClick}
          describe={describe}
          handleRef={handleRef}
          detailOpen={ui.sel !== null}
        >
          <HeadlineStrip tiles={tiles} label="Headline figures" busy={headQ.loading} />

          <div className="pd-toolbar">
            <Segmented
              label="How to draw the areas"
              value={ui.mode}
              options={MODE_OPTIONS}
              onChange={(v) => change({ mode: v as MapMode })}
            />
            <span className="pd-level" aria-live="polite">
              {levelText}
              {loading ? <span className="muted"> {"·"} updating</span> : null}
            </span>
            {hexHint ? <span className="pd-level muted">Zoom in for hexagons</span> : null}
          </div>

          {shown ? (
            <MapLegend
              title={unitTitle}
              legend={shown.legend}
              kind={ui.mode === "bubbles" ? "bubbles" : "scale"}
              brandClass={brandClass}
              bubble={{ ref: bubbleRef, maxPx: bubbleMaxPx(dataLevel) }}
              noneLabel={ui.mode !== "bubbles" && !stateLevel ? "None registered" : undefined}
              note={
                shown.truncated
                  ? "Showing the largest areas only. Zoom in to see the rest."
                  : ui.mode === "bubbles"
                    ? "Circle area follows the count. Under 10 is a small ring."
                    : "Bands are worked out from the areas on screen."
              }
            />
          ) : null}

          <div
            className="pd-dock"
            data-open={sheetOpen ? "true" : "false"}
            data-tab={sheetTab}
            data-sel={ui.sel ? "true" : "false"}
            data-occ-c="bottom"
          >
            <TimeBar
              months={meta.months}
              value={ui.month}
              reducedMotion={reduced}
              caption="Registered up to"
              onChange={(m) => change({ month: m })}
              onPrefetch={prefetch}
            />

            <TabStrip
              className="pd-sheet-tabs"
              label="Panels"
              active={sheetTab}
              tabs={[
                { id: "areas", label: "Areas" },
                { id: "detail", label: ui.sel && detailBody ? detailBody.area.name : "Detail" },
              ]}
              onChange={(id) => {
                setSheetTab(id as "areas" | "detail");
                setSheetOpen(true);
              }}
            />
            <button
              type="button"
              className="pd-sheet-grip"
              aria-expanded={sheetOpen}
              aria-label={sheetOpen ? "Lower the panel" : "Raise the panel"}
              onClick={() => setSheetOpen((o) => !o)}
            />

            <aside className="pd-left pd-panel" aria-label="Areas ranked" data-occ-d="left">
              <header className="pd-phead">
                <h2 className="pd-title">Influence map</h2>
                <button
                  type="button"
                  className="pd-ftoggle"
                  aria-expanded={filtersOpen}
                  aria-controls="pd-filters"
                  onClick={() => setFiltersOpen((o) => !o)}
                >
                  <span>{filtersOpen ? "Hide filters" : "Filters"}</span>
                  <span className="muted small pd-fsum">{filterSummary}</span>
                </button>
                <div id="pd-filters" className={`pd-filters${filtersOpen ? " open" : ""}`}>
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
                    options={(["both", "people", "businesses"] as Audience[]).map((a) => ({
                      value: a,
                      label: AUDIENCE_NAMES[a],
                    }))}
                    onChange={(v) => change({ audience: v as Audience })}
                  />
                  <div className="ctl pd-measure">
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
                  {lockedBrand ? <p className="xs muted pd-lock">Your role shows {BRAND_NAMES[lockedBrand]} only.</p> : null}
                </div>
              </header>
              <div className="pd-lhead">
                <SearchBox value={search} onChange={setSearch} label="Search areas by name" placeholder="Search areas by name" />
                <TabStrip
                  label="List"
                  active={listTab}
                  controls="pd-list"
                  tabs={[
                    { id: "ranked", label: "Ranked" },
                    { id: "movers", label: "Biggest movers" },
                  ]}
                  onChange={(id) => setListTab(id as "ranked" | "movers")}
                />
                <p className="pd-count xs muted">
                  {listTab === "ranked"
                    ? `${fmtInt(matched.length)} ${nounKey === "hex" ? "areas" : (NOUN[nounKey] ?? "areas")}${stateLevel || nounKey === "sa4" || nounKey === "sa3" ? "" : " in view"} · ${measureRate ? "per 1,000 residents" : WHO[shownAudience]}`
                    : `Most new this month, ${NOUN[areaLevel] ?? "areas"}`}
                </p>
              </div>
              <div className="pd-list" id="pd-list" role="tabpanel">
                <RankedList
                  rows={listRows}
                  selectedId={ui.sel}
                  onPick={pick}
                  label={listTab === "ranked" ? "Areas ranked by count" : "Areas with the most new registrations this month"}
                  empty={empty}
                />
                {listTab === "ranked" && matched.length > MAX_ROWS ? (
                  <p className="xs muted pd-more">Showing the top {MAX_ROWS}. Search to narrow the list.</p>
                ) : null}
              </div>
            </aside>

            <aside className="pd-right pd-panel" aria-label="Selected area" data-occ-d="right">
              {ui.sel ? (
                <InfluenceDetail
                  body={detailBody}
                  loading={detailQ.loading}
                  error={detailQ.error}
                  month={ui.month}
                  seesExact={seesExact}
                  onClose={() => select(null)}
                  onZoom={zoomToSelection}
                  onJump={(id) => {
                    select(id);
                    flyTo(id, null);
                  }}
                />
              ) : (
                <div className="pd-pad">
                  <p className="small muted">Choose an area on the map or in the list to see its detail.</p>
                </div>
              )}
            </aside>
          </div>
          <PerfLine stats={perf} />
        </MapCanvas>
      ) : (
        <div className="gm-stage" data-map-ready="false" />
      )}
    </div>
  );
}
