"use client";

import type { PickingInfo } from "@deck.gl/core";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Callout, Num, Select } from "@/components/ui";
import { fmtInt, monthLong, monthShort } from "@/lib/format";
import type {
  ActivityHeatCell,
  ActivityMerchant,
  PresentedActivity,
  PresentedActivityArea,
  PresentedHotspots,
} from "@/server/data";
import { ActivityDetail } from "./ActivityDetail";
import { activityLayers, visibleMerchants } from "./activity-layers";
import { MapCanvas, type MapHandle, type MapViewChange, type TipContent } from "./MapCanvas";
import {
  HeadlineStrip,
  IconClose,
  MapLegend,
  PerfLine,
  RankedList,
  SearchBox,
  TabStrip,
  TimeBar,
  type ListRow,
  type Tile,
} from "./pd-ui";
import {
  useFontReady,
  useLatest,
  useMapLoader,
  useMapQuery,
  useMapTokens,
  useReducedMotion,
  useStateOutlines,
} from "./hooks";
import { LABEL_FONT_SPEC } from "./influence-layers";
import { matchRows, shareText } from "./pd-lib";
import { activityAreaUrl, hotspotsUrl, planActivity, type ShownActivity } from "./plan";
import { topBy } from "./top";
import {
  isSensitive,
  isTeenBand,
  serialiseActivityState,
  type ActivityState,
  type MapMetaLike,
} from "./url-state";
import { HEX_WIDTH_KM, inBBox, kmLabel, snapBBox } from "./zoom";

export interface ActivityMapProps {
  initial: ActivityState;
  meta: MapMetaLike;
  basemapUrl: string | null;
  /** A brand lead's brand name: the map then covers only people who also use that brand. */
  lockedBrandName: string | null;
  seesExact: boolean;
}

interface Ui {
  category: string;
  ageBand: string;
  month: string;
  heat: boolean;
  off: string[];
  sel: string | null;
}

const isMerchantId = (id: string) => id.startsWith("M-");
/** The zoom a hotspot is flown to: close enough that the H3 cells are 2 km across and the shop dots are drawn. */
const HOTSPOT_ZOOM = 9.8;
const MERCHANT_ZOOM = 11;
/** Merchant dots appear from here. Further out the map shows the heat alone. */
const DOT_ZOOM = 7;

function pick(info: PickingInfo): { kind: "merchant" | "heat"; id: string } | null {
  if (!info.object) return null;
  if (info.layer?.id === "merchants") return { kind: "merchant", id: (info.object as ActivityMerchant).id };
  if (info.layer?.id === "heat") return { kind: "heat", id: (info.object as ActivityHeatCell).id };
  return null;
}

/** The make-up of an area in three coloured pieces, from the hotspots endpoint's category mix. */
function MixStrip({ mix }: { mix: PresentedHotspots["hotspots"][number]["mix"] }) {
  const parts = mix.filter((m) => m.share !== null && m.share > 0).slice(0, 4);
  const pieces: { category: string; x: number; w: number }[] = [];
  let at = 0;
  for (const m of parts) {
    const w = Math.max(2, (m.share ?? 0) * 56);
    pieces.push({ category: m.category, x: at, w });
    at += w;
  }
  return (
    <svg className="pd-spark" width="56" height="8" viewBox="0 0 56 8" aria-hidden="true">
      {pieces.map((p) => (
        <rect key={p.category} x={p.x} y="0" width={Math.max(0, p.w - 1)} height="8" rx="2" fill={`var(--c-${p.category})`} />
      ))}
    </svg>
  );
}

