const W = 150;
const H = 12;
const SCALE = 320; // an index of 320 fills the bar
const MARK = (100 / SCALE) * W; // where 100 sits

/** The affinity bar: filled to the index, with a black mark at 100 (the average for the area). No inline style. */
export function IndexBar({ index }: { index: number }) {
  const w = Math.max(0, Math.min(W, (index / SCALE) * W));
  return (
    <svg
      className="ixbar"
      width={W}
      height={H + 6}
      viewBox={`0 0 ${W} ${H + 6}`}
      role="img"
      aria-label={`Index ${index}, where 100 is average for the area`}
    >
      <rect x={0} y={3} width={W} height={H} rx={5} fill="var(--panel2)" stroke="var(--line2)" />
      <rect x={0} y={3} width={w} height={H} rx={5} fill={index >= 100 ? "var(--acc)" : "var(--faint)"} />
      <rect x={MARK - 1} y={0} width={2} height={H + 6} fill="var(--ink)" />
    </svg>
  );
}
