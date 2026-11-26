"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import { fmtCompact, fmtInt, monthLong, monthShort } from "@/lib/format";
import { ChartTooltip, SrTable, useChartWidth } from "./shared";

/**
 * One running total over up to 24 months, for a side panel: a 2px line with a soft fill under it, the first, middle and
 * last month on the axis, an end dot, and a crosshair tooltip on hover or the arrow keys. The axis starts at 0, so the
 * slope is honest. A series that is all zero is a count the viewer may not see, and says so instead of drawing a flat line.
 */
export function AreaTrend({
  title,
  description,
  seriesName,
  months,
  values,
  color = "var(--acc)",
  height = 136,
}: {
  title: string;
  description?: string;
  /** What the line counts, for the tooltip: "People and businesses". */
  seriesName: string;
  months: string[];
  values: number[];
  /** A theme token, for example "var(--acc)". */
  color?: string;
  height?: number;
}) {
  const uid = useId();
  const { ref, width, measured } = useChartWidth(300);
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.min(months.length, values.length);
  const hidden = n === 0 || values.slice(0, n).every((v) => v === 0);

  let top = 1;
  for (let i = 0; i < n; i++) top = Math.max(top, values[i] ?? 0);
  const y = scaleLinear().domain([0, top]).nice(2);
  const ticks = y.ticks(2);
  const lab = (v: number) => (v === 0 ? "0" : fmtCompact(v));
  const m = { l: 8 + Math.max(...ticks.map((t) => lab(t).length)) * 6.2, r: 10, t: 10, b: 24 };
  const W = Math.max(240, width);
  const H = height;
  const iw = W - m.l - m.r;
  y.range([H - m.b, m.t]);
  const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const pts = values.slice(0, n);
  const stroke = line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v))(pts);
  const fill = area<number>()
    .x((_, i) => x(i))
    .y0(H - m.b)
    .y1((v) => y(v))(pts);
  const mid = Math.floor((n - 1) / 2);
  const xLabels: { i: number; anchor: "start" | "middle" | "end" }[] =
    n >= 3
      ? [
          { i: 0, anchor: "start" },
          { i: mid, anchor: "middle" },
          { i: n - 1, anchor: "end" },
        ]
      : n === 2
        ? [
            { i: 0, anchor: "start" },
            { i: 1, anchor: "end" },
          ]
        : [];
  const short = (i: number) => `${monthShort(months[i] ?? "")} ${(months[i] ?? "").slice(2, 4)}`;

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
      const d = e.key === "ArrowRight" ? 1 : -1;
      setHover((h) => Math.max(0, Math.min(n - 1, (h ?? (d > 0 ? -1 : n)) + d)));
    }
  };

  const titleId = `${uid}-t`;
  const descId = `${uid}-d`;

  if (hidden) {
    return (
      <div className="pd-trend-hidden" data-chart="area" data-ready="1">
        <p className="small muted">The trend is hidden while the count is under the reporting threshold.</p>
      </div>
    );
  }

  return (
    <div data-chart="area" data-ready={measured ? "1" : "0"}>
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
          <desc id={descId}>{description ?? `${title}. Use the left and right arrow keys to read each month.`}</desc>
          {ticks.map((t, k) => (
            <g key={t}>
              <line className={k === 0 ? "ax" : "gl"} x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />
              <text x={m.l - 6} y={y(t) + 4} textAnchor="end">
                {lab(t)}
              </text>
            </g>
          ))}
          {xLabels.map((l) => (
            <text key={l.i} x={x(l.i)} y={H - 6} textAnchor={l.anchor}>
              {short(l.i)}
            </text>
          ))}
          <path d={fill ?? ""} fill={color} opacity={0.14} />
          <path d={stroke ?? ""} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle className="ring" cx={x(n - 1)} cy={y(pts[n - 1] ?? 0)} r={4} fill={color} />
          {hover !== null ? (
            <g>
              <line className="ax" x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} />
              <circle className="ring" cx={x(hover)} cy={y(pts[hover] ?? 0)} r={4} fill={color} />
              <ChartTooltip
                x={x(hover)}
                top={m.t}
                bottom={H - m.b}
                width={W}
                title={monthLong(months[hover] ?? "")}
                rows={[{ color, name: seriesName, value: fmtInt(pts[hover] ?? 0) }]}
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
        head={["Month", seriesName]}
        rows={pts.map((v, i) => [monthLong(months[i] ?? ""), fmtInt(v)])}
      />
    </div>
  );
}
