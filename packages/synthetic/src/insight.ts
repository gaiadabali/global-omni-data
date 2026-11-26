import { CITIES, STATE_CODES, SUBURBS, kmBetween, stateAt } from "./geo";
import { mulberry32, type Rng } from "./rng";
import { trend } from "./series";
import { CATEGORIES, MONTHS } from "./world";

/**
 * Brand insight and teen market: who shops at a fictional chain, merchant or category. Exact numbers; the
 * dashboard's data layer turns every count into a thresholded figure for the viewer. Deterministic: the same
 * entity gives the same report on every machine. Ported from the approved prototype (2026-11-26).
 */

export interface InsightEntity {
  id: string;
  name: string;
  kind: string;
  group: "Chains and merchants" | "Categories";
  /** Index into CATEGORIES. */
  category: number;
  /** Registered people who shopped here (adults). */
  audience: number;
  /** The metropolitan areas it trades in, most important first. */
  cities: readonly string[];
  seed: number;
}

const CATEGORY_AUDIENCE = [41200, 58900, 26300, 33700, 12800, 17400] as const;

export const INSIGHT_ENTITIES: readonly InsightEntity[] = [
  {
    id: "southern",
    name: "Southern Cross Fuel",
    kind: "Fuel chain, 212 sites",
    group: "Chains and merchants",
    category: 0,
    audience: 18420,
    cities: ["Brisbane", "Gold Coast", "Sydney", "Perth", "Newcastle"],
    seed: 11,
  },
  {
    id: "harbour",
    name: "Harbour & Bean",
    kind: "Café group, 64 sites",
    group: "Chains and merchants",
    category: 2,
    audience: 7960,
    cities: ["Sydney", "Melbourne", "Brisbane", "Perth"],
    seed: 12,
  },
  {
    id: "kidzone",
    name: "Kidzone Play",
    kind: "Kids' entertainment, 38 venues",
    group: "Chains and merchants",
    category: 5,
    audience: 3240,
    cities: ["Brisbane", "Gold Coast", "Sunshine Coast", "Sydney"],
    seed: 13,
  },
  {
    id: "coastline",
    name: "Coastline Grocers",
    kind: "Grocery chain, 91 stores",
    group: "Chains and merchants",
    category: 1,
    audience: 24150,
    cities: ["Gold Coast", "Sunshine Coast", "Newcastle", "Brisbane", "Wollongong"],
    seed: 14,
  },
  ...CATEGORIES.map(
    (c, i): InsightEntity => ({
      id: `cat-${c.id}`,
      name: `Category: ${c.name}`,
      kind: `All ${c.name.toLowerCase()} merchants in the data`,
      group: "Categories",
      category: i,
      audience: CATEGORY_AUDIENCE[i]!,
      cities: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast"],
      seed: 20 + i,
    }),
  ),
];

export function insightEntity(id: string): InsightEntity | undefined {
  return INSIGHT_ENTITIES.find((e) => e.id === id);
}

/** Whether the entity's category is sensitive (pharmacy and health): higher threshold, never in teen figures. */
export function isSensitiveEntity(e: InsightEntity): boolean {
  return CATEGORIES[e.category]?.sensitive === true;
}

/** The entities a teen report may cover: never a sensitive category. */
export function teenEntities(): InsightEntity[] {
  return INSIGHT_ENTITIES.filter((e) => !isSensitiveEntity(e));
}

/* ---------------- vocabulary ---------------- */

const SEGMENTS: Record<number, readonly string[]> = {
  0: ["Commuter, fuel twice a week", "Tradies and fleet drivers", "Weekend road-trippers", "Fuel-and-snack stoppers", "Price-led, switches often"],
  1: ["Family grocery shopper", "Weekly big shop", "Health-conscious cook", "Student budget", "Late-night top-up"],
  2: ["Coffee daily", "Weekday lunch", "Weekend brunch", "Remote workers", "Takeaway commuters"],
  3: ["Home upgraders", "Gift buyers", "Bargain hunters", "Outdoor enthusiasts", "Fashion regulars"],
  4: ["Family health stock-up", "Skincare buyers", "Seasonal-wellness buyers", "Regular repeat scripts", "Baby and toddler care"],
  5: ["Family weekend planners", "Birthday-party hosts", "School-holiday parents", "Date-night goers", "Teen groups"],
};

