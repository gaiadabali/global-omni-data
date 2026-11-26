import {
  CURRENT_INDEX,
  MONTHS,
  MONTH_COUNT,
  getWorld,
  trend,
  type World,
} from "@god/synthetic";
import { monthLong, monthShort } from "@/lib/format";
import { syntheticPages } from "./synthetic-pages";
import { activityArea, activityHotspots, activityMap, influenceMap, mapArea, mapSummary, warmMaps } from "./synthetic-maps";
import type { BrandId } from "../types";
import {
  count,
  countSeries,
  type BrandRawMap,
  type Change,
  type RawCount,
  type TextRaw,
  type DashboardData,
  type FtrRaw,
  type OverviewRaw,
  type Period,
  type SnapAppRaw,
  type YourTalRaw,
} from "./types";

/**
 * The synthetic DashboardData provider, over @god/synthetic. Exact numbers; thresholds are applied later by the
 * presentation layer (./present.ts). A warehouse provider replaces this file and nothing else.
 */

const AS_OF = "2026-11-26";

/** Months covered by a period, and the share of people who opened an app in it (as in the approved design). */
const PERIOD: Record<Period, { months: number; active: number }> = {
  week: { months: 0.23, active: 0.21 },
  month: { months: 1, active: 0.38 },
  quarter: { months: 3, active: 0.55 },
  ytd: { months: 11, active: 0.66 },
};

const arr = (a: Float64Array): number[] => Array.from(a);

/** Value of a running total at a fractional month index. */
function cumAt(a: readonly number[], x: number): number {
  const c = Math.max(0, Math.min(MONTH_COUNT - 1, x));
  const i = Math.floor(c);
  if (i >= MONTH_COUNT - 1) return a[MONTH_COUNT - 1]!;
  return a[i]! + (a[i + 1]! - a[i]!) * (c - i);
}

function dayLabel(daysBefore: number): string {
  const d = new Date(Date.UTC(2026, 10, 26 - daysBefore));
  return `${d.getUTCDate()} ${monthShort(`2026-${String(d.getUTCMonth() + 1).padStart(2, "0")}`)}`;
}

function totals(w: World, key: BrandId | "god"): number[] {
  const p = w.peopleByMonth[key];
  const b = w.businessesByMonth[key];
  return Array.from(p, (v, i) => v + b[i]!);
}

const txt = (text: string, counts: Record<string, RawCount> = {}): TextRaw => ({ text, counts });

const CHANGES: Change[] = [
  {
    severity: "info",
    title: txt("SnapApp receipts sent to Free Tax Returns reached {sent} in the last 7 days", { sent: count(1420) }),
    detail: txt("Highest week since launch"),
    pageId: "snapapp",
  },
  {
    severity: "ok",
    title: txt("Teen accounts that accepted the GOD notice rose to 94%"),
    detail: txt("Was 91% a month ago"),
    pageId: "teens",
  },
  {
    severity: "info",
    title: txt("YourTal grew fastest in Brisbane and the Gold Coast"),
    detail: txt("+9.4% and +8.8% this month"),
    pageId: "map",
  },
  {
    severity: "warn",
    title: txt("Free Tax Returns sync lag peaked at 5 min on Tuesday"),
    detail: txt("Back under 90 seconds since Wednesday"),
    pageId: "quality",
  },
  {
    severity: "ok",
    title: txt("Identity merge job linked {linked} more accounts by YourTal sign-in", { linked: count(212) }),
    detail: txt("{undone} merges undone by the data team", { undone: count(3) }),
    pageId: "quality",
  },
];

