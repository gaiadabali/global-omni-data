import type { PersonProfileRaw } from "@/server/data";

const W = 360;
const H = 220;
const PAD = 26;
const KM_PER_DEG = 110.57;

const CATEGORY_NAME: Record<string, string> = {
  fuel: "Fuel",
  groc: "Groceries",
  cafe: "Cafés and takeaway",
  retail: "Retail",
  ent: "Entertainment",
};

/**
 * A small static map of one person's activity areas (circles) and the shops on their receipts (dots). No base
 * map, no WebGL, no script: a schematic drawn as SVG from the coordinates, scaled to fit. Dots are shop
 * locations, never the person's own position. It draws only what the page was given, so a person with no
 * receipts gets their home area alone.
 */
export function AreaMap({ areas, dots }: { areas: PersonProfileRaw["areas"]; dots: PersonProfileRaw["dots"] }) {
  const pts = [...areas.map((a) => ({ lat: a.lat, lon: a.lon, r: a.radiusKm })), ...dots.map((d) => ({ lat: d.lat, lon: d.lon, r: 0 }))];
  if (!pts.length) return null;
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lon0 = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);
  // Kilometres east and north of the centre.
  const toKm = (lat: number, lon: number) => ({ x: (lon - lon0) * cos * 111.32, y: (lat - lat0) * KM_PER_DEG });
  let spanX = 4;
  let spanY = 3;
  for (const p of pts) {
    const k = toKm(p.lat, p.lon);
    spanX = Math.max(spanX, Math.abs(k.x) + p.r);
    spanY = Math.max(spanY, Math.abs(k.y) + p.r);
  }
  const scale = Math.min((W / 2 - PAD) / spanX, (H / 2 - PAD) / spanY);
  const px = (lat: number, lon: number) => {
    const k = toKm(lat, lon);
    return { x: W / 2 + k.x * scale, y: H / 2 - k.y * scale };
  };
  const usedCategories = [...new Set(dots.map((d) => d.category))];

  return (
    <div className="stack">
      <svg className="pmap" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="pmap-t pmap-d">
        <title id="pmap-t">Activity areas and receipt locations</title>
        <desc id="pmap-d">
          A schematic, not to scale for distance. Circles are the areas where this person&apos;s receipts cluster; dots are the
          shops on their receipts.
        </desc>
        <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={10} fill="var(--map-bg)" stroke="var(--line)" />
        {areas.map((a, i) => {
          const c = px(a.lat, a.lon);
          const colour = i === 0 ? "var(--acc)" : i === 1 ? "var(--heat)" : "var(--sa)";
          return (
            <g key={a.label}>
              <title>{a.label}</title>
              <circle
                cx={c.x}
                cy={c.y}
                r={Math.max(8, a.radiusKm * scale)}
                fill={colour}
                fillOpacity={0.14}
                stroke={colour}
                strokeWidth={1.5}
                strokeDasharray={i === 2 ? "4 3" : undefined}
              />
</g>
          );
        })}
        {dots.map((d) => {
          const c = px(d.lat, d.lon);
          return (
            <circle key={`${d.label}-${d.lat}-${d.lon}`} cx={c.x} cy={c.y} r={4.5} fill={`var(--c-${d.category})`} stroke="var(--panel)" strokeWidth={1.5}>
              <title>{d.label}</title>
            </circle>
          );
        })}
      </svg>
      <div className="lgrow small arealegend">
        {usedCategories.map((c) => (
          <span className="lg" key={c}>
            <svg width="10" height="10" aria-hidden="true">
              <circle cx="5" cy="5" r="4.5" fill={`var(--c-${c})`} />
            </svg>
            {CATEGORY_NAME[c] ?? c}
          </span>
        ))}
        {areas.map((a, i) => {
          const colour = i === 0 ? "var(--acc)" : i === 1 ? "var(--heat)" : "var(--sa)";
          return (
            <span className="lg" key={a.label}>
              <svg width="12" height="12" aria-hidden="true">
                <circle cx="6" cy="6" r="5" fill={colour} fillOpacity={0.2} stroke={colour} strokeDasharray={i === 2 ? "2 2" : undefined} />
              </svg>
              {a.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
