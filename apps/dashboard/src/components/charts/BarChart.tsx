"use client";

import { useId, useState } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import { max } from "d3-array";
import {
  ChartTooltip,
  formatValue,
  roundedRight,
  roundedTop,
  SrTable,
  Swatch,
  useChartWidth,
  type ValueFormat,
} from "./shared";

export interface BarSeries {
  id: string;
  name: string;
  /** A theme token, for example "var(--sa)". */
  color: string;
  values: number[];
}

const MAX_BAR = 24; // bars are never thicker than 24 px: the leftover is air
const GAP = 2; // the surface gap between touching bars and stacked segments

/**
 * Bar chart, vertical (columns over time) or horizontal (ranked rows). Bars are at most 24 px thick, with a 4 px
 * rounded data end and a square baseline, a 2 px surface gap between touching marks, a hairline grid, a tooltip,
 * and a hidden table.
 *
 * Vertical: one or more series, grouped or `stacked`. Horizontal: one series; `colors` colours each row and
 * `valueLabels` replaces the printed number (for example "<10" or "A$3.05m").
 */
export function BarChart({
  title,
  description,
  orientation = "vertical",
  labels,
  series,
  stacked = false,
  height,
  format = "compact",
  tooltipFormat = "int",
  colors,
  valueLabels,
}: {
  title: string;
  description?: string;
  orientation?: "vertical" | "horizontal";
  labels: string[];
  series: BarSeries[];
  stacked?: boolean;
  height?: number;
  format?: ValueFormat;
  tooltipFormat?: ValueFormat;
  colors?: string[];
  valueLabels?: string[];
}) {
  const uid = useId();
  const { ref, width, measured } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const [hiddenSeries, setHidden] = useState<ReadonlySet<string>>(new Set());
  const titleId = `${uid}-t`;
  const descId = `${uid}-d`;
  const W = Math.max(260, width);
  const n = labels.length;
  const shown = series.filter((s) => !hiddenSeries.has(s.id));
  const label = (i: number) => labels[i] ?? "";

  const table = (
    <SrTable
      caption={title}
      head={["Item", ...series.map((s) => s.name)]}
      rows={labels.map((l, i) => [
        l,
        ...series.map((s) => valueLabels?.[i] ?? formatValue(tooltipFormat, s.values[i] ?? 0)),
      ])}
    />
  );

  /* ---------- horizontal: ranked rows ---------- */
  if (orientation === "horizontal") {
    const s0 = series[0];
    const values = s0?.values ?? [];
    const rowH = 28;
    const H = n * rowH + 8;
    const labelW = Math.min(190, Math.max(84, Math.round(W * 0.34)));
    const valueW = 70;
    const x0 = labelW + 8;
    const x = scaleLinear()
      .domain([0, max(values) || 1])
      .range([0, Math.max(10, W - x0 - valueW)]);
    const chars = Math.floor(labelW / 6.6);
    return (
      <div className="stack" data-chart="bar-h" data-ready={measured ? "1" : "0"}>
        <div className="chartbox" ref={ref}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${titleId} ${descId}`}>
            <title id={titleId}>{title}</title>
            <desc id={descId}>{description ?? title}</desc>
            <line className="ax" x1={x0} x2={x0} y1={2} y2={H - 2} />
            {labels.map((l, i) => {
              const v = values[i] ?? 0;
              const w = x(v);
              const cy = 4 + i * rowH + rowH / 2;
              const text = valueLabels?.[i] ?? formatValue(tooltipFormat, v);
              return (
                <g key={`${l}-${i}`}>
                  <title>{`${l}: ${text}`}</title>
                  <text className="nm" x={0} y={cy + 4}>
                    {l.length > chars ? `${l.slice(0, Math.max(1, chars - 1))}…` : l}
                  </text>
                  {w > 0 ? (
                    <path d={roundedRight(x0, cy - 7, Math.max(2, w), 14, 4)} fill={colors?.[i] ?? s0?.color ?? "var(--acc)"} />
                  ) : null}
                  <text className="val" x={x0 + Math.max(2, w) + 8} y={cy + 4}>
                    {text}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        {table}
      </div>
    );
  }

  /* ---------- vertical: columns ---------- */
  const H = height ?? 230;
  let top = 1;
  for (let i = 0; i < n; i++) {
    const vals = shown.map((s) => s.values[i] ?? 0);
    const t = stacked ? vals.reduce((a, b) => a + b, 0) : Math.max(0, ...vals);
    if (t > top) top = t;
  }
  const y = scaleLinear().domain([0, top]).nice(4);
  const ticks = y.ticks(4);
  const m = { l: 12 + Math.max(...ticks.map((t) => formatValue(format, t).length)) * 6.4, r: 8, t: 12, b: 26 };
  y.range([H - m.b, m.t]);
  const band = scaleBand<number>()
    .domain(Array.from({ length: n }, (_, i) => i))
    .range([m.l, W - m.r])
    .paddingInner(0.25)
    .paddingOuter(0.1);
  const bw = band.bandwidth();
  const k = stacked ? 1 : Math.max(1, shown.length);
  const barW = Math.min(MAX_BAR, (bw - GAP * (k - 1)) / k);
  const groupW = barW * k + GAP * (k - 1);
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - m.l - m.r) / 40))));
  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < series.length - 1) next.add(id);
      return next;
    });

  return (
    <div className="stack" data-chart="bar-v" data-ready={measured ? "1" : "0"}>
      {series.length > 1 ? (
        <div className="lgrow" role="group" aria-label="Show or hide a series">
          {series.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip${hiddenSeries.has(s.id) ? "" : " on"}`}
              aria-pressed={!hiddenSeries.has(s.id)}
              onClick={() => toggle(s.id)}
            >
              <Swatch color={s.color} />
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="chartbox" ref={ref}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          onPointerLeave={() => setHover(null)}
        >
          <title id={titleId}>{title}</title>
          <desc id={descId}>{description ?? title}</desc>
          {ticks.map((t, j) => (
            <g key={t}>
              <line className={j === 0 ? "ax" : "gl"} x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />
              <text x={m.l - 7} y={y(t) + 4} textAnchor="end">
                {formatValue(format, t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) => {
            const gx = (band(i) ?? 0) + (bw - groupW) / 2;
            let acc = 0;
            return (
              <g key={`${l}-${i}`}>
                {shown.map((s, j) => {
                  const v = s.values[i] ?? 0;
                  let d = "";
                  if (stacked) {
                    const y1 = y(acc + v);
                    const y0 = y(acc);
                    const isTop = shown.slice(j + 1).every((t) => (t.values[i] ?? 0) <= 0);
                    const h = Math.max(0, y0 - y1 - (j > 0 ? GAP : 0));
                    d = h > 0 ? roundedTop(gx, y1, barW, h, isTop ? 4 : 0) : "";
                    acc += v;
                  } else {
                    const h = Math.max(0, y(0) - y(v));
                    d = h > 0 ? roundedTop(gx + j * (barW + GAP), y(v), barW, h, 4) : "";
                  }
                  return d ? <path key={s.id} d={d} fill={s.color} /> : null;
                })}
                {(n - 1 - i) % step === 0 ? (
                  <text x={(band(i) ?? 0) + bw / 2} y={H - 7} textAnchor="middle">
                    {l}
                  </text>
                ) : null}
                <rect
                  x={band(i) ?? 0}
                  y={0}
                  width={bw}
                  height={H - m.b}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                />
              </g>
            );
          })}
          {hover !== null ? (
            <ChartTooltip
              x={(band(hover) ?? 0) + bw / 2}
              top={m.t}
              bottom={H - m.b}
              width={W}
              title={label(hover)}
              rows={shown.map((s) => ({
                color: s.color,
                name: s.name,
                value: formatValue(tooltipFormat, s.values[hover] ?? 0),
              }))}
            />
          ) : null}
        </svg>
      </div>
      {table}
    </div>
  );
}
