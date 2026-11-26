/**
 * Plane geometry on lon/lat rings (flat Float64Array [x0, y0, x1, y1, ...]). No imports and only erasable
 * TypeScript, so the build script can import it as it is. Degrees are treated as flat: at the scale of one area
 * that is accurate enough for point-in-polygon, and these are only used to place labels and sample points.
 */
export type Ring = Float64Array;

/** Signed shoelace area in square degrees: positive when the ring runs counter-clockwise. */
export function ringArea(r: Ring): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += r[2 * j]! * r[2 * i + 1]! - r[2 * i]! * r[2 * j + 1]!;
  }
  return a / 2;
}

export function ringBBox(r: Ring): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const x = r[i]!;
    const y = r[i + 1]!;
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** Ray casting against one ring. */
export function pointInRing(x: number, y: number, r: Ring): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[2 * i]!;
    const yi = r[2 * i + 1]!;
    const xj = r[2 * j]!;
    const yj = r[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd test against a polygon's rings (outer ring and holes together). */
export function pointInPolygon(x: number, y: number, rings: readonly Ring[]): boolean {
  let inside = false;
  for (const r of rings) if (pointInRing(x, y, r)) inside = !inside;
  return inside;
}

/** Area-weighted centroid of a ring. Falls back to the first point for a degenerate ring. */
export function ringCentroid(r: Ring): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const f = r[2 * j]! * r[2 * i + 1]! - r[2 * i]! * r[2 * j + 1]!;
    a += f;
    cx += (r[2 * j]! + r[2 * i]!) * f;
    cy += (r[2 * j + 1]! + r[2 * i + 1]!) * f;
  }
  if (a === 0) return [r[0] ?? 0, r[1] ?? 0];
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * A point that lies inside the polygon, near its middle: the centroid of the outer ring when that is inside,
 * otherwise the best of a coarse grid (the point farthest from the boundary). Deterministic.
 */
export function interiorPoint(rings: readonly Ring[]): [number, number] {
  const outer = rings[0]!;
  const c = ringCentroid(outer);
  if (pointInPolygon(c[0], c[1], rings)) return c;
  const [w, s, e, n] = ringBBox(outer);
  // A thinned copy of the boundary, to keep the distance test cheap on a huge coastline.
  const step = Math.max(1, Math.floor(outer.length / 2 / 300));
  const bx: number[] = [];
  const by: number[] = [];
  for (let i = 0; i < outer.length / 2; i += step) {
    bx.push(outer[2 * i]!);
    by.push(outer[2 * i + 1]!);
  }
  let best: [number, number] | null = null;
  let bestD = -1;
  const G = 24;
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const x = w + ((gx + 0.5) / G) * (e - w);
      const y = s + ((gy + 0.5) / G) * (n - s);
      if (!pointInPolygon(x, y, rings)) continue;
      let d = Infinity;
      for (let k = 0; k < bx.length; k++) {
        const dx = x - bx[k]!;
        const dy = y - by[k]!;
        const dd = dx * dx + dy * dy;
        if (dd < d) d = dd;
      }
      if (d > bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  }
  // A sliver that no grid point hits: the first vertex is on the boundary, which is as good as it gets.
  return best ?? [outer[0] ?? 0, outer[1] ?? 0];
}

/** The label point of a multi-part area: the interior point of its largest part. */
export function labelPoint(polygons: readonly (readonly Ring[])[]): [number, number] {
  let best: readonly Ring[] | null = null;
  let bestA = -1;
  for (const p of polygons) {
    const a = Math.abs(ringArea(p[0]!));
    if (a > bestA) {
      bestA = a;
      best = p;
    }
  }
  return best ? interiorPoint(best) : [0, 0];
}

/** Bounding box of every part. */
export function polygonsBBox(polygons: readonly (readonly Ring[])[]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of polygons) {
    const b = ringBBox(p[0]!);
    if (b[0] < w) w = b[0];
    if (b[1] < s) s = b[1];
    if (b[2] > e) e = b[2];
    if (b[3] > n) n = b[3];
  }
  return [w, s, e, n];
}