async function overview(q: { period: Period }): Promise<OverviewRaw> {
  const w = getWorld();
  const P = PERIOD[q.period];
  const last = CURRENT_INDEX;
  const people = arr(w.peopleByMonth.god);
  const biz = arr(w.businessesByMonth.god);
  const tot = totals(w, "god");

  const now = tot[last]!;
  const prior = cumAt(tot, last - P.months);
  const prior2 = cumAt(tot, last - 2 * P.months);
  const newByMonth = tot.map((v, i) => (i ? v - tot[i - 1]! : 0)).slice(1);

  const mc = w.peopleByMask;
  const one = mc[1]! + mc[2]! + mc[4]!;
  const two = mc[3]! + mc[5]! + mc[6]!;
  const three = mc[7]!;
  const all = one + two + three;

  // Growth chart: the x axis depends on the period, as in the approved design.
  const idx: number[] = [];
  const labels: string[] = [];
  const full: string[] = [];
  if (q.period === "week") {
    for (let i = 0; i < 12; i++) {
      idx.push(last - (11 - i) * 0.23);
      labels.push(dayLabel((11 - i) * 7));
      full.push(`Week to ${dayLabel((11 - i) * 7)}`);
    }
  } else if (q.period === "month") {
    for (let i = last - 11; i <= last; i++) {
      idx.push(i);
      labels.push(monthShort(MONTHS[i]!));
      full.push(monthLong(MONTHS[i]!));
    }
  } else if (q.period === "quarter") {
    for (const i of [0, 3, 6, 9, 12, 15, 18, 21, last]) {
      idx.push(i);
      labels.push(i === last ? "Nov (QTD)" : `${monthShort(MONTHS[i]!)} ${MONTHS[i]!.slice(2, 4)}`);
      full.push(i === last ? "26 Nov 2026" : `End of ${monthLong(MONTHS[i]!)}`);
    }
  } else {
    for (let i = 13; i <= last; i++) {
      idx.push(i);
      labels.push(monthShort(MONTHS[i]!));
      full.push(monthLong(MONTHS[i]!));
    }
  }
  const brandTot = { yourtal: totals(w, "yourtal"), snapapp: totals(w, "snapapp"), ftr: totals(w, "ftr") };
  const growth = {
    labels,
    full,
    series: [
      { id: "god", name: "GOD total", values: countSeries(idx.map((x) => Math.round(cumAt(tot, x)))) },
      { id: "yourtal", name: "YourTal", values: countSeries(idx.map((x) => Math.round(cumAt(brandTot.yourtal, x)))) },
      { id: "snapapp", name: "SnapApp", values: countSeries(idx.map((x) => Math.round(cumAt(brandTot.snapapp, x)))) },
      { id: "ftr", name: "Free Tax Returns", values: countSeries(idx.map((x) => Math.round(cumAt(brandTot.ftr, x)))) },
    ],
  };

  return {
    asOf: AS_OF,
    month: MONTHS[last]!,
    months: [...MONTHS],
    people: count(people[last]!),
    businesses: count(biz[last]!),
    peoplePrevMonth: count(people[last - 1]!),
    businessesPrevMonth: count(biz[last - 1]!),
    peopleSeries: countSeries(people),
    businessesSeries: countSeries(biz),
    completeProfiles: count(two + three),
    completeShare: (two + three) / all,
    newInPeriod: count(Math.max(0, now - prior)),
    newInPrevPeriod: count(Math.max(0, prior - prior2)),
    newByMonth: countSeries(newByMonth),
    activeInPeriod: count(Math.round(people[last]! * P.active)),
    activeShare: P.active,
    freshness: {
      syncedAgo: "Synced 3 min ago",
      sources: [
        { name: "YourTal", status: "ok" },
        { name: "SnapApp", status: "ok" },
        { name: "Free Tax Returns", status: "ok" },
      ],
    },
    growth,
    profileMix: {
      one: count(one),
      two: count(two),
      three: count(three),
      pairs: [
        { label: "YourTal + SnapApp", value: count(mc[3]! + mc[7]!) },
        { label: "YourTal + Free Tax Returns", value: count(mc[5]! + mc[7]!) },
        { label: "SnapApp + Free Tax Returns", value: count(mc[6]! + mc[7]!) },
        { label: "All three", value: count(mc[7]!) },
      ],
    },
    changes: CHANGES,
  };
}

