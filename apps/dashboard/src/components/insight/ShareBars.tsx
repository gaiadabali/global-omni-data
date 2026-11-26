import { BarChart } from "@/components/charts";
import { shareRows } from "@/lib/pnum";
import type { PNum } from "@/server/privacy";

export type ShareRowsIn = { label: string; value: PNum }[];

/** Horizontal bars of parts of a whole, as shares. A hidden count draws no bar and prints "<10" or "<20". */
export function ShareBars({
  title,
  description,
  rows,
  whole,
  color = "var(--acc)",
  digits = 0,
}: {
  title: string;
  description: string;
  rows: ShareRowsIn;
  whole: PNum;
  color?: string;
  digits?: number;
}) {
  const s = shareRows(rows, whole, digits);
  return (
    <BarChart
      title={title}
      description={description}
      orientation="horizontal"
      labels={s.labels}
      valueLabels={s.valueLabels}
      series={[{ id: "share", name: "Share of the audience", color, values: s.values }]}
      tooltipFormat="int"
    />
  );
}