/** Teen segments are about what teens do, never about what they buy in a sensitive category. */
const TEEN_SEGMENTS: Record<number, readonly string[]> = {
  0: ["Servo snack stops", "After-sport drink runs", "Lifts with family", "Pocket-money spenders", "Late-afternoon top-ups"],
  1: ["Lunch-break grabbers", "Family shop helpers", "Snack and drink buyers", "Weekend meal planners", "Late-night top-ups"],
  2: ["After-school bubble tea", "Friend-group hangouts", "Weekend brunch", "Study-break coffee", "Dessert and treats"],
  3: ["Sneaker and streetwear fans", "Gift buyers", "Back-to-school shoppers", "Phone and gadget buyers", "Bargain hunters"],
  5: ["Friend-group outings", "Birthday-party guests", "School-holiday regulars", "Arcade and gaming fans", "Cinema goers"],
};

const COMPETITORS: Record<number, readonly string[]> = {
  0: ["Pacific Petroleum", "Ironbark Fuel", "Wattle Energy"],
  1: ["FreshMart Co-op", "Bluegum Foods", "Outback Outfitters"],
  2: ["Laneway Roasters", "Brew Society", "Coastline Grocers"],
  3: ["Kestrel Home", "Tidewater Fashion", "Outback Outfitters"],
  4: ["Wattle Pharmacy", "Care Corner Pharmacy", "Coastline Grocers"],
  5: ["Jumpworks Arena", "Starlight Cinemas", "Little Orbit Play"],
};

const FREQUENCY = [
  [18, 34, 32, 16],
  [9, 30, 41, 20],
  [14, 30, 34, 22],
  [52, 34, 11, 3],
  [22, 44, 26, 8],
  [44, 38, 15, 3],
] as const;
export const FREQUENCY_LABELS = ["Once a month or less", "2 to 3 times a month", "Weekly", "Two or more a week"] as const;

const SPEND: Record<number, { labels: readonly string[]; weights: readonly number[] }> = {
  0: { labels: ["Under A$40", "A$40–79", "A$80–119", "A$120+"], weights: [10, 38, 38, 14] },
  1: { labels: ["Under A$30", "A$30–79", "A$80–149", "A$150+"], weights: [12, 31, 36, 21] },
  2: { labels: ["Under A$8", "A$8–14", "A$15–29", "A$30+"], weights: [26, 44, 24, 6] },
  3: { labels: ["Under A$30", "A$30–99", "A$100–249", "A$250+"], weights: [24, 40, 24, 12] },
  4: { labels: ["Under A$15", "A$15–39", "A$40–89", "A$90+"], weights: [28, 36, 24, 12] },
  5: { labels: ["Under A$25", "A$25–59", "A$60–119", "A$120+"], weights: [14, 34, 32, 20] },
};

/** Adult age mix by category, bands 18–24 to 65+ (the teen band is reported by the teen market only). */
const AGE_MIX: Record<number, readonly number[]> = {
  0: [0.18, 0.3, 0.22, 0.15, 0.1, 0.05],
  1: [0.1, 0.22, 0.28, 0.2, 0.12, 0.08],
  2: [0.26, 0.32, 0.2, 0.12, 0.07, 0.03],
  3: [0.14, 0.26, 0.26, 0.18, 0.1, 0.06],
  4: [0.08, 0.2, 0.22, 0.2, 0.16, 0.14],
  5: [0.04, 0.2, 0.34, 0.22, 0.1, 0.1],
};
export const ADULT_AGE_LABELS = ["18–24", "25–34", "35–44", "45–54", "55–64", "65+"] as const;
export const TEEN_AGE_LABELS = ["13–14", "15–16", "17"] as const;

export const OCCUPATIONS = [
  "Hospitality and retail",
  "Healthcare and care",
  "Trades and construction",
  "Office and admin",
  "Education",
  "Students",
  "Other",
] as const;
export const INCOME_BANDS = [
  "Up to A$18,200",
  "A$18,201–45,000",
  "A$45,001–120,000",
  "A$120,001–180,000",
  "Over A$180,000",
] as const;

/* ---------------- result shape ---------------- */

export interface ShareRow {
  label: string;
  /** People in the group. */
  n: number;
}
export interface AreaRow {
  name: string;
  postcode: string;
  state: string;
  n: number;
}
export interface SegmentRow {
  name: string;
  n: number;
  /** Share (0..1) of the people living in the same areas who fit the segment. */
  areaShare: number;
  /** 100 is average for the area. */
  index: number;
}