function yourtal(q: { period: Period }): YourTalRaw {
  const w = getWorld();
  const m = PERIOD[q.period].months;
  const last = CURRENT_INDEX;
  const v = arr(w.peopleByMonth.yourtal);
  const b = arr(w.businessesByMonth.yourtal);
  const scale = v[last]! / 47800;
  const watches = trend(11, 52000 * scale, 138000 * scale);
  const points = trend(12, 1.5e6 * scale, 4.1e6 * scale);
  return {
    brand: "yourtal",
    months: [...MONTHS],
    viewers: count(v[last]!),
    viewersPrevMonth: count(v[last - 1]!),
    viewersSeries: countSeries(v),
    businesses: count(b[last]!),
    businessesPrevMonth: count(b[last - 1]!),
    businessesSeries: countSeries(b),
    liveCampaigns: count(214),
    campaignsStartedThisMonth: count(38),
    watchesInPeriod: count(Math.round(138000 * scale * m)),
    watchesSeries: countSeries(watches),
    completionRate: 0.71,
    pointsInPeriod: count(Math.round(4.1e6 * scale * m)),
    pointsSeries: countSeries(points),
    vouchersRedeemed: count(Math.round(2240 * scale * m)),
    vouchersClaimed: count(Math.round(5870 * scale * m)),
    voucherValueRedeemed: Math.round(28460 * scale * m),
    campaignsByCategory: [
      { label: "Food and drink", value: count(58) },
      { label: "Retail", value: count(41) },
      { label: "Health and beauty", value: count(37) },
      { label: "Services", value: count(29) },
      { label: "Travel and leisure", value: count(26) },
      { label: "Entertainment", value: count(23) },
    ],
    money: [
      { label: "Campaign budgets funded", amount: Math.round(311000 * scale * m) },
      { label: "Voucher value claimed", amount: Math.round(73400 * scale * m) },
      { label: "Voucher value redeemed", amount: Math.round(28460 * scale * m) },
    ],
    topCampaigns: [
      ["Harbour & Bean: a free flat white on Fridays", 12400, 0.88, 9100, 612],
      ["Coastline Grocers: scan three, win a trolley", 9800, 0.74, 7200, 340],
      ["Kidzone Play: weekend entry deal", 7100, 0.69, 5000, 288],
      ["Southern Cross Fuel: 6c a litre off", 6600, 0.81, 4400, 902],
      ["Tidewater Fashion: spring edit", 5200, 0.63, 3300, 141],
    ].map(([name, watchesN, completion, pointsN, redeemed]) => ({
      name: name as string,
      watches: count(watchesN as number),
      completion: completion as number,
      points: count(pointsN as number),
      redeemed: count(redeemed as number),
    })),
  };
}

function snapapp(q: { period: Period }): SnapAppRaw {
  const w = getWorld();
  const m = PERIOD[q.period].months;
  const last = CURRENT_INDEX;
  const personal = arr(w.peopleByMonth.snapapp);
  const business = arr(w.businessesByMonth.snapapp);
  const ws = personal.map((x, i) => x + business[i]!);
  const scale = ws[last]! / 21900;
  const receipts = trend(21, 61000 * scale, 168000 * scale);
  const sends = trend(22, 1500 * scale, 4900 * scale);
  const credits = trend(23, 1200 * scale, 3140 * scale);
  const spend: [string, number][] = [
    ["Groceries", 3.05],
    ["Fuel", 1.68],
    ["Retail", 1.46],
    ["Cafés & takeaway", 1.12],
    ["Pharmacy & health", 0.86],
    ["Entertainment", 0.63],
    ["Other", 0.6],
  ];
  return {
    brand: "snapapp",
    months: [...MONTHS],
    workspaces: count(ws[last]!),
    workspacesPrevMonth: count(ws[last - 1]!),
    workspacesSeries: countSeries(ws),
    personalWorkspaces: count(personal[last]!),
    businessWorkspaces: count(business[last]!),
    receiptsInPeriod: count(Math.round(168000 * scale * m)),
    receiptsSeries: countSeries(receipts),
    averageReceipt: 56,
    spendCaptured: Math.round(9.4e6 * scale * m),
    sendsToFtrInPeriod: count(Math.round(4900 * scale * m)),
    sendsSeries: countSeries(sends),
    sendShare: 0.058,
    creditPurchasesInPeriod: count(Math.round(3140 * scale * m)),
    creditPurchasesSeries: countSeries(credits),
    creditValue: Math.round(41860 * scale * m),
    spendByCategory: spend.map(([label, amountM]) => ({ label, amountM: amountM * scale })),
    packs: [
      { pack: "10 credits at A$4.99", sold: count(Math.round(1640 * scale)), value: Math.round(1640 * scale * 4.99) },
      { pack: "50 credits at A$19.99", sold: count(Math.round(1120 * scale)), value: Math.round(1120 * scale * 19.99) },
      { pack: "200 credits at A$59.99", sold: count(Math.round(380 * scale)), value: Math.round(380 * scale * 59.99) },
    ],
  };
}

