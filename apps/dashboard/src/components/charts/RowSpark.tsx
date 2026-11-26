import { line } from "d3-shape";

/**
 * A 12-month trend for a list row: a thin line and an end dot, no axes. Hidden from assistive technology, because the
 * row's text carries the figure. A series of all zeros is a count the viewer may not see, drawn as a dotted baseline.
 */
export function RowSpark({
  values,
  color = "var(--muted)",
  width = 56,
  height = 20,
}: {
  values: readonly number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const n = values.length;
  if (n < 2) return <svg className="pd-spark" width={width} height={height} aria-hidden="true" />;
  const pad = 3;
  if (values.every((v) => v === 0)) {
    return (
      <svg className="pd-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <line
          x1={pad}
          x2={width - pad}
          y1={height - pad}
          y2={height - pad}
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="1.5 3.5"
          strokeLinecap="round"
          opacity={0.7}
        />
      </svg>
    );
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  const px = (i: number) => pad + (i / (n - 1)) * (width - pad * 2);
  const py = (v: number) => height - pad - ((v - lo) / span) * (height - pad * 2);
  const d = line<number>()
    .x((_, i) => px(i))
    .y((v) => py(v))(values as number[]);
  return (
    <svg className="pd-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d ?? ""} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={px(n - 1)} cy={py(values[n - 1] ?? 0)} r={2.5} fill={color} />
    </svg>
  );
}
