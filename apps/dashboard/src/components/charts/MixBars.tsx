import type { ReactNode } from "react";

export interface MixRow {
  key: string;
  label: string;
  /** What to print at the right: "1,240", "24%", "<10". */
  display: string;
  /** Bar length, 0 to 1. null draws no bar (a count the viewer may not see). */
  frac: number | null;
  /** Smaller text after the label, such as "teens". */
  note?: string;
  /** Extra mark after the value, such as the small-number marker. */
  marker?: ReactNode;
  /** A theme token for this row's bar. Defaults to the chart's colour. */
  color?: string;
}

/**
 * A short list with a thin bar under each row: a share or a comparison, never a second full chart. Rows share one scale
 * (the caller sets `frac`), one colour unless a row names its own, and the numbers are printed, so nothing relies on colour.
 */
export function MixBars({
  rows,
  color = "var(--acc)",
  label,
}: {
  rows: MixRow[];
  color?: string;
  /** The list's accessible name. */
  label: string;
}) {
  return (
    <ul className="pd-mix" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <div className="pd-mix-line">
            <span className="pd-mix-name">
              {r.label}
              {r.note ? <span className="xs muted"> {r.note}</span> : null}
            </span>
            <span className="pd-mix-val">
              {r.display}
              {r.marker}
            </span>
          </div>
          <svg className="pd-mix-bar" width="100%" height="6" aria-hidden="true">
            <rect className="pd-mix-track" x="0" y="0" width="100%" height="6" rx="3" />
            {r.frac !== null && r.frac > 0 ? (
              <rect
                x="0"
                y="0"
                width={`${Math.max(1, Math.min(100, r.frac * 100))}%`}
                height="6"
                rx="3"
                fill={r.color ?? color}
              />
            ) : null}
          </svg>
        </li>
      ))}
    </ul>
  );
}
