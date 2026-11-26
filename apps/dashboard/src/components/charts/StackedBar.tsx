"use client";

import { useId } from "react";
import { fmtInt, fmtPct } from "@/lib/format";
import { SrTable, Swatch, useChartWidth } from "./shared";

export interface Segment {
  label: string;
  value: number;
  /** A theme token, for example "var(--acc)". */
  color: string;
  /** What the legend prints for the value. Defaults to the number with thousands separators. */
  display?: string;
}

const BAR_H = 22; // a tall segmented bar is 28 px at most
const GAP = 2;

/**
 * One whole split into parts, as a single bar. Widths are proportional to the values; a part at zero draws
 * nothing. The legend names every part with its value and share, so the bar itself carries no text. Used for
 * profile completeness (1, 2 or 3 apps) and personal against business workspaces.
 */
export function StackedBar({
  title,
  description,
  segments,
}: {
  title: string;
  description?: string;
  segments: Segment[];
}) {
  const uid = useId();
  const { ref, width, measured } = useChartWidth();
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  const W = Math.max(120, width);
  const live = segments.filter((s) => s.value > 0);
  const usable = W - GAP * Math.max(0, live.length - 1);
  const widths = live.map((s) => Math.max(3, (s.value / total) * usable));
  const starts = widths.map((_, i) => widths.slice(0, i).reduce((a, w) => a + w + GAP, 0));
  const summary = segments.map((s) => `${s.label} ${fmtPct(s.value / total, 1)}`).join(", ");

  return (
    <div className="stack" data-chart="stacked" data-ready={measured ? "1" : "0"}>
      <div className="chartbox" ref={ref}>
        <svg
          width={W}
          height={BAR_H}
          viewBox={`0 0 ${W} ${BAR_H}`}
          role="img"
          aria-labelledby={`${uid}-t ${uid}-d`}
        >
          <title id={`${uid}-t`}>{title}</title>
          <desc id={`${uid}-d`}>{description ? `${description} ${summary}.` : `${summary}.`}</desc>
          {live.map((s, i) => (
            <rect key={s.label} x={starts[i]} y={0} width={widths[i]} height={BAR_H} rx={4} fill={s.color}>
              <title>{`${s.label}: ${s.display ?? fmtInt(s.value)} (${fmtPct(s.value / total, 1)})`}</title>
            </rect>
          ))}
        </svg>
      </div>
      <div className="lgrow small">
        {segments.map((s) => (
          <span className="lg" key={s.label}>
            <Swatch color={s.color} />
            {s.label} <b>{s.display ?? fmtInt(s.value)}</b>
            <span className="muted">{fmtPct(s.value / total, 1)}</span>
          </span>
        ))}
      </div>
      <SrTable
        caption={title}
        head={["Part", "Value", "Share"]}
        rows={segments.map((s) => [s.label, s.display ?? fmtInt(s.value), fmtPct(s.value / total, 1)])}
      />
    </div>
  );
}
