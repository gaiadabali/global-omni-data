import type { CountKind, PNum } from "../privacy";
import type { BrandId } from "../types";

/**
 * THE DATA SEAM, contract side. `DashboardData` is what the real warehouse must provide. The synthetic provider
 * (./synthetic.ts) implements it today over @god/synthetic.
 *
 * Providers return EXACT numbers. Anything that is a count of people, businesses or receipts is typed RawCount
 * (or RawSeries); the presentation layer (./present.ts) turns every RawCount into a thresholded PNum for the
 * viewer before a page sees it. A plain `number` field is a deliberate "not a count": money, a rate, a share.
 * Pages never call a provider. They call getDashboardData(viewer) from ./index.ts.
 */

/* ---------------- raw leaves ---------------- */

export interface RawCount {
  readonly __raw: "count";
  readonly n: number;
  readonly kind: CountKind;
}
export interface RawSeries {
  readonly __raw: "series";
  readonly values: readonly number[];
  readonly kind: CountKind;
}

export function count(n: number, kind: CountKind = "adult"): RawCount {
  return { __raw: "count", n, kind };
}
export function countSeries(values: readonly number[], kind: CountKind = "adult"): RawSeries {
  return { __raw: "series", values, kind };
}
export function isRawCount(v: unknown): v is RawCount {
  return typeof v === "object" && v !== null && (v as { __raw?: unknown }).__raw === "count";
}
export function isRawSeries(v: unknown): v is RawSeries {
  return typeof v === "object" && v !== null && (v as { __raw?: unknown }).__raw === "series";
}

/** What a page receives: RawCount becomes PNum, RawSeries becomes number[] (suppressed points plotted as 0). */
export type Present<T> = T extends RawCount
  ? PNum
  : T extends RawSeries
    ? number[]
    : T extends readonly (infer U)[]
      ? Present<U>[]
      : T extends object
        ? { [K in keyof T]: Present<T[K]> }
        : T;

/* ---------------- queries ---------------- */

export const PERIODS = ["week", "month", "quarter", "ytd"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  ytd: "Year to date",
};

export type BBox = [west: number, south: number, east: number, north: number];
export type H3Res = 3 | 4 | 5 | 6 | 7 | 8;

export interface InfluenceQuery {
  brand: BrandId | "all";
  audience: "businesses" | "people" | "both";
  measure: "count" | "per1000";
  /** "YYYY-MM": registered up to and including this month. */
  month: string;
  level: "state" | { h3: H3Res };
  bbox?: BBox;
}

export interface ActivityQuery {
  /** A category id: fuel, groc, cafe, retail, pharm, ent. */
  category?: string;
  /** An age band: "13–17", "18–24", ... */
  ageBand?: string;
  month: string;
  h3: 5 | 6 | 7 | 8;
  bbox?: BBox;
  /** Limits the audience to people who also use this brand. Set for a brand lead. */
  audienceBrand?: BrandId;
}

/* ---------------- results ---------------- */

export interface Change {
  severity: "ok" | "info" | "warn" | "crit";
  title: string;
  detail: string;
  pageId: string;
}

export interface Series<V> {
  id: string;
  name: string;
  values: V;
}

export interface OverviewRaw {
  asOf: string;
  month: string;
  months: string[];
  people: RawCount;
  businesses: RawCount;
  peoplePrevMonth: RawCount;
  businessesPrevMonth: RawCount;
  peopleSeries: RawSeries;
  businessesSeries: RawSeries;
  completeProfiles: RawCount;
  /** Share of people (0..1) with a finished profile in 2 or 3 apps. */
  completeShare: number;
  newInPeriod: RawCount;
  newInPrevPeriod: RawCount;
  newByMonth: RawSeries;
  activeInPeriod: RawCount;
  /** Share of people (0..1) who opened an app in the period. */
  activeShare: number;
  freshness: { syncedAgo: string; sources: { name: string; status: "ok" | "warn" }[] };
  growth: {
    labels: string[];
    full: string[];
    series: Series<RawSeries>[];
  };
  profileMix: {
    one: RawCount;
    two: RawCount;
    three: RawCount;
    pairs: { label: string; value: RawCount }[];
  };
  changes: Change[];
}

