"use client";

/**
 * Small pieces both map screens share: the legend, the month control (slider, Play/Pause, step buttons) and the
 * phone sheet that holds the controls. Colours reach the swatches as CSS custom properties set through the CSSOM
 * (this code only ever runs in the browser, so no style attribute is sent from the server).
 */
import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { monthLong } from "@/lib/format";
import type { LegendBreak } from "@/server/data";
import { fillPct, heatAlpha } from "./colors";
import { useLatest } from "./hooks";

type SwatchStyle = CSSProperties & { "--fp"?: string; "--al"?: string; "--cc"?: string };

/* ---------------- legend ---------------- */

export function Legend({
  title,
  legend,
  mode,
  brandClass,
  noneLabel,
  note,
}: {
  title: string;
  legend: readonly LegendBreak[];
  /** "scale" runs from the base colour to the brand colour; "heat" is the activity-area opacity ramp. */
  mode: "scale" | "heat";
  brandClass: string;
  /** The label for blank land, when the map has some. */
  noneLabel?: string;
  note?: ReactNode;
}) {
  const n = legend.length;
  return (
    <div className={`gm-legend ${brandClass}`} role="group" aria-label={`Legend: ${title}`}>
      <span className="gm-lt">{title}</span>
      {legend.map((b) => {
        const style: SwatchStyle =
          mode === "scale" ? { "--fp": `${fillPct(b.band, n)}%` } : { "--al": String(heatAlpha(b.band, n)) };
        const cls = mode === "scale" ? `gm-sw${b.band === 0 ? " gm-sw-low" : ""}` : "gm-sw gm-sw-heat";
        return (
          <span className="gm-lb" key={b.band}>
            <i className={cls} style={style} aria-hidden="true" />
            {b.label}
          </span>
        );
      })}
      {noneLabel ? (
        <span className="gm-lb">
          <i className="gm-sw gm-sw-none" aria-hidden="true" />
          {noneLabel}
        </span>
      ) : null}
      {note ? <span className="gm-lnote small muted">{note}</span> : null}
    </div>
  );
}

/* ---------------- the month control ---------------- */

/** Month slider with Play and Pause and previous and next buttons. Reduced motion: no autoplay, stepping only. */
export function MonthControl({
  months,
  value,
  onChange,
  onPrefetch,
  reducedMotion,
  prefix = "Registered up to",
}: {
  months: readonly string[];
  value: string;
  onChange: (month: string) => void;
  onPrefetch?: (month: string) => void;
  reducedMotion: boolean;
  /** The label before the month name. */
  prefix?: string;
}) {
  const id = useId();
  const [wantPlay, setWantPlay] = useState(false);
  const idx = Math.max(0, months.indexOf(value));
  const last = months.length - 1;
  // Reduced motion: no autoplay, stepping only.
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

  return (
    <div className="ctl gm-month">
      <label htmlFor={id}>
        {prefix} <b className="gm-monthlabel">{monthLong(value)}</b>
      </label>
      <div className="gm-monthrow">
        <button
          type="button"
          className="btn sm"
          onClick={togglePlay}
          disabled={reducedMotion}
          aria-label={playing ? "Pause the months" : "Play through the months"}
          title={reducedMotion ? "Playing is off because your device asks for less motion. Use the arrows." : undefined}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="btn sm" onClick={() => step(-1)} disabled={idx === 0} aria-label="Previous month">
          ‹
        </button>
        <input
          id={id}
          type="range"
          min={0}
          max={last}
          step={1}
          value={idx}
          aria-valuetext={monthLong(value)}
          onChange={(e) => {
            setWantPlay(false);
            const m = months[Number(e.target.value)];
            if (m) onChange(m);
          }}
        />
        <button type="button" className="btn sm" onClick={() => step(1)} disabled={idx === last} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="gm-monthends xs faint" aria-hidden="true">
        <span>{monthLong(months[0]!)}</span>
        <span>{monthLong(months[last]!)}</span>
      </div>
    </div>
  );
}

/* ---------------- the phone sheet ---------------- */

/**
 * The controls. On a wide screen they sit in a grid above the map. On a phone they fold into a panel behind a
 * button, so the map keeps the screen.
 */
export function ControlSheet({ summary, children }: { summary: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="gm-ctlwrap">
      <button
        type="button"
        className="btn gm-ctltoggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{open ? "Hide filters" : "Filters"}</span>
        <span className="muted small gm-ctlsummary">{summary}</span>
      </button>
      <div id={id} className={`gm-ctl${open ? " open" : ""}`}>
        {children}
      </div>
    </div>
  );
}
