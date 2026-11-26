"use client";

import { cellToLatLng } from "h3-js";
import type { PickingInfo } from "@deck.gl/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Callout, Num, Select } from "@/components/ui";
import { fmtInt, monthLong } from "@/lib/format";
import type { ActivityHeatCell, ActivityMerchant, PresentedActivity } from "@/server/data";
import { activityLayers, visibleMerchants } from "./activity-layers";
import { MapCanvas, type MapHandle, type MapViewChange, type TipContent } from "./MapCanvas";
import { ControlSheet, Legend, MonthControl, PerfLine } from "./MapUi";
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
import { planActivity, type ShownActivity } from "./plan";
import { coordName, topBy } from "./top";
import {
  isSensitive,
  isTeenBand,
  serialiseActivityState,
  type ActivityState,
  type MapMetaLike,
} from "./url-state";
import { HEX_WIDTH_KM, inBBox, kmLabel, type H3Resolution } from "./zoom";

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

function pick(info: PickingInfo): { kind: "merchant" | "heat"; id: string } | null {
  if (!info.object) return null;
  if (info.layer?.id === "merchants") return { kind: "merchant", id: (info.object as ActivityMerchant).id };
  if (info.layer?.id === "heat") return { kind: "heat", id: (info.object as ActivityHeatCell).id };
  return null;
}