export default function ActivityMap({ initial, meta, basemapUrl, lockedBrandName, seesExact }: ActivityMapProps) {
  const tokens = useMapTokens();
  const reduced = useReducedMotion();
  const fontReady = useFontReady(LABEL_FONT_SPEC);
  const outlines = useStateOutlines();
  const loader = useMapLoader<PresentedActivity>();
  const hotLoader = useMapLoader<PresentedHotspots>();
  const areaLoader = useMapLoader<PresentedActivityArea>();
  const handleRef = useRef<MapHandle>(null);

  const [ui, setUi] = useState<Ui>({
    category: initial.category,
    ageBand: initial.ageBand,
    month: initial.month,
    heat: initial.heat,
    off: initial.off,
    sel: initial.sel,
  });
  const uiRef = useLatest(ui);
  const [view, setView] = useState<MapViewChange | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [hotUrl, setHotUrl] = useState<string | null>(null);
  const queryView = useRef<MapViewChange | null>(null);
  const shownRef = useRef<{ url: string; query: ShownActivity } | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [search, setSearch] = useState("");
  const [listTab, setListTab] = useState<"hotspots" | "merchants">("hotspots");
  const [sheetTab, setSheetTab] = useState<"areas" | "detail">(initial.sel ? "detail" : "areas");
  const [sheetOpen, setSheetOpen] = useState(
    () => initial.sel !== null || new URLSearchParams(window.location.search).get("panel") === "areas",
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Merchants named by an area's detail, so one can be opened even when it is not in the box on screen yet.
  const [known, setKnown] = useState<Record<string, ActivityMerchant>>({});

  const request = useCallback((u: Ui, v: MapViewChange | null) => {
    if (!v) return;
    const c = { category: u.category, ageBand: u.ageBand, month: u.month };
    setUrl(planActivity(c, v, shownRef.current));
    // Hotspots follow the view too: of the box on screen once zoomed in, of the whole country before that.
    setHotUrl(hotspotsUrl(c, v.z >= 5.5 ? snapBBox(v.bbox, v.z) : undefined, 20));
  }, []);

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
    shownRef.current = { url: answered, query: body.query as ShownActivity };
  });
  const shown = data?.body ?? null;
  const hotQ = useMapQuery(hotLoader, hotUrl);
  const hotspots = useMemo(() => hotQ.data?.body.hotspots ?? [], [hotQ.data]);

  // ?sel=top opens the busiest area on screen, whichever it is: a link that needs no cell id.
  const sel = ui.sel === "top" ? (hotspots[0]?.id ?? null) : ui.sel;
  const selHeatId = sel && !isMerchantId(sel) ? sel : null;
  const areaQ = useMapQuery(
    areaLoader,
    selHeatId ? activityAreaUrl({ category: ui.category, ageBand: ui.ageBand, month: ui.month }, selHeatId) : null,
    (_answered, body) => {
      setKnown((k) => {
        const next = { ...k };
        for (const m of body.merchants) next[m.id] = m;
        return next;
      });
    },
  );
  const areaUrlNow = selHeatId
    ? activityAreaUrl({ category: ui.category, ageBand: ui.ageBand, month: ui.month }, selHeatId)
    : null;
  const areaBody = areaQ.data && areaQ.data.url === areaUrlNow ? areaQ.data.body : null;

  useEffect(() => {
    const qs = serialiseActivityState(
      { ...ui, view: view ? { z: view.z, lat: view.lat, lon: view.lon } : null },
      meta,
    );
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, "", next);
  }, [ui, view, meta]);

  const teen = isTeenBand(ui.ageBand, meta);
  const offSet = useMemo(() => new Set(ui.off), [ui.off]);
  const zoom = view?.z ?? 3.7;
  const labelMode = zoom < 5 ? "states" : "capitals";
  const dotScale = zoom < 5 ? 0.8 : zoom < 8 ? 1 : 1.25;
  const lowZoom = zoom < 6.4;
  const showMerchants = zoom >= DOT_ZOOM;
  const layers = useMemo(
    () =>
      tokens
        ? activityLayers({
            states: outlines,
            data: shown,
            tokens,
            off: offSet,
            heat: ui.heat,
            selected: sel,
            hasBasemap: basemapUrl !== null,
            fontReady,
            labels: labelMode,
            lowZoom,
            showMerchants,
            dotScale,
          })
        : [],
    [tokens, outlines, shown, offSet, ui.heat, sel, basemapUrl, fontReady, labelMode, dotScale, lowZoom, showMerchants],
  );

  const categoryName = useMemo(() => new Map(meta.categories.map((c) => [c.id, c.name])), [meta.categories]);
  const merchants = useMemo(() => visibleMerchants(shown, offSet), [shown, offSet]);
  const merchantById = useMemo(() => new Map((shown?.merchants ?? []).map((m) => [m.id, m])), [shown]);
  const heatById = useMemo(() => new Map((shown?.heat ?? []).map((h) => [h.id, h])), [shown]);

  const box = view?.bbox;
  // Counts for the chips: the merchants on screen, by category (before the chips hide any).
  const inViewByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of shown?.merchants ?? []) {
      if (box && !inBBox(x.lon, x.lat, box)) continue;
      m.set(x.category, (m.get(x.category) ?? 0) + 1);
    }
    return m;
  }, [shown, box]);
  const merchantsOnScreen = useMemo(
    () => (box ? merchants.filter((m) => inBBox(m.lon, m.lat, box)).length : merchants.length),
    [merchants, box],
  );
  const heatOnScreen = useMemo(
    () => (shown && box ? shown.heat.filter((h) => inBBox(h.centroid[0], h.centroid[1], box)).length : 0),
    [shown, box],
  );

  /* ---------------- lists ---------------- */

  const hotRows = useMemo<ListRow[]>(() => {
    const inside = hotspots.filter((h) => !box || zoom < 5.5 || inBBox(h.centroid[0], h.centroid[1], box) || search.trim() !== "");
    return inside.map((h) => {
      const lead = h.mix.find((m) => m.share !== null && m.share > 0);
      return {
        id: h.id,
        name: h.name,
        parent: h.parent,
        primary: h.display,
        secondary: lead ? `${lead.name} ${shareText(lead.share) ?? ""}` : undefined,
        secondaryTone: "plain",
        visual: <MixStrip mix={h.mix} />,
        centroid: h.centroid,
        title: `${h.name}: ${h.display} people active.`,
      } satisfies ListRow;
    });
  }, [hotspots, box, zoom, search]);

  const merchantRows = useMemo<ListRow[]>(
    () =>
      topBy(
        merchants,
        (m) => m.value,
        (m) => m.name,
        (m) => !box || inBBox(m.lon, m.lat, box),
        100,
      ).map((m) => ({
        id: m.id,
        name: m.name,
        parent: categoryName.get(m.category) ?? m.category,
        primary: m.display,
        secondary: "receipts",
        secondaryTone: "plain",
        visual: <i className={`pd-dotc gm-cat-${m.category}`} aria-hidden="true" />,
        centroid: [m.lon, m.lat] as [number, number],
        title: `${m.name}: ${m.display} receipts scanned.`,
      })),
    [merchants, box, categoryName],
  );
  const listRows = matchRows(listTab === "hotspots" ? hotRows : merchantRows, search).slice(0, 100);

  /* ---------------- selecting ---------------- */

  const select = useCallback((id: string | null) => {
    setUi((u) => ({ ...u, sel: id }));
    if (id) {
      setSheetTab("detail");
      setSheetOpen(true);
    }
  }, []);

  const onPick = useCallback(
    (row: ListRow) => {
      select(row.id);
      handleRef.current?.flyTo(row.centroid[0], row.centroid[1], isMerchantId(row.id) ? MERCHANT_ZOOM : HOTSPOT_ZOOM);
    },
    [select],
  );

  const onClick = useCallback(
    (info: PickingInfo) => {
      const p = pick(info);
      if (p) select(p.id);
    },
    [select],
  );

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape" && ui.sel && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
      select(null);
    }
  };

  const describe = useCallback(
    (info: PickingInfo): TipContent | null => {
      const p = pick(info);
      if (!p) return null;
      if (p.kind === "merchant") {
        const m = merchantById.get(p.id);
        return m
          ? { title: m.name, rows: [[categoryName.get(m.category) ?? m.category, `${m.display} receipts`]] }
          : null;
      }
      const h = heatById.get(p.id);
      if (!h) return null;
      return {
        title: h.name,
        rows: [
          ["People active", h.display],
          ["Where", h.parent],
        ],
      };
    },
    [merchantById, heatById, categoryName],
  );

  const prefetch = useCallback(
    (month: string) => {
      const v = queryView.current;
      const u = uiRef.current;
      if (v) loader.prefetch(planActivity({ category: u.category, ageBand: u.ageBand, month }, v, null));
    },
    [loader, uiRef],
  );

  const toggleCategory = (id: string) =>
    setUi((u) => ({ ...u, off: u.off.includes(id) ? u.off.filter((x) => x !== id) : [...u.off, id] }));

  /* ---------------- the selected merchant ---------------- */

  const selMerchant = sel && isMerchantId(sel) ? (merchantById.get(sel) ?? known[sel]) : undefined;
  const res = shown ? shown.query.h3 : null;
  const shownMonth = shown?.query.month ?? ui.month;
  const shownAge = shown?.query.ageBand ?? "all";
  const monthText = `${monthLong(shownMonth)}${shownAge !== "all" ? `, ages ${shownAge}` : ""}`;

  /* ---------------- the numbers across the top ---------------- */

  const topHot = hotspots[0];
  const lead = topHot?.mix.find((m) => m.share !== null && m.share > 0);
  const tiles: Tile[] = [
    {
      key: "merchants",
      label: "Merchants on screen",
      value: shown ? (showMerchants ? fmtInt(merchantsOnScreen) : "Zoom in") : "–",
      sub: showMerchants ? "shop locations from receipts" : "dots appear from city scale",
    },
    {
      key: "areas",
      label: "Areas on screen",
      value: shown && ui.heat ? fmtInt(heatOnScreen) : "–",
      sub: res ? `about ${kmLabel(HEX_WIDTH_KM[res] ?? 5.6)} across` : undefined,
    },
    {
      key: "busiest",
      label: "Busiest area",
      value: topHot ? topHot.name : "–",
      sub: topHot ? `${topHot.display} people active` : undefined,
    },
    {
      key: "lead",
      label: "Top category there",
      value: lead ? lead.name : "–",
      sub: lead ? `${shareText(lead.share) ?? ""} of people active` : undefined,
    },
    {
      key: "showing",
      label: "Showing",
      value: monthShort(shownMonth) + " " + shownMonth.slice(0, 4),
      sub: shownAge === "all" ? "all ages" : `ages ${shownAge}`,
    },
  ];

  const levelText = `${ui.heat && res ? `Activity areas about ${kmLabel(HEX_WIDTH_KM[res] ?? 5.6)} across` : "Merchant dots"}`;
  const summary = `${ui.category === "all" ? "All categories" : (categoryName.get(ui.category) ?? ui.category)} · ${ui.ageBand === "all" ? "All ages" : ui.ageBand}`;
  const empty = (
    <p className="small muted">
      {shown
        ? search.trim()
          ? `Nothing here matches “${search.trim()}”.`
          : listTab === "hotspots"
            ? "No area in this view has enough people to list."
            : "No merchants in this view with these filters."
        : "Loading the first view."}
    </p>
  );
  const stats = [loader.stats, hotLoader.stats, areaLoader.stats];
  const perf = {
    requests: stats.reduce((n, s) => n + s.requests, 0),
    aborted: stats.reduce((n, s) => n + s.aborted, 0),
    hits: stats.reduce((n, s) => n + s.hits, 0),
    urls: loader.stats.urls,
  };

  return (
    <div className="pd" data-pd="activity" onKeyDown={onKeyDown}>
      <h1 className="sr-only">Activity map</h1>
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
          ariaLabel="Map of Australia showing the areas where people are active and the shops they spend at, by category. The hotspots list beside it gives the busiest areas as text."
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
          detailOpen={sel !== null}
        >
          <HeadlineStrip tiles={tiles} label="Headline figures" busy={hotQ.loading} />

          <div className="pd-toolbar pd-toolbar-chips">
            <div className="pd-chips" role="group" aria-label="Merchant dots by category. Press to show or hide.">
              {meta.categories.map((c) => {
                const blocked = teen && c.sensitive;
                const on = !offSet.has(c.id) && !blocked;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`pd-chip gm-cat-${c.id}${on ? " on" : ""}`}
                    aria-pressed={on}
                    disabled={blocked}
                    title={blocked ? "Not offered for ages 13–17" : undefined}
                    onClick={() => toggleCategory(c.id)}
                  >
                    <i className="pd-dotc" aria-hidden="true" />
                    <span>{c.name}</span>
                    <span className="pd-chip-n">{blocked ? "–" : fmtInt(inViewByCategory.get(c.id) ?? 0)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {shown && ui.heat ? (
            <MapLegend
              title="People active in an area"
              legend={shown.legend}
              kind="heat"
              brandClass="gm-b-all"
              note={
                shown.truncated
                  ? "Showing the busiest areas only. Zoom in to see the rest."
                  : "Built from area totals. A dot is a shop's location, never a person's."
              }
            />
          ) : null}

          <div
            className="pd-dock"
            data-open={sheetOpen ? "true" : "false"}
            data-tab={sheetTab}
            data-sel={sel ? "true" : "false"}
            data-occ-c="bottom"
          >
            <TimeBar
              months={meta.months}
              value={ui.month}
              reducedMotion={reduced}
              caption="Activity in"
              onChange={(m) => change({ month: m })}
              onPrefetch={prefetch}
            />

            <TabStrip
              className="pd-sheet-tabs"
              label="Panels"
              active={sheetTab}
              tabs={[
                { id: "areas", label: "Hotspots" },
                { id: "detail", label: sel && areaBody ? areaBody.area.name : selMerchant ? selMerchant.name : "Detail" },
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

            <aside className="pd-left pd-panel" aria-label="Hotspots and merchants" data-occ-d="left">
              <header className="pd-phead">
                <h2 className="pd-title">Activity map</h2>
                <button
                  type="button"
                  className="pd-ftoggle"
                  aria-expanded={filtersOpen}
                  aria-controls="pd-filters"
                  onClick={() => setFiltersOpen((o) => !o)}
                >
                  <span>{filtersOpen ? "Hide filters" : "Filters"}</span>
                  <span className="muted small pd-fsum">{summary}</span>
                </button>
                <div id="pd-filters" className={`pd-filters${filtersOpen ? " open" : ""}`}>
                  <Select
                    label="Category"
                    value={ui.category}
                    options={[
                      { value: "all", label: "All categories" },
                      ...meta.categories.map((c) => ({
                        value: c.id,
                        label: teen && c.sensitive ? `${c.name} (not offered for 13–17)` : c.name,
                        disabled: teen && c.sensitive,
                      })),
                    ]}
                    onChange={(v) => change({ category: v })}
                  />
                  <Select
                    label="Age band"
                    value={ui.ageBand}
                    options={[
                      { value: "all", label: "All ages" },
                      ...meta.ageBands.map((a) => ({ value: a, label: isTeenBand(a, meta) ? `${a} (teens)` : a })),
                    ]}
                    onChange={(v) =>
                      change({
                        ageBand: v,
                        // The API refuses a sensitive category for teens, so go back to all categories.
                        category: isTeenBand(v, meta) && isSensitive(ui.category, meta) ? "all" : ui.category,
                      })
                    }
                  />
                  <label className="pd-check">
                    <input type="checkbox" checked={ui.heat} onChange={(e) => change({ heat: e.target.checked })} />
                    <span>Show the activity heat</span>
                  </label>
                  {lockedBrandName ? (
                    <p className="xs muted pd-lock">Your role shows people who also use {lockedBrandName}.</p>
                  ) : null}
                  {teen ? (
                    <p className="note pd-teen">
                      Teen figures cover groups of 20 or more teens, so smaller groups show as &quot;&lt;20&quot;. Sensitive
                      categories, such as pharmacy and health, are not offered for ages 13&ndash;17.
                    </p>
                  ) : null}
                </div>
              </header>
              <div className="pd-lhead">
                <SearchBox value={search} onChange={setSearch} label="Search the list by name" placeholder="Search by name" />
                <TabStrip
                  label="List"
                  active={listTab}
                  controls="pd-list"
                  tabs={[
                    { id: "hotspots", label: "Hotspots" },
                    { id: "merchants", label: "Merchants" },
                  ]}
                  onChange={(id) => setListTab(id as "hotspots" | "merchants")}
                />
                <p className="pd-count xs muted">
                  {listTab === "hotspots"
                    ? `Busiest areas on screen · ${monthText}`
                    : `${fmtInt(merchantsOnScreen)} merchants on screen · receipts scanned`}
                </p>
              </div>
              <div className="pd-list" id="pd-list" role="tabpanel">
                <RankedList
                  rows={listRows}
                  selectedId={sel}
                  onPick={onPick}
                  label={listTab === "hotspots" ? "Hotspots, busiest first" : "Merchants, most receipts first"}
                  empty={empty}
                />
              </div>
            </aside>

            <aside className="pd-right pd-panel" aria-label="Selected merchant or area" data-occ-d="right">
              {selMerchant ? (
                <div className="pd-detail" aria-live="polite">
                  <header className="pd-dhead">
                    <div>
                      <p className="pd-kicker">Merchant</p>
                      <h2 className="pd-dname">{selMerchant.name}</h2>
                      <p className="pd-crumbs">
                        <span>{categoryName.get(selMerchant.category) ?? selMerchant.category}</span>
                      </p>
                    </div>
                    <button type="button" className="pd-x" aria-label="Close the detail" onClick={() => select(null)}>
                      <IconClose />
                    </button>
                  </header>
                  <div className="pd-figure">
                    <div className="pd-bignum">
                      <Num n={{ value: selMerchant.value, display: selMerchant.display, suppressed: selMerchant.suppressed }} />
                    </div>
                    <p className="pd-unit">receipts scanned, {monthText}</p>
                  </div>
                  <p className="note">
                    This dot is the shop&apos;s address from its receipts. It says nothing about where any person lives or
                    is.
                  </p>
                </div>
              ) : selHeatId ? (
                <ActivityDetail
                  body={areaBody}
                  loading={areaQ.loading}
                  error={areaQ.error}
                  month={ui.month}
                  ageBand={ui.ageBand}
                  teen={teen}
                  seesExact={seesExact}
                  categoryName={categoryName}
                  onClose={() => select(null)}
                  onMerchant={(m) => {
                    select(m.id);
                    handleRef.current?.flyTo(m.lon, m.lat, MERCHANT_ZOOM);
                  }}
                />
              ) : sel ? (
                <div className="pd-pad">
                  <p className="small muted">That merchant is not in the current results.</p>
                  <button type="button" className="pd-btn" onClick={() => select(null)}>
                    Close
                  </button>
                </div>
              ) : (
                <div className="pd-pad">
                  <p className="small muted">Choose an area or a shop on the map, or a hotspot in the list, to see its detail.</p>
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
