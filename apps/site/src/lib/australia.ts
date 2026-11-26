import { AU_LAND } from "./au-land";

/**
 * The dotted Australia on the home page, computed at build time and emitted as static SVG.
 * It is the approved prototype's canvas drawing, ported line for line: the same land test, grid, city
 * weights and jitter, so the picture matches. No map library and no script reaches the browser.
 */

export interface City {
  n: string;
  lo: number;
  la: number;
  r: number;
  lab?: boolean;
}

export const CITIES: City[] = [
  { n: "Sydney", lo: 151.21, la: -33.87, r: 1.0, lab: true },
  { n: "Melbourne", lo: 144.96, la: -37.81, r: 1.0, lab: true },
  { n: "Brisbane", lo: 153.03, la: -27.47, r: 0.85, lab: true },
  { n: "Perth", lo: 115.86, la: -31.95, r: 0.85, lab: true },
  { n: "Adelaide", lo: 138.6, la: -34.93, r: 0.65, lab: true },
  { n: "Gold Coast", lo: 153.4, la: -28.02, r: 0.4 },
  { n: "Canberra", lo: 149.13, la: -35.28, r: 0.4, lab: true },
  { n: "Hobart", lo: 147.33, la: -42.88, r: 0.45, lab: true },
  { n: "Darwin", lo: 130.84, la: -12.46, r: 0.5, lab: true },
  { n: "Newcastle", lo: 151.78, la: -32.93, r: 0.4 },
  { n: "Cairns", lo: 145.77, la: -16.92, r: 0.4 },
  { n: "Townsville", lo: 146.82, la: -19.26, r: 0.4 },
];

/** viewBox size. It is 560 wide so one unit is about one pixel at the hero's usual width. */
export const MAP_W = 560;
export const MAP_H = 500;

const LO0 = 112.6;
const LO1 = 154.2;
const LA0 = -44.2;
const LA1 = -10.2;
const KX = Math.cos((27 * Math.PI) / 180);
const W_UNITS = (LO1 - LO0) * KX;
const H_UNITS = LA1 - LA0;
const STEP = 0.46;

export function inRing(x: number, y: number, ring: number[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; i += 2) {
    const xi = ring[i] ?? 0;
    const yi = ring[i + 1] ?? 0;
    const xj = ring[j] ?? 0;
    const yj = ring[j + 1] ?? 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    j = i;
  }
  return inside;
}

export function onLand(x: number, y: number): boolean {
  return AU_LAND.some((ring) => inRing(x, y, ring));
}

function rnd(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

interface Dot {
  lo: number;
  la: number;
  w: number;
  /** 1 for the finer dots scattered around a city. */
  s: 0 | 1;
}

function makeDots(): Dot[] {
  const dots: Dot[] = [];
  let row = 0;
  for (let la = LA1; la > LA0; la -= STEP * 0.866, row++) {
    for (let lo = LO0 + (row % 2 ? STEP / 2 : 0); lo < LO1; lo += STEP) {
      if (!onLand(lo, la)) continue;
      let w = 0;
      for (const c of CITIES) {
        const dx = (lo - c.lo) * KX;
        const dy = la - c.la;
        w += Math.exp(-(dx * dx + dy * dy) / (c.r * c.r * 1.1));
      }
      dots.push({ lo, la, w: Math.min(w, 1), s: 0 });
    }
  }
  CITIES.forEach((c, i) => {
    const count = Math.round(36 * c.r * c.r * 2.2);
    for (let k = 0; k < count; k++) {
      const a = rnd(i * 977 + k * 3.1) * Math.PI * 2;
      const d = Math.pow(rnd(i * 313 + k * 7.7 + 1), 0.8) * c.r * 1.15;
      const lo = c.lo + (Math.cos(a) * d) / KX;
      const la = c.la + Math.sin(a) * d;
      if (onLand(lo, la)) dots.push({ lo, la, w: Math.max(0.35, 1 - d / (c.r * 1.2)), s: 1 });
    }
  });
  return dots;
}

function proj(lo: number, la: number): [number, number] {
  return [((lo - LO0) * KX * MAP_W) / W_UNITS, ((LA1 - la) * MAP_H) / H_UNITS];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const quant = (n: number, step: number) => Math.round(n / step) * step;

export interface DotGroup {
  /** "dot" is the bright colour and "dim" the soft one. */
  cls: "dot" | "dim";
  /** stroke-width, which is the dot's diameter. */
  w: number;
  /** stroke-opacity. */
  o: number;
  /** One "M x y h.01" per dot: with a round line cap each becomes a dot. */
  d: string;
}

export interface CityMark {
  name: string;
  x: number;
  y: number;
  r: number;
  label?: { x: number; y: number; anchor: "start" | "end" };
}

export interface AustraliaMap {
  groups: DotGroup[];
  cities: CityMark[];
  labelSize: number;
}

const LABEL_POS: Record<string, [number, number]> = {
  Sydney: [-1, 0],
  Brisbane: [-1, 0],
  Canberra: [-1, 1],
  Melbourne: [-1, 1.4],
  Adelaide: [-1, 1.3],
  Perth: [1, 0],
  Hobart: [1, 0.4],
  Darwin: [1, -0.8],
};

export function buildAustralia(): AustraliaMap {
  const base = Math.max(1.1, MAP_W / 230);
  const labelSize = Math.round(Math.max(11, MAP_W / 52));
  const buckets = new Map<string, { cls: "dot" | "dim"; w: number; o: number; pts: string[] }>();

  for (const d of makeDots()) {
    const [x, y] = proj(d.lo, d.la);
    const o = round2(quant(d.s ? 0.55 + 0.45 * d.w : 0.6 + 0.4 * d.w, 0.05));
    const w = round2(quant(2 * base * (d.s ? 0.55 : 0.8) * (1 + d.w * 0.55), 0.1));
    const cls = d.w > 0.45 ? "dot" : "dim";
    const key = `${cls}|${w}|${o}`;
    let b = buckets.get(key);
    if (!b) {
      b = { cls, w, o, pts: [] };
      buckets.set(key, b);
    }
    b.pts.push(`M${round1(x)} ${round1(y)}h.01`);
  }

  const groups = [...buckets.values()]
    .sort((a, b) => a.cls.localeCompare(b.cls) || a.o - b.o || a.w - b.w)
    .map((b) => ({ cls: b.cls, w: b.w, o: b.o, d: b.pts.join("") }));

  const cities = CITIES.map((c): CityMark => {
    const [x, y] = proj(c.lo, c.la);
    const mark: CityMark = { name: c.n, x: round1(x), y: round1(y), r: round2(base * 1.7) };
    if (c.lab) {
      const pos = LABEL_POS[c.n] ?? [1, 0];
      mark.label = {
        x: round1(x + pos[0] * base * 3.4),
        y: round1(y + base * 0.5 + pos[1] * labelSize),
        anchor: pos[0] < 0 ? "end" : "start",
      };
    }
    return mark;
  });

  return { groups, cities, labelSize };
}
