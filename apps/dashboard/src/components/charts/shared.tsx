"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { fmtAud, fmtCompact, fmtInt, fmtPct } from "@/lib/format";

/**
 * Shared bits for the chart components. Charts follow the dataviz rules: marks computed with d3-scale and
 * d3-shape, drawn as React SVG, colours from theme tokens (never hard-coded), a legend whenever there are two
 * or more series, a hover/focus tooltip, and a visually hidden table so the numbers are never colour-only.
 */

/** Server components pass a name, not a function. */
export type ValueFormat = "int" | "compact" | "aud" | "pct";

export function formatValue(kind: ValueFormat, n: number): string {
  switch (kind) {
    case "int":
      return fmtInt(n);
    case "compact":
      return fmtCompact(n);
    case "aud":
      return fmtAud(n);
    case "pct":
      return fmtPct(n);
  }
}

/** Width of the element in pixels. Starts at `initial` (what the server draws), then follows the element. */
export function useChartWidth(initial = 640): {
  ref: RefObject<HTMLDivElement | null>;
  width: number;
  measured: boolean;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) {
        setWidth(w);
        setMeasured(true);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width, measured };
}

export interface TipRow {
  color: string;
  name: string;
  value: string;
}

/** An SVG tooltip: drawn inside the chart, so it needs no positioned HTML and no inline style. */
export function ChartTooltip({
  x,
  top,
  width,
  bottom,
  title,
  rows,
}: {
  x: number;
  top: number;
  width: number;
  bottom: number;
  title: string;
  rows: TipRow[];
}) {
  const tw = 184;
  const th = 28 + rows.length * 17;
  const left = x + 12 + tw > width - 4 ? Math.max(4, x - 12 - tw) : x + 12;
  const y = Math.min(top, Math.max(0, bottom - th));
  return (
    <g transform={`translate(${left},${y})`} pointerEvents="none">
      <rect className="tip-box" width={tw} height={th} rx={8} />
      <text className="tip-title" x={10} y={18}>
        {title}
      </text>
      {rows.map((r, i) => (
        <g key={r.name} transform={`translate(10,${34 + i * 17})`}>
          <circle cx={4} cy={-4} r={4} fill={r.color} />
          <text className="tip-row" x={14} y={0}>
            {r.name.length > 20 ? `${r.name.slice(0, 19)}…` : r.name}
          </text>
          <text className="tip-val" x={tw - 20} y={0} textAnchor="end">
            {r.value}
          </text>
        </g>
      ))}
    </g>
  );
}

/** The same numbers as a table, for screen readers. */
export function SrTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="sr-only">
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

/** A legend swatch: a dot drawn in SVG, so the colour is a presentation attribute and not a style. */
export function Swatch({ color }: { color: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="5" fill={color} />
    </svg>
  );
}

/** Round a top (data) end, keep the baseline end square. */
export function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Round the right (data) end, keep the left baseline square. */
export function roundedRight(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, h / 2, w));
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}
