"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Loading, Segmented } from "@/components/ui";
import { fmtDate } from "@/lib/dates";
import {
  KIND_LABEL,
  areaKey,
  areaLine,
  categoryLine,
  defaultView,
  hasFarOutliers,
  mapAltText,
  outlierKey,
  outlierPlace,
  suburbsLine,
  type ActivityView,
  type PersonActivity,
} from "./activity-model";
import type { MapFocus } from "./PersonMap";
import "./activity.css";

/**
 * The WebGL bundle (MapLibre, deck.gl) loads here, in the browser, and only when a profile with receipts is open.
 * `ssr: false` has to sit in a client component, which is why the map is imported from this one.
 */
const PersonMap = dynamic(() => import("./PersonMap"), {
  ssr: false,
  loading: () => (
    <div className="pa-skeleton">
      <Loading>Loading the map</Loading>
    </div>
  ),
});

function Legend() {
  return (
    <ul className="pa-legend" aria-label="Map legend">
      {(["home", "work", "weekend"] as const).map((k) => (
        <li key={k}>
          <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
            <rect x="1" y="1" width="20" height="12" rx="3" className={`pa-sw pa-sw-${k}`} />
          </svg>
          {k === "home" ? "Home" : k === "work" ? "Work" : "Weekend"}
        </li>
      ))}
      <li>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" className="pa-sw pa-sw-outlier" />
        </svg>
        Outlier
      </li>
      <li>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="4" className="pa-sw-dot" />
        </svg>
        Receipts, at suburb level
      </li>
    </ul>
  );
}

/** Outliers that fall outside the box round the areas (with a margin): not on screen in the "Activity areas" view. */
function outsideAreas(a: PersonActivity): number {
  const b = a.view.areas;
  const px = Math.max(0.05, (b.east - b.west) * 0.3);
  const py = Math.max(0.05, (b.north - b.south) * 0.3);
  return a.outliers.filter((o) => o.lon < b.west - px || o.lon > b.east + px || o.lat < b.south - py || o.lat > b.north + py).length;
}

/**
 * Person 360, "Receipts and activity areas": the map, a legend, and two lists (areas, outliers). A row highlights
 * its feature on the map and the other way round. Suburb precision only: nothing here knows a street.
 */
export function PersonActivityPanel({ activity, initialView, initialSelected }: { activity: PersonActivity; initialView?: ActivityView; initialSelected?: string }) {
  const [view, setView] = useState<ActivityView>(() => initialView ?? defaultView(activity));
  const [fitN, setFitN] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialSelected ?? null);
  const [focus, setFocus] = useState<MapFocus | null>(null);

  const far = hasFarOutliers(activity);
  const hidden = view === "areas" ? outsideAreas(activity) : 0;
  const choose = (key: string) => {
    setSelected((s) => (s === key ? null : key));
    setFocus((f) => ({ key, n: (f?.n ?? 0) + 1 }));
  };
  const showAll = () => {
    setView("all");
    setFitN((n) => n + 1);
  };

  const nAreas = activity.areas.length;
  const nOut = activity.outliers.length;

  return (
    <div className="pa">
      <div className="pa-bar">
        <p className="small muted">
          Last {activity.days} days · {activity.totalReceipts.display} {activity.totalReceipts.value === 1 ? "receipt" : "receipts"} ·{" "}
          {nAreas} {nAreas === 1 ? "area" : "areas"} · {nOut} {nOut === 1 ? "outlier" : "outliers"}
        </p>
        {far ? (
          <Segmented
            label="Map view"
            value={view}
            onChange={(v) => {
              setView(v as ActivityView);
              setFitN((n) => n + 1);
            }}
            options={[
              { value: "areas", label: "Activity areas" },
              { value: "all", label: "All, with outliers" },
            ]}
          />
        ) : null}
      </div>

      <div className="pa-grid">
        <div className="pa-mapcol">
          <PersonMap
            activity={activity}
            view={view}
            fitN={fitN}
            hover={hover}
            selected={selected}
            focus={focus}
            ariaLabel={mapAltText(activity)}
            onHover={setHover}
            onSelect={(k) => {
              setSelected(k);
            }}
          />
          <Legend />
          {hidden > 0 ? (
            <p className="pa-hint small muted">
              {hidden} {hidden === 1 ? "outlier is" : "outliers are"} outside this view.{" "}
              <button type="button" className="pa-link" onClick={showAll}>
                Show all
              </button>
            </p>
          ) : null}
        </div>

        <div className="pa-side">
          <section aria-labelledby="pa-areas-h">
            <h3 id="pa-areas-h">
              Activity areas <span>{nAreas}</span>
            </h3>
            {nAreas ? (
              <ul className="pa-list">
                {activity.areas.map((a) => {
                  const key = areaKey(a.kind);
                  return (
                    <li key={a.kind}>
                      <button
                        type="button"
                        className="pa-row"
                        aria-pressed={selected === key}
                        data-hover={hover === key}
                        onClick={() => choose(key)}
                        onMouseEnter={() => setHover(key)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(key)}
                        onBlur={() => setHover(null)}
                      >
                        <span className="pa-mark" data-kind={a.kind} aria-hidden="true" />
                        <span className="pa-main">
                          <b>{a.label}</b>
                          <span className="pa-kind">
                            {KIND_LABEL[a.kind]}
                            {a.basis === "declared" ? ", from the declared postcode" : ""}
                          </span>
                        </span>
                        <span className="pa-sub">{areaLine(a)}</span>
                        {a.suburbs.length > 1 ? <span className="pa-sub muted">{suburbsLine(a)}</span> : null}
                        {a.categories.length ? <span className="pa-sub muted">Mostly {categoryLine(a)}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="pa-empty small muted">
                No area yet: an area needs at least 5 receipts at 3 or more shops in 90 days.
              </p>
            )}
          </section>

          <section aria-labelledby="pa-out-h">
            <h3 id="pa-out-h">
              Outliers <span>{nOut}</span>
            </h3>
            {nOut ? (
              <ul className="pa-list">
                {activity.outliers.map((o) => {
                  const key = outlierKey(o.id);
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        className="pa-row"
                        aria-pressed={selected === key}
                        data-hover={hover === key}
                        onClick={() => choose(key)}
                        onMouseEnter={() => setHover(key)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(key)}
                        onBlur={() => setHover(null)}
                      >
                        <span className="pa-mark" data-kind="outlier" aria-hidden="true" />
                        <span className="pa-main">
                          <b>{outlierPlace(o)}</b>
                          <span className="pa-kind">{fmtDate(o.date)}</span>
                        </span>
                        <span className="pa-sub">
                          {o.categoryName} · {o.merchant}
                        </span>
                        <span className="pa-sub pa-dist">{o.distanceText}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="pa-empty small muted">No receipts outside the areas.</p>
            )}
          </section>
        </div>
      </div>

      <p className="xs muted">
        Areas are about suburb size: groups of 2 km cells, or the suburb area of a declared home postcode. Dots and outliers sit
        at the cell centre or the suburb, never at a street position. Pharmacy, health and other sensitive categories are not
        shown at person level.
      </p>
    </div>
  );
}
