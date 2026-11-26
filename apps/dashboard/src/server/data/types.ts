import type { CountKind, PNum } from "../privacy";
import type { BrandId, Role } from "../types";

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

/**
 * A line of text with numbers in it. `text` holds {name} placeholders and `counts` the numbers they stand for, as
 * RawCounts, so the presentation layer can threshold them before they are printed.
 */
export interface TextRaw {
  text: string;
  counts: Record<string, RawCount>;
}

export interface Change {
  severity: "ok" | "info" | "warn" | "crit";
  title: TextRaw;
  detail: TextRaw;
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

/* ---------------- brand insight and teen market ---------------- */

export interface EntityRef {
  id: string;
  name: string;
  kind: string;
  group: string;
}

export interface AudienceQuery {
  /** An entity id: a chain, merchant or category. */
  entity: string;
  /**
   * Prepare the figures for a printed report: every count is presented as a brand would see it (an executive-level
   * view), for every role, so no exact small number reaches a PDF. Set by the export view only.
   */
  forExport?: boolean;
}

export interface CountRow {
  label: string;
  value: RawCount;
}
export interface AreaRow {
  name: string;
  postcode: string;
  state: string;
  people: RawCount;
}
export interface SegmentRow {
  name: string;
  audience: RawCount;
  /** Share (0..1) of the people in the same areas who fit the segment. A rate, not a count. */
  areaShare: number;
  /** 100 is average for the area. A rate, not a count. */
  index: number;
}

export interface AudienceReportRaw {
  entity: EntityRef;
  /** True for the 13 to 17 version: every count is teen-kind. */
  teen: boolean;
  asOf: string;
  audience: RawCount;
  /** "YYYY-MM", oldest first. */
  months: string[];
  audienceSeries: RawSeries;
  /** Growth in the last 90 days, a rate (0.12 is +12%). */
  growth90: number;
  visitsPerMonth: number;
  /** Share (0..1) of all registered people in GOD. A rate. */
  shareOfGod: number;
  homeAreas: AreaRow[];
  activityAreas: AreaRow[];
  age: CountRow[];
  occupation: CountRow[];
  income: CountRow[];
  segments: SegmentRow[];
  frequency: CountRow[];
  spend: CountRow[];
  alsoShopsAt: CountRow[];
  godBrands: CountRow[];
  census: {
    medianWeeklyHouseholdIncome: number;
    householdsWithChildrenPct: number;
    bornOverseasPct: number;
  };
}

export interface InsightRaw {
  entities: EntityRef[];
  report: AudienceReportRaw;
}

export interface TeensRaw {
  /** The entities a teen report may cover (never a sensitive category). */
  entities: EntityRef[];
  report: AudienceReportRaw;
  teensInGod: RawCount;
  teensSeries: RawSeries;
  months: string[];
  /** Rates (0..1). */
  guardianNoticeShare: number;
  usesYourTalShare: number;
  alsoSnapAppShare: number;
  repeatRate: number;
  cameBackWithin30Days: number;
  alsoVisitedCompetitor: number;
  visitsPerActiveTeen: number;
  interestsDeclared: CountRow[];
  interestsLearned: CountRow[];
  /** Average A$ a month per active teen. Money, not a count. */
  spendPerActiveTeen: { label: string; amount: number }[];
  loyalty: CountRow[];
  /** Which GOD brands teens use: YourTal only, YourTal and SnapApp, SnapApp only. */
  brandMix: CountRow[];
}

/* ---------------- Person 360 ---------------- */

/** One search hit. A teen hit is an id and nothing else: a teen profile has no body anywhere in this contract. */
export type PersonSearchRow =
  { id: string; teen: true } | { id: string; teen: false; ageBand: string; brands: BrandId[] };

export interface PersonAccount {
  brand: BrandId;
  /** "YYYY-MM" */
  since: string;
  linkedBy: "YourTal sign-in" | "Verified email" | "Verified mobile" | null;
  complete: boolean;
}
export interface PersonProfileRaw {
  id: string;
  ageBand: string;
  homeArea: string;
  state: string;
  accounts: PersonAccount[];
  occupation: { title: string; group: string; incomeBand: string } | null;
  mergeConfidence: "high" | "medium";
  linkedBy: "YourTal sign-in" | "Verified email" | "Verified mobile";
  /** "YYYY-MM" */
  lastSeen: string;
  timeline: { date: string; title: string; detail: string }[];
  /** One person's own receipts at a merchant and suburb. Their own history, not an aggregate. */
  places: {
    merchant: string;
    suburb: string;
    state: string;
    category: string;
    receipts: number;
    lastVisit: string;
  }[];
  dots: { lat: number; lon: number; label: string; category: string }[];
  areas: { label: string; lat: number; lon: number; radiusKm: number }[];
  interests: { label: string; kind: "Declared" | "Learned"; source: string; confidence: number }[];
}

/** What a provider returns for an id. A teen is `{ kind: "teen" }` and nothing more. */
export type PersonGetRaw =
  | { kind: "profile"; profile: PersonProfileRaw }
  | { kind: "teen"; id: string }
  | { kind: "not-found" };

/* ---------------- Data quality ---------------- */

export interface QualityRaw {
  asOf: string;
  /** Replication lag per source. Seconds are a duration, not a count. */
  lag: { source: string; seconds: number; status: "ok" | "warn"; series: number[] }[];
  rows: { app: string; table: string; inGod: RawCount; inApp: RawCount }[];
  geocoding: CountRow[];
  merges: { bySignIn: RawCount; byEmail: RawCount; undone: RawCount };
  jobs: {
    name: string;
    schedule: string;
    lastRun: string;
    duration: string;
    result: "ok" | "warn" | "crit";
  }[];
  verification: {
    id: string;
    kind: "synthetic" | "sampled";
    check: string;
    ran: string;
    result: "ok" | "warn" | "crit" | "pending";
    detail: string;
    /** For a sampled run on 20 real teens: the Owner and a second approver. Empty for synthetic fixtures. */
    approvers: string[];
    /** When the output of a sampled run is destroyed (7 days after it ran), "YYYY-MM-DD". */
    destroyOn: string | null;
    destroyed: boolean;
  }[];
}

/* ---------------- Admin ---------------- */

/** The allow-list is the dashboard's own state, not warehouse data: see src/server/store/types.ts. */
export type { AllowEntry, AllowStatus } from "../store/types";

/** One active session, as Admin lists it. Never the token or its hash. */
export interface SessionRow {
  id: string;
  personId: string;
  person: string;
  device: string;
  near: string;
  /** ISO time */
  started: string;
  /** ISO time */
  lastActive: string;
  passkey: boolean;
  /** An emergency (break-glass) session: an hour at most, read-only apart from revoking sessions. */
  emergency: boolean;
  current: boolean;
}

/** The future warehouse contract. Exact numbers in, thresholds applied later by the presentation layer. */
export interface DashboardData {
  overview(q: { period: Period }): Promise<OverviewRaw>;
  brand<B extends BrandId>(brand: B, q: { period: Period }): Promise<BrandRawMap[B]>;
  influenceMap(q: InfluenceQuery): Promise<InfluenceRaw>;
  activityMap(q: ActivityQuery): Promise<ActivityRaw>;
  insight(q: AudienceQuery): Promise<InsightRaw>;
  teens(q: { entity?: string }): Promise<TeensRaw>;
  /** Search by GOD id (or the start of one). Never by name, email or phone. */
  personSearch(q: string): Promise<PersonSearchRow[]>;
  /** An adult's profile, or a refusal for a teen. There is no method that returns a teen profile body. */
  personGet(id: string): Promise<PersonGetRaw>;
  quality(): Promise<QualityRaw>;
}
