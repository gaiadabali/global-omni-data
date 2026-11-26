"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { ChartTooltip, formatValue, SrTable, Swatch, useChartWidth, type ValueFormat } from "./shared";

export interface LineSeries {
  id: string;
  name: string;
  /** A theme token, for example "var(--yt)". */
  color: string;
  values: number[];
  /** Line width in px. Default 2. */
  width?: number;
}

/**
 * A line chart with one or more series. 2px lines, end dots with a surface ring, hairline grid, a legend whenever
 * there are two or more series (click to hide one), a crosshair tooltip on hover or arrow keys, and a hidden table.
 * Give every chart a `title` and a `description` of what it shows: they are its accessible name and summary.
 */
export function LineChart({
  title,
  description,
  labels,
  fullLabels,
  series,
  height = 250,
  format = "compact",
  tooltipFormat = "int",
}: {
  title: string;
  description?: string;
  /** X axis labels, one per point. */
  labels: string[];
  /** Longer labels for the tooltip and the table (defaults to `labels`). */
  fullLabels?: string[];
  series: LineSeries[];
  height?: number;
  /** Axis number format. */
  format?: ValueFormat;
  tooltipFormat?: ValueFormat;
}) {
  const uid = useId();
  const { ref, width, measured } = useChartWidth();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  const n = labels.length;
  const visible = series.filter((s) => !hidden.has(s.id));
  const full = fullLabels ?? labels;

  let top = 1;
  for (const s of visible) for (const v of s.values) if (v > top) top = v;
  const y = scaleLinear().domain([0, top]).nice(4);
  const ticks = y.ticks(4);
  const m = { l: 12 + Math.max(...ticks.map((t) => formatValue(format, t).length)) * 6.4, r: 16, t: 12, b: 26 };
  const W = Math.max(260, width);
  const iw = W - m.l - m.r;
  const H = height;
  y.range([H - m.b, m.t]);
  const x = (i: number) => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const path = line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v));
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 54))));

  const indexAt = (clientX: number, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect();
    const px = (clientX - r.left) * (W / r.width);
    return Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
  };
  const onPointer = (e: PointerEvent<SVGElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (svg) setHover(indexAt(e.clientX, svg));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "Escape") setHover(null);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      setHover((h) => Math.max(0, Math.min(n - 1, (h ?? (delta > 0 ? -1 : n)) + delta)));
    }
  };
  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < series.length - 1) next.add(id);
      return next;
    });

  const titleId = `${uid}-t`;
  const descId = `${uid}-d`;

  return (
    <div className="stack" data-chart="line" data-ready={measured ? "1" : "0"}>
      {series.length > 1 ? (
        <div className="lgrow" role="group" aria-label="Show or hide a series">
          {series.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip${hidden.has(s.id) ? "" : " on"}`}
              aria-pressed={!hidden.has(s.id)}
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
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          <title id={titleId}>{title}</title>
          <desc id={descId}>
            {description ?? `${title}. Use the left and right arrow keys to read each point.`}
          </desc>
          {ticks.map((t, k) => (
            <g key={t}>
              <line className={k === 0 ? "ax" : "gl"} x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />
              <text x={m.l - 7} y={y(t) + 4} textAnchor="end">
                {formatValue(format, t)}
              </text>
            </g>
          ))}
          {labels.map((l, i) =>
            (n - 1 - i) % step === 0 ? (
              <text key={i} x={x(i)} y={H - 7} textAnchor="middle">
                {l}
              </text>
            ) : null,
          )}
          {visible.map((s) => (
            <path
              key={s.id}
              d={path(s.values) ?? ""}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {visible.map((s) => (
            <circle
              key={`${s.id}-end`}
              className="ring"
              cx={x(n - 1)}
              cy={y(s.values[n - 1] ?? 0)}
              r={4}
              fill={s.color}
            />
          ))}
          {hover !== null ? (
            <g>
              <line className="ax" x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} />
              {visible.map((s) => (
                <circle
                  key={`${s.id}-hover`}
                  className="ring"
                  cx={x(hover)}
                  cy={y(s.values[hover] ?? 0)}
                  r={4}
                  fill={s.color}
                />
              ))}
              <ChartTooltip
                x={x(hover)}
                top={m.t}
                bottom={H - m.b}
                width={W}
                title={full[hover] ?? ""}
                rows={visible.map((s) => ({
                  color: s.color,
                  name: s.name,
                  value: formatValue(tooltipFormat, s.values[hover] ?? 0),
                }))}
              />
            </g>
          ) : null}
          <rect
            className="hit"
            x={m.l}
            y={0}
            width={iw}
            height={H}
            fill="transparent"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      </div>
      <SrTable
        caption={title}
        head={["Period", ...series.map((s) => s.name)]}
        rows={full.map((l, i) => [l, ...series.map((s) => formatValue(tooltipFormat, s.values[i] ?? 0))])}
      />
    </div>
  );
}
