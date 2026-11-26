import { area, line } from "d3-shape";

/**
 * A tiny trend line for a stat tile. No axes, no labels: it is decoration for the number beside it, so it is
 * hidden from assistive technology. Colours come from theme tokens, for example color="var(--yt)".
 * Pass about 12 points; a flat series draws a flat line.
 */
export function Sparkline({ values, color = "var(--acc)" }: { values: number[]; color?: string }) {
  const n = values.length;
  if (n < 2) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  const pts = values.map((v, i): [number, number] => [(i / (n - 1)) * 100, 26 - ((v - lo) / span) * 22]);
  const stroke = line()(pts) ?? "";
  const fill = area<[number, number]>().x((p) => p[0]).y0(28).y1((p) => p[1])(pts) ?? "";
  return (
    <svg className="sp" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <path d={fill} fill={color} opacity={0.12} />
      <path
        d={stroke}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