export interface YourTalRaw {
  brand: "yourtal";
  months: string[];
  viewers: RawCount;
  viewersPrevMonth: RawCount;
  viewersSeries: RawSeries;
  businesses: RawCount;
  businessesPrevMonth: RawCount;
  businessesSeries: RawSeries;
  liveCampaigns: RawCount;
  campaignsStartedThisMonth: RawCount;
  watchesInPeriod: RawCount;
  watchesSeries: RawSeries;
  /** Share (0..1) watched to the end. */
  completionRate: number;
  pointsInPeriod: RawCount;
  pointsSeries: RawSeries;
  vouchersRedeemed: RawCount;
  vouchersClaimed: RawCount;
  /** A$, simulated. */
  voucherValueRedeemed: number;
  campaignsByCategory: { label: string; value: RawCount }[];
  /** A$, simulated. */
  money: { label: string; amount: number }[];
  topCampaigns: {
    name: string;
    watches: RawCount;
    completion: number;
    points: RawCount;
    redeemed: RawCount;
  }[];
}

export interface SnapAppRaw {
  brand: "snapapp";
  months: string[];
  workspaces: RawCount;
  workspacesPrevMonth: RawCount;
  workspacesSeries: RawSeries;
  personalWorkspaces: RawCount;
  businessWorkspaces: RawCount;
  receiptsInPeriod: RawCount;
  receiptsSeries: RawSeries;
  /** A$ */
  averageReceipt: number;
  /** A$, all categories, in the period. */
  spendCaptured: number;
  sendsToFtrInPeriod: RawCount;
  sendsSeries: RawSeries;
  /** Share (0..1) of scanners who sent at least one receipt. */
  sendShare: number;
  creditPurchasesInPeriod: RawCount;
  creditPurchasesSeries: RawSeries;
  /** A$ sold in the period. */
  creditValue: number;
  /** A$ millions a month. Sensitive categories are money, not counts. */
  spendByCategory: { label: string; amountM: number }[];
  packs: { pack: string; sold: RawCount; value: number }[];
}

export interface FtrRaw {
  brand: "ftr";
  months: string[];
  leads: RawCount;
  accounts: RawCount;
  accountsPrevMonth: RawCount;
  accountsSeries: RawSeries;
  newAccountsSeries: RawSeries;
  returnsStarted: RawCount;
  returnsLodged: RawCount;
  medianMinutesToLodge: number;
  funnel: { label: string; value: RawCount }[];
  /** Percentages that add to 100. */
  sources: { label: string; percent: number }[];
  occupations: { label: string; percent: number }[];
  incomeBands: { label: string; percent: number }[];
}

export interface BrandRawMap {
  yourtal: YourTalRaw;
  snapapp: SnapAppRaw;
  ftr: FtrRaw;
}

export interface InfluenceRawCell {
  /** A state code ("NSW") or an h3 index. */
  id: string;
  label?: string;
  count: RawCount;
  /** Residents, for the per-1,000 measure. */
  population?: number;
}
export interface InfluenceRaw {
  cells: InfluenceRawCell[];
  /** True when more than the cap of cells matched and the smallest were dropped. */
  truncated: boolean;
}

export interface ActivityRawMerchant {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  receipts: RawCount;
}
export interface ActivityRawHeat {
  /** An h3 index. */
  id: string;
  /** People active in the area. Never a person-level point. */
  people: RawCount;
}
export interface ActivityRaw {
  merchants: ActivityRawMerchant[];
  heat: ActivityRawHeat[];
  truncated: boolean;
}

/** The future warehouse contract. Exact numbers in, thresholds applied later by the presentation layer. */
export interface DashboardData {
  overview(q: { period: Period }): Promise<OverviewRaw>;
  brand<B extends BrandId>(brand: B, q: { period: Period }): Promise<BrandRawMap[B]>;
  influenceMap(q: InfluenceQuery): Promise<InfluenceRaw>;
  activityMap(q: ActivityQuery): Promise<ActivityRaw>;
}