export default function ActivityMap({ initial, meta, basemapUrl, lockedBrandName, seesExact }: ActivityMapProps) {
  const tokens = useMapTokens();
  const reduced = useReducedMotion();
  const fontReady = useFontReady(LABEL_FONT_SPEC);
  const outlines = useStateOutlines();
  const loader = useMapLoader<PresentedActivity>();
  const handleRef = useRef<MapHandle>(null);
  const panelRef = useRef<HTMLElement>(null);

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
  const queryView = useRef<MapViewChange | null>(null);
  const shownRef = useRef<{ url: string; query: ShownActivity } | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const request = useCallback((u: Ui, v: MapViewChange | null) => {
    if (v) setUrl(planActivity({ category: u.category, ageBand: u.ageBand, month: u.month }, v, shownRef.current));
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
  const layers = useMemo(
    () =>
      tokens
        ? activityLayers({
            states: outlines,
            data: shown,
            tokens,
            off: offSet,
            heat: ui.heat,
            selected: ui.sel,
            hasBasemap: basemapUrl !== null,
            fontReady,
            labels: labelMode,
            lowZoom,
            dotScale,
          })
        : [],
    [tokens, outlines, shown, offSet, ui.heat, ui.sel, basemapUrl, fontReady, labelMode, dotScale, lowZoom],
  );

  const categoryName = useMemo(() => new Map(meta.categories.map((c) => [c.id, c.name])), [meta.categories]);
  const merchants = useMemo(() => visibleMerchants(shown, offSet), [shown, offSet]);
  const merchantById = useMemo(() => new Map((shown?.merchants ?? []).map((m) => [m.id, m])), [shown]);
  const heatById = useMemo(() => new Map((shown?.heat ?? []).map((h) => [h.id, h])), [shown]);
  const heatPos = useMemo(() => {
    const m = new Map<string, [number, number]>();
    if (shown && ui.heat) {
      for (const h of shown.heat) {
        const [lat, lon] = cellToLatLng(h.id);
        m.set(h.id, [lon, lat]);
      }
    }
    return m;
  }, [shown, ui.heat]);

  const box = view?.bbox;
  const topMerchants = useMemo(
    () =>
      topBy(
        merchants,
        (m) => m.value,
        (m) => m.name,
        (m) => !box || inBBox(m.lon, m.lat, box),
        10,
      ),
    [merchants, box],
  );
  const topAreas = useMemo(
    () =>
      ui.heat && shown
        ? topBy(
            shown.heat,
            (h) => h.value,
            (h) => h.id,
            (h) => {
              const p = heatPos.get(h.id);
              return !box || (p ? inBBox(p[0], p[1], box) : false);
            },
            5,
          )
        : [],
    [shown, ui.heat, heatPos, box],
  );
  const onScreen = useMemo(
    () => (box ? merchants.filter((m) => inBBox(m.lon, m.lat, box)).length : merchants.length),
    [merchants, box],
  );

  const selMerchant = ui.sel && isMerchantId(ui.sel) ? merchantById.get(ui.sel) : undefined;
  const selHeat = ui.sel && !isMerchantId(ui.sel) ? heatById.get(ui.sel) : undefined;

  const selHeatPos = selHeat ? heatPos.get(selHeat.id) : undefined;
  const selHeatName = selHeatPos ? coordName(selHeatPos[1], selHeatPos[0]) : "Activity area";

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
      const p = pick(info);
      if (p) select(p.id);
    },
    [select],
  );

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
      const pos = heatPos.get(h.id);
      return { title: pos ? coordName(pos[1], pos[0]) : "Activity area", rows: [["People active", h.display]] };
    },
    [merchantById, heatById, heatPos, categoryName],
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

  const res = shown ? (shown.query.h3 as H3Resolution) : null;
  const levelText = `${fmtInt(merchants.length)} merchant dots${
    ui.heat && res ? ` · activity areas about ${kmLabel(HEX_WIDTH_KM[res])} across` : ""
  }`;
  const shownMonth = shown?.query.month ?? ui.month;
  const shownAge = shown?.query.ageBand;
  const monthText = `${monthLong(shownMonth)}${shownAge ? `, ages ${shownAge}` : ""}`;
  const summary = `${ui.category === "all" ? "All categories" : (categoryName.get(ui.category) ?? ui.category)} · ${ui.ageBand === "all" ? "All ages" : ui.ageBand} · ${monthLong(ui.month)}`;

  return (
    <div className="gm-wrap">
      <ControlSheet summary={summary}>
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
        <MonthControl
          months={meta.months}
          value={ui.month}
          reducedMotion={reduced}
          prefix="Month:"
          onChange={(m) => change({ month: m })}
          onPrefetch={prefetch}
        />
        <div className="ctl">
          <span className="lab">Layers</span>
          <div>
            <label className="chip on gm-layer">
              <input type="checkbox" checked={ui.heat} onChange={(e) => change({ heat: e.target.checked })} />
              Activity areas
            </label>
          </div>
        </div>
      </ControlSheet>
      {lockedBrandName ? (
        <p className="small muted gm-lock">Your role shows people who also use {lockedBrandName}.</p>
      ) : null}
      {teen ? (
        <p className="note gm-teen">
          Teen figures cover groups of 20 or more teens, so smaller groups show as &quot;&lt;20&quot;. Sensitive
          categories, such as pharmacy and health, are not offered for ages 13–17.
        </p>
      ) : null}

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
              ariaLabel="Map of Australia showing shop locations by category and the areas where people are active. The busiest merchants are listed beside it."
              initialView={initial.view}
              layers={layers}
              tokens={tokens}
              dataReady={shown !== null && outlines !== null}
              levelText={levelText}
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

          <div className="gm-legend" role="group" aria-label="Merchant categories. Press to show or hide.">
            <span className="gm-lt">Category</span>
            {meta.categories.map((c) => {
              const blocked = teen && c.sensitive;
              const on = !offSet.has(c.id) && !blocked;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`chip gm-chip gm-cat-${c.id}${on ? " on" : ""}`}
                  aria-pressed={on}
                  disabled={blocked}
                  title={blocked ? "Not offered for ages 13–17" : undefined}
                  onClick={() => toggleCategory(c.id)}
                >
                  <i className="gm-dot" aria-hidden="true" />
                  {c.name}
                  {c.sensitive ? <span className="xs muted"> (sensitive)</span> : null}
                </button>
              );
            })}
          </div>
          {shown && ui.heat ? (
            <Legend
              title="People active in an area"
              legend={shown.legend}
              mode="heat"
              brandClass="gm-b-all"
              note={
                shown.truncated
                  ? "Showing the busiest areas only. Zoom in to see the rest."
                  : "A dot is a shop's location from its receipts, never a person's."
              }
            />
          ) : (
            <p className="small muted">A dot is a shop&apos;s location from its receipts, never a person&apos;s.</p>
          )}
        </div>

        <aside className="gm-panel" ref={panelRef} aria-label="Selected merchant or area, and the busiest merchants">
          {selMerchant ? (
            <div className="gm-sel" aria-live="polite">
              <div>
                <div className="gm-kicker">Merchant</div>
                <h3>{selMerchant.name}</h3>
                <div className="small muted">{categoryName.get(selMerchant.category) ?? selMerchant.category}</div>
              </div>
              <div>
                <div className="gm-big">
                  <Num n={{ value: selMerchant.value, display: selMerchant.display, suppressed: selMerchant.suppressed }} />
                </div>
                <div className="small muted">receipts scanned, {monthText}</div>
              </div>
              <p className="note">
                This dot is the shop&apos;s address from its receipts. It says nothing about where any person lives or
                is.
              </p>
              <button type="button" className="btn sm" onClick={() => select(null)}>
                Close
              </button>
            </div>
          ) : selHeat ? (
            <div className="gm-sel" aria-live="polite">
              <div>
                <div className="gm-kicker">
                  Activity area{res ? `, about ${kmLabel(HEX_WIDTH_KM[res])} across` : ""}
                </div>
                <h3>{selHeatName}</h3>
              </div>
              <div>
                <div className="gm-big">
                  <Num n={{ value: selHeat.value, display: selHeat.display, suppressed: selHeat.suppressed }} />
                </div>
                <div className="small muted">people active in this area, {monthText}</div>
              </div>
              <p className="note">
                {seesExact
                  ? "Small groups are marked as small numbers. Your role sees them in full. Do not share or export them."
                  : `Groups under ${teen ? "20" : "10"} show as "<${teen ? "20" : "10"}".`}{" "}
                An area counts people. It never shows where one person is.
              </p>
              <button type="button" className="btn sm" onClick={() => select(null)}>
                Close
              </button>
            </div>
          ) : ui.sel && shown && !loading ? (
            <div className="gm-sel">
              <p className="small muted">That merchant or area is not in the current results.</p>
              <button type="button" className="btn sm" onClick={() => select(null)}>
                Close
              </button>
            </div>
          ) : null}

          <div className="gm-toplist">
            <div className="gm-kicker">On screen</div>
            <h3>{fmtInt(onScreen)} merchants</h3>
            <div className="small muted">Receipts scanned, {monthText}</div>
            {topMerchants.length ? (
              <ol>
                {topMerchants.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => select(m.id)} aria-pressed={m.id === ui.sel}>
                      <span>{m.name}</span>
                      <b>{m.display}</b>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="small muted">{shown ? "No merchants in this view with these filters." : "Loading the first view."}</p>
            )}
          </div>

          {topAreas.length ? (
            <div className="gm-toplist">
              <div className="gm-kicker">Busiest activity areas on screen</div>
              <ol>
                {topAreas.map((h) => {
                  const p = heatPos.get(h.id);
                  return (
                    <li key={h.id}>
                      <button type="button" onClick={() => select(h.id)} aria-pressed={h.id === ui.sel}>
                        <span>{p ? coordName(p[1], p[0]) : h.id}</span>
                        <b>{h.display}</b>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
          <p className="note">Click a dot or an area on the map, or choose one here, to open its detail.</p>
        </aside>
      </div>
      <PerfLine stats={loader.stats} />
    </div>
  );
}
