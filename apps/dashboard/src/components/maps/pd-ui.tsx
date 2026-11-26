"use client";

/**
 * The pieces both map pages share: the headline strip, the ranked list and its search, the time-lapse bar, the legend,
 * and the tab strip of the phone sheet. Colours reach the swatches as CSS custom properties set through the CSSOM
 * (this code only ever runs in the browser, so no style attribute is sent from the server).
 */
import { useEffect, useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { RowSpark } from "@/components/charts/RowSpark";
import { monthLong } from "@/lib/format";
import type { LegendBreak } from "@/server/data";
import { fillPct, heatAlpha } from "./colors";
import { useLatest } from "./hooks";
import { bandValue, bubbleRadius } from "./pd-lib";

/* ---------------- icons: one set, 16 px, 1.5 stroke ---------------- */

function Ico({ children }: { children: ReactNode }) {
  return (
    <svg className="pd-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {children}
    </svg>
  );
}
export const IconPlay = () => (
  <Ico>
    <path d="M5 3.2v9.6L12.6 8z" className="pd-ico-fill" />
  </Ico>
);
export const IconPause = () => (
  <Ico>
    <path d="M5 3.5v9M11 3.5v9" />
  </Ico>
);
export const IconPrev = () => (
  <Ico>
    <path d="M9.8 3.5 5.3 8l4.5 4.5" />
  </Ico>
);
export const IconNext = () => (
  <Ico>
    <path d="M6.2 3.5 10.7 8l-4.5 4.5" />
  </Ico>
);
export const IconClose = () => (
  <Ico>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Ico>
);
export const IconSearch = () => (
  <Ico>
    <circle cx="7" cy="7" r="4" />
    <path d="m10 10 3.2 3.2" />
  </Ico>
);

/* ---------------- headline strip ---------------- */

export interface Tile {
  key: string;
  label: string;
  value: ReactNode;
  /** The line under the value: what it is measured against. */
  sub?: ReactNode;
  tone?: "up" | "down" | "plain";
}

/** Five numbers across the top of the map. On a phone the row scrolls sideways inside its own box. */
export function HeadlineStrip({ tiles, label, busy }: { tiles: Tile[]; label: string; busy?: boolean }) {
  return (
    <section className="pd-head" aria-label={label} aria-busy={busy} data-occ-d="top" data-occ-c="top">
      <ul>
        {tiles.map((t) => (
          <li key={t.key} className="pd-tile">
            <span className="pd-tile-l">{t.label}</span>
            <span className="pd-tile-v">{t.value}</span>
            {t.sub ? <span className={`pd-tile-s${t.tone && t.tone !== "plain" ? ` ${t.tone}` : ""}`}>{t.sub}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- search and tabs ---------------- */

export function SearchBox({
  value,
  onChange,
  label,
  placeholder = "Search by name",
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="pd-search">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <IconSearch />
      <input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export interface TabItem {
  id: string;
  label: string;
}

/** A tab strip with arrow-key navigation. `controls` is the id of the panel the tabs switch. */
export function TabStrip({
  tabs,
  active,
  onChange,
  label,
  controls,
  className = "pd-tabs2",
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  label: string;
  controls?: string;
  className?: string;
}) {
  const base = useId();
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    if (next) {
      onChange(next.id);
      document.getElementById(`${base}-${next.id}`)?.focus();
    }
  };
  return (
    <div className={className} role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          id={`${base}-${t.id}`}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          aria-controls={controls}
          tabIndex={active === t.id ? 0 : -1}
          className={active === t.id ? "on" : undefined}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- the ranked list ---------------- */

export interface ListRow {
  id: string;
  name: string;
  /** Where it is: "Greater Sydney, NSW". */
  parent: string;
  /** The main figure at the right. */
  primary: string;
  /** The line under it: the change. */
  secondary?: string;
  secondaryTone?: "up" | "plain";
  /** Between the name and the figure: a sparkline or a small mix strip. */
  visual?: ReactNode;
  centroid: [number, number];
  /** Spoken in full, for the title and the accessible name. */
  title?: string;
}

/**
 * The ranked list. It is also the text alternative to the map: every figure on the map is here, in order, as plain text,
 * and each row is a real button that selects the area.
 */
export function RankedList({
  rows,
  selectedId,
  onPick,
  label,
  id,
  empty,
  offset = 0,
}: {
  rows: ListRow[];
  selectedId: string | null;
  onPick: (row: ListRow) => void;
  label: string;
  id?: string;
  empty: ReactNode;
  /** Added to the rank shown (not used while a search is active). */
  offset?: number;
}) {
  if (rows.length === 0) {
    return (
      <div className="pd-empty" id={id}>
        {empty}
      </div>
    );
  }
  return (
    <ol className="pd-rows" aria-label={label} id={id}>
      {rows.map((r, i) => (
        <li key={r.id}>
          <button
            type="button"
            className="pd-row"
            aria-pressed={r.id === selectedId}
            title={r.title}
            onClick={() => onPick(r)}
          >
            <span className="pd-rank">{i + 1 + offset}</span>
            <span className="pd-rowname">
              <b>{r.name}</b>
              <span>{r.parent}</span>
            </span>
            <span className="pd-rowviz">{r.visual}</span>
            <span className="pd-rowval">
              <b>{r.primary}</b>
              {r.secondary ? <span className={r.secondaryTone === "up" ? "up" : undefined}>{r.secondary}</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** A list row's sparkline in the colours the list uses: quiet, and the accent on the selected row. */
export function rowSpark(trend: readonly number[]): ReactNode {
  return <RowSpark values={trend} color="var(--muted)" />;
}

/* ---------------- the time-lapse bar ---------------- */

type RangeStyle = CSSProperties & { "--p"?: string };

/**
 * A big month label, Play and Pause, and a scrubber with a tick for every month. Reduced motion: no autoplay, so Play
 * is off and the arrows step one month at a time.
 */
export function TimeBar({
  months,
  value,
  onChange,
  onPrefetch,
  reducedMotion,
  caption,
}: {
  months: readonly string[];
  value: string;
  onChange: (month: string) => void;
  onPrefetch?: (month: string) => void;
  reducedMotion: boolean;
  /** The small line above the month: "Registered up to". */
  caption: string;
}) {
  const id = useId();
  const [wantPlay, setWantPlay] = useState(false);
  const idx = Math.max(0, months.indexOf(value));
  const last = months.length - 1;
  const playing = wantPlay && !reducedMotion;
  const idxRef = useLatest(idx);
  const changeRef = useLatest(onChange);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const i = idxRef.current;
      if (i >= last) {
        setWantPlay(false);
        return;
      }
      changeRef.current(months[i + 1]!);
    }, 1000);
    return () => clearInterval(t);
  }, [playing, last, months, idxRef, changeRef]);

  useEffect(() => {
    if (playing && idx < last) onPrefetch?.(months[idx + 1]!);
  }, [playing, idx, last, months, onPrefetch]);

  const step = (d: number) => {
    setWantPlay(false);
    const next = months[Math.min(last, Math.max(0, idx + d))];
    if (next) onChange(next);
  };
  const togglePlay = () => {
    if (playing) {
      setWantPlay(false);
      return;
    }
    if (idx >= last) onChange(months[0]!);
    setWantPlay(true);
  };

  const pct = last > 0 ? (idx / last) * 100 : 0;
  const rangeStyle: RangeStyle = { "--p": `${pct}%` };

  return (
    <section className="pd-time" aria-label="Time-lapse" data-occ-d="bottom">
      <button
        type="button"
        className="pd-play"
        onClick={togglePlay}
        disabled={reducedMotion}
        aria-label={playing ? "Pause the time-lapse" : "Play the time-lapse"}
        aria-describedby={reducedMotion ? `${id}-rm` : undefined}
        title={reducedMotion ? "Playing is off because your device asks for less motion. Use the arrows." : undefined}
      >
        {playing ? <IconPause /> : <IconPlay />}
      </button>
      {reducedMotion ? (
        <span id={`${id}-rm`} className="sr-only">
          Playing is off because your device asks for less motion. Use the arrows to step through the months.
        </span>
      ) : null}
      <div className="pd-month">
        <span className="pd-month-cap">{caption}</span>
        <span className="pd-month-big" aria-live="polite">
          {monthLong(value)}
        </span>
      </div>
      <div className="pd-scrub">
        <input
          id={id}
          type="range"
          min={0}
          max={last}
          step={1}
          value={idx}
          style={rangeStyle}
          aria-label="Month"
          aria-valuetext={monthLong(value)}
          onChange={(e) => {
            setWantPlay(false);
            const m = months[Number(e.target.value)];
            if (m) onChange(m);
          }}
        />
        <div className="pd-ticks" aria-hidden="true">
          {months.map((m) => (
            <i key={m} className={m.endsWith("-01") ? "yr" : undefined} />
          ))}
        </div>
        <div className="pd-ends xs" aria-hidden="true">
          <span>{monthLong(months[0]!)}</span>
          <span>{monthLong(months[last]!)}</span>
        </div>
      </div>
      <div className="pd-step">
        <button type="button" onClick={() => step(-1)} disabled={idx === 0} aria-label="Previous month">
          <IconPrev />
        </button>
        <button type="button" onClick={() => step(1)} disabled={idx === last} aria-label="Next month">
          <IconNext />
        </button>
      </div>
    </section>
  );
}

/* ---------------- legend ---------------- */

type SwatchStyle = CSSProperties & { "--fp"?: string; "--al"?: string };

/**
 * The legend, from the API's own bands, always starting at the lowest ("<10"). Bubbles draw each band as a circle of the
 * size it has on the map; shaded areas and hexagons draw the colour step; the heat layer draws its opacity step.
 */
export function MapLegend({
  title,
  legend,
  kind,
  brandClass,
  noneLabel,
  note,
  bubble,
}: {
  title: string;
  legend: readonly LegendBreak[];
  kind: "bubbles" | "scale" | "heat";
  brandClass: string;
  /** The label for blank land, when the map has some. */
  noneLabel?: string;
  note?: ReactNode;
  /** Bubbles only: the value that gets the biggest circle, and that circle's size in pixels. */
  bubble?: { ref: number; maxPx: number };
}) {
  const n = legend.length;
  return (
    <section className={`pd-legend ${brandClass}`} aria-label={`Legend: ${title}`}>
      <h3 className="pd-legend-t">{title}</h3>
      <ul className={kind === "bubbles" ? "pd-legend-b" : "pd-legend-s"}>
        {legend.map((b) => {
          if (kind === "bubbles" && bubble) {
            const r = bubbleRadius(bandValue(b), bubble.ref, bubble.maxPx);
            const hollow = b.band === 0;
            const rr = hollow ? 3 : Math.max(3, r);
            const size = Math.ceil(rr * 2 + 2);
            return (
              <li key={b.band}>
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
                  <circle className={hollow ? "pd-lg-ring" : "pd-lg-dot"} cx={size / 2} cy={size / 2} r={rr} />
                </svg>
                <span>{b.label}</span>
              </li>
            );
          }
          const style: SwatchStyle =
            kind === "scale" ? { "--fp": `${fillPct(b.band, n)}%` } : { "--al": String(heatAlpha(b.band, n)) };
          const cls = kind === "scale" ? `pd-sw${b.band === 0 ? " low" : ""}` : "pd-sw heat";
          return (
            <li key={b.band}>
              <i className={cls} style={style} aria-hidden="true" />
              <span>{b.label}</span>
            </li>
          );
        })}
        {noneLabel ? (
          <li>
            <i className="pd-sw none" aria-hidden="true" />
            <span>{noneLabel}</span>
          </li>
        ) : null}
      </ul>
      {note ? <p className="pd-legend-n">{note}</p> : null}
    </section>
  );
}

/* ---------------- perf line ---------------- */

/** With ?perf=1 the page prints its request counts, for measuring pans. Nothing is shown otherwise. */
export function PerfLine({ stats }: { stats: { requests: number; aborted: number; hits: number; urls: string[] } }) {
  const [on] = useState(() => new URLSearchParams(window.location.search).has("perf"));
  if (!on) return null;
  return (
    <p className="pd-perf xs" data-perf>
      requests {stats.requests}, aborted {stats.aborted}, cache hits {stats.hits}
      {stats.urls.map((u) => (
        <span key={u}>
          <br />
          {u.replace("/api/map/", "")}
        </span>
      ))}
    </p>
  );
}