export interface AudienceReport {
  entity: InsightEntity;
  teen: boolean;
  /** Registered people in the audience (teens: aged 13 to 17). */
  audience: number;
  /** The last 12 months, oldest first. */
  months: string[];
  series: number[];
  /** Growth in the last 90 days (a rate, 0.12 is +12%). */
  growth90: number;
  visitsPerMonth: number;
  homeAreas: AreaRow[];
  activityAreas: AreaRow[];
  age: ShareRow[];
  /** Empty for teens: occupation and income are not held for them. */
  occupation: ShareRow[];
  income: ShareRow[];
  segments: SegmentRow[];
  frequency: ShareRow[];
  spend: ShareRow[];
  alsoShopsAt: ShareRow[];
  godBrands: ShareRow[];
  census: { medianWeeklyHouseholdIncome: number; householdsWithChildrenPct: number; bornOverseasPct: number };
}

/* ---------------- generation ---------------- */

const METRO = CITIES.filter((c) => c.kind !== "town");
const metroCache = new Map<number, number>();

/** Index into CITIES of the metropolitan area a suburb belongs to. */
function metroOfSuburb(i: number): number {
  const hit = metroCache.get(i);
  if (hit !== undefined) return hit;
  const s = SUBURBS[i]!;
  let best = METRO[0]!;
  let bd = Infinity;
  for (const c of METRO) {
    const d = kmBetween(s[3], s[2], c.lat, c.lon);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  metroCache.set(i, best.index);
  return best.index;
}

function norm(v: readonly number[]): number[] {
  const t = v.reduce((a, b) => a + b, 0) || 1;
  return v.map((x) => x / t);
}
function jit(r: Rng, v: readonly number[]): number[] {
  return norm(v.map((x) => x * (0.8 + r() * 0.4)));
}
function rows(labels: readonly string[], shares: readonly number[], a: number): ShareRow[] {
  return labels.map((label, i) => ({ label, n: Math.round((shares[i] ?? 0) * a) }));
}

function areas(e: InsightEntity, r: Rng, a: number, spill: boolean): AreaRow[] {
  const wanted = new Set(e.cities);
  const scored: { i: number; w: number }[] = [];
  SUBURBS.forEach((_, i) => {
    const city = CITIES[metroOfSuburb(i)]!;
    if (!wanted.has(city.name)) return;
    const rank = e.cities.indexOf(city.name);
    scored.push({ i, w: (0.25 + r()) * Math.pow(spill ? 0.62 : 0.45, rank) });
  });
  scored.sort((x, y) => y.w - x.w);
  const top = scored.slice(0, spill ? 9 : 8);
  const weights = top.map((o) => Math.pow(o.w, 1.4));
  const total = weights.reduce((x, y) => x + y, 0) || 1;
  // The listed areas hold about two thirds of the audience; the rest is spread thinly elsewhere.
  const coverage = spill ? 0.57 : 0.68;
  return top
    .map((o, k) => {
      const s = SUBURBS[o.i]!;
      const city = CITIES[metroOfSuburb(o.i)]!;
      const st = stateAt(s[3], s[2]);
      return {
        name: s[0],
        postcode: s[1],
        state: STATE_CODES[st >= 0 ? st : city.state] ?? "",
        n: Math.round((weights[k]! / total) * coverage * a),
      };
    })
    .sort((x, y) => y.n - x.n);
}

/** The audience report for one entity. `teen: true` gives the 13 to 17 version (about 18% of the adult audience). */
export function audienceReport(e: InsightEntity, opts: { teen: boolean }): AudienceReport {
  const teen = opts.teen;
  if (teen && isSensitiveEntity(e)) throw new RangeError("sensitive categories never appear in teen figures");
  const r = mulberry32(e.seed * 91 + (teen ? 500 : 0));
  const a = teen ? Math.round(e.audience * 0.18) : e.audience;

  const gs = trend(e.seed * 7 + (teen ? 3 : 0), a * 0.34, a, 0.02).slice(-12);
  gs[gs.length - 1] = a;
  const g90 = (gs[11]! - gs[8]!) / gs[8]!;

  const homeAreas = areas(e, r, a, false);
  const activityAreas = areas(e, r, a, true);

  const age = teen
    ? rows(TEEN_AGE_LABELS, jit(r, [0.27, 0.4, 0.33]), a)
    : rows(ADULT_AGE_LABELS, jit(r, AGE_MIX[e.category]!), a);
  const occupation = teen ? [] : rows(OCCUPATIONS, jit(r, [24, 17, 15, 14, 9, 12, 9]), a);
  const income = teen ? [] : rows(INCOME_BANDS, jit(r, [11, 31, 48, 8, 2]), a);

  const segNames = (teen ? TEEN_SEGMENTS[e.category] : SEGMENTS[e.category]) ?? [];
  const segments: SegmentRow[] = segNames
    .map((name, i) => {
      const sh = 0.34 - i * 0.045 + (r() - 0.5) * 0.04;
      const ar = 0.12 + r() * 0.08;
      return { name, n: Math.round(sh * a), areaShare: ar, index: Math.round((sh / ar) * 100 * (teen ? 0.9 : 1)) };
    })
    .sort((x, y) => y.index - x.index);

  const frequency = rows(FREQUENCY_LABELS, norm(FREQUENCY[e.category]!), a);
  const sp = SPEND[e.category]!;
  const spend = rows(sp.labels, norm(sp.weights), a);
  const alsoShopsAt = (COMPETITORS[e.category] ?? [])
    .map((name) => ({ label: name, n: Math.round((0.18 + r() * 0.38) * a) }))
    .sort((x, y) => y.n - x.n);

  const brandShares = [0.64 + r() * 0.1, 0.38 + r() * 0.14, 0.1 + r() * 0.08];
  const godBrands: ShareRow[] = teen
    ? rows(["YourTal only", "YourTal and SnapApp", "SnapApp only"], [0.82, 0.14, 0.04], a)
    : rows(["YourTal", "SnapApp", "Free Tax Returns"], brandShares, a);

  return {
    entity: e,
    teen,
    audience: a,
    months: MONTHS.slice(-12),
    series: gs,
    growth90: g90,
    visitsPerMonth: Math.round((1.4 + r() * 3.1) * 10) / 10,
    homeAreas,
    activityAreas,
    age,
    occupation,
    income,
    segments,
    frequency,
    spend,
    alsoShopsAt,
    godBrands,
    census: {
      medianWeeklyHouseholdIncome: 1650 + (e.seed % 7) * 35,
      householdsWithChildrenPct: 28 + (e.seed % 5),
      bornOverseasPct: 22 + (e.seed % 6),
    },
  };
}

/* ---------------- teen market, group-wide ---------------- */

export interface TeenMarket {
  /** Shares of all teens in GOD (0..1), for the dashboard to turn into counts. */
  interestsDeclared: { label: string; share: number }[];
  interestsLearned: { label: string; share: number }[];
  /** Average A$ a month per active teen. Sensitive categories are not reported for teens, so they are not here. */
  spendPerActiveTeen: { label: string; amount: number }[];
  loyalty: { label: string; share: number }[];
  guardianNoticeShare: number;
  usesYourTalShare: number;
  alsoSnapAppShare: number;
  repeatRate: number;
  visitsPerActiveTeen: number;
  cameBackWithin30Days: number;
  alsoVisitedCompetitor: number;
}

export function teenMarket(): TeenMarket {
  return {
    interestsDeclared: [
      { label: "Gaming", share: 0.71 },
      { label: "Music and live shows", share: 0.58 },
      { label: "Football and sport", share: 0.49 },
      { label: "Fashion and sneakers", share: 0.41 },
      { label: "Food and bubble tea", share: 0.38 },
      { label: "Art and making", share: 0.22 },
    ],
    interestsLearned: [
      { label: "Cafés and desserts", share: 0.64 },
      { label: "Arcades and play venues", share: 0.57 },
      { label: "Fast fashion", share: 0.44 },
      { label: "Phone and gadgets", share: 0.33 },
      { label: "Cinema", share: 0.31 },
      { label: "Skate and outdoors", share: 0.19 },
    ],
    spendPerActiveTeen: [
      { label: "Cafés & takeaway", amount: 23.4 },
      { label: "Entertainment", amount: 19.8 },
      { label: "Retail", amount: 17.2 },
      { label: "Groceries", amount: 8.1 },
      { label: "Fuel", amount: 2.2 },
    ],
    loyalty: [
      { label: "Once a month or less", share: 0.41 },
      { label: "2 to 3 times a month", share: 0.34 },
      { label: "Weekly", share: 0.19 },
      { label: "Two or more a week", share: 0.06 },
    ],
    guardianNoticeShare: 0.94,
    usesYourTalShare: 0.96,
    alsoSnapAppShare: 0.14,
    repeatRate: 0.38,
    visitsPerActiveTeen: 2.6,
    cameBackWithin30Days: 0.38,
    alsoVisitedCompetitor: 0.27,
  };
}
