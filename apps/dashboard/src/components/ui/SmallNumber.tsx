import type { PNum } from "@/server/privacy";

/**
 * The "small number" marker. Owner and Data team see the exact value of a count under its threshold; this marks
 * it so nobody copies it into a report by mistake. Other roles see "<10" or "<20" and no marker.
 */
export function SmallNumberMarker() {
  return (
    <span
      className="smallnum"
      title="Under the reporting threshold. Shown in full for your role only. Do not share or export it."
    >
      small number
    </span>
  );
}

/** A count ready to print: its display text, plus the marker when the viewer sees a small exact number. */
export function Num({ n }: { n: PNum }) {
  const exactSmall = n.suppressed && !n.display.startsWith("<");
  return (
    <>
      {n.display}
      {exactSmall ? <SmallNumberMarker /> : null}
    </>
  );
}
