/**
 * A small TopoJSON reader. No imports and only erasable TypeScript, so the build script (plain Node, which strips
 * types) can import this file as it is. A ring is a flat Float64Array [x0, y0, x1, y1, ...], closed (first point
 * repeated last), in degrees: x is longitude, y is latitude.
 */
export interface TopoGeometry {
  type: "Polygon" | "MultiPolygon" | null;
  id?: string | number;
  /** Polygon: rings of arc indexes. MultiPolygon: polygons of rings of arc indexes. */
  arcs?: number[][] | number[][][];
  properties?: Record<string, unknown>;
}

export interface Topology {
  type: "Topology";
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, { type: "GeometryCollection"; geometries: TopoGeometry[] }>;
}

export type Ring = Float64Array;
/** A polygon: the outer ring first, then any holes. */
export type PolygonRings = Ring[];

/** Every arc as flat absolute coordinates. TopoJSON arcs are delta-encoded when a transform is present. */
export function decodeArcs(topo: Topology): Float64Array[] {
  const t = topo.transform;
  return topo.arcs.map((arc) => {
    const out = new Float64Array(arc.length * 2);
    let x = 0;
    let y = 0;
    for (let i = 0; i < arc.length; i++) {
      const p = arc[i]!;
      if (t) {
        x += p[0]!;
        y += p[1]!;
        out[2 * i] = x * t.scale[0] + t.translate[0];
        out[2 * i + 1] = y * t.scale[1] + t.translate[1];
      } else {
        out[2 * i] = p[0]!;
        out[2 * i + 1] = p[1]!;
      }
    }
    return out;
  });
}

function ringOf(arcIdx: number[], arcs: readonly Float64Array[]): Ring {
  const parts: Float64Array[] = [];
  let len = 0;
  for (const idx of arcIdx) {
    const reversed = idx < 0;
    const a = arcs[reversed ? ~idx : idx]!;
    const n = a.length / 2;
    let piece: Float64Array;
    if (reversed) {
      piece = new Float64Array(a.length);
      for (let i = 0; i < n; i++) {
        piece[2 * i] = a[2 * (n - 1 - i)]!;
        piece[2 * i + 1] = a[2 * (n - 1 - i) + 1]!;
      }
    } else {
      piece = a;
    }
    // Consecutive arcs share their end point: drop the first point of every arc after the first.
    const from = parts.length === 0 ? 0 : 2;
    parts.push(from === 0 ? piece : piece.subarray(2));
    len += piece.length - from;
  }
  const ring = new Float64Array(len);
  let o = 0;
  for (const p of parts) {
    ring.set(p, o);
    o += p.length;
  }
  return ring;
}

/** The polygons of a geometry (a Polygon gives one, a MultiPolygon several, a null geometry none). */
export function polygonsOf(g: TopoGeometry, arcs: readonly Float64Array[]): PolygonRings[] {
  if (g.type === "Polygon") return [(g.arcs as number[][]).map((r) => ringOf(r, arcs))];
  if (g.type === "MultiPolygon") {
    return (g.arcs as number[][][]).map((poly) => poly.map((r) => ringOf(r, arcs)));
  }
  return [];
}