function ftr(): FtrRaw {
  const w = getWorld();
  const last = CURRENT_INDEX;
  const acc = arr(w.peopleByMonth.ftr);
  const started = Math.round(acc[last]! * 0.651);
  const lodged = Math.round(started * 0.7535);
  const leads = Math.round(acc[last]! * 1.74);
  const newAcc = acc.map((x, i) => (i ? x - acc[i - 1]! : Math.round(x / 4)));
  return {
    brand: "ftr",
    months: [...MONTHS],
    leads: count(leads),
    accounts: count(acc[last]!),
    accountsPrevMonth: count(acc[last - 1]!),
    accountsSeries: countSeries(acc),
    newAccountsSeries: countSeries(newAcc),
    returnsStarted: count(started),
    returnsLodged: count(lodged),
    medianMinutesToLodge: 14,
    funnel: [
      { label: "Leads", value: count(leads) },
      { label: "Accounts", value: count(acc[last]!) },
      { label: "Returns started", value: count(started) },
      { label: "Returns lodged", value: count(lodged) },
    ],
    sources: [
      { label: "YourTal link", percent: 34 },
      { label: "SnapApp send", percent: 21 },
      { label: "Search", percent: 19 },
      { label: "Referral", percent: 11 },
      { label: "Social", percent: 9 },
      { label: "Direct", percent: 6 },
    ],
    occupations: [
      { label: "Hospitality and retail", percent: 24 },
      { label: "Healthcare and care", percent: 17 },
      { label: "Trades and construction", percent: 15 },
      { label: "Office and admin", percent: 14 },
      { label: "Education", percent: 9 },
      { label: "Students", percent: 12 },
      { label: "Other", percent: 9 },
    ],
    incomeBands: [
      { label: "Up to A$18,200", percent: 11 },
      { label: "A$18,201 to A$45,000", percent: 31 },
      { label: "A$45,001 to A$120,000", percent: 48 },
      { label: "A$120,001 to A$180,000", percent: 8 },
      { label: "Over A$180,000", percent: 2 },
    ],
  };
}

async function brand<B extends BrandId>(b: B, q: { period: Period }): Promise<BrandRawMap[B]> {
  const result = b === "yourtal" ? yourtal(q) : b === "snapapp" ? snapapp(q) : ftr();
  return result as BrandRawMap[B];
}

export const syntheticData: DashboardData = {
  overview,
  brand,
  influenceMap,
  mapSummary,
  mapArea,
  activityMap,
  activityHotspots,
  activityArea,
  ...syntheticPages,
};

/**
 * Build the sample and every index ahead of the first request (the server does this in the background at start, see
 * src/instrumentation.ts): the sample, the polygon index, the h3 indexes and the merchants. Afterwards every map
 * query is a scan.
 */
export function warmSynthetic(): void {
  warmMaps();
}
