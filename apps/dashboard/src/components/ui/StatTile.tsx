import type { ReactNode } from "react";
import type { PNum } from "@/server/privacy";
import { Sparkline } from "@/components/charts/Sparkline";
import { Num } from "./SmallNumber";

function isPNum(v: unknown): v is PNum {
  return typeof v === "object" && v !== null && "display" in v && "suppressed" in v;
}

/**
 * One headline number. `value` is a thresholded count (PNum, printed with the small-number marker when the
 * viewer sees an exact small value) or ready text. `note` is the line under it: a change, a share, a source.
 * `spark` adds a trend line (about 12 points) in the given theme colour.
 */
export function StatTile({
  label,
  value,
  note,
  spark,
  sparkColor,
  className = "",
}: {
  label: string;
  value: PNum | ReactNode;
  note?: ReactNode;
  spark?: number[];
  sparkColor?: string;
  className?: string;
}) {
  return (
    <div className={`card kpi ${className}`.trim()}>
      <div className="l">{label}</div>
      <div className="v">{isPNum(value) ? <Num n={value} /> : value}</div>
      {note ? <div className="n">{note}</div> : null}
      {spark && spark.length > 1 ? <Sparkline values={spark} color={sparkColor} /> : null}
    </div>
  );
}

/** A grid of stat tiles. */
export function StatGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`kpis ${className}`.trim()}>{children}</div>;
}
