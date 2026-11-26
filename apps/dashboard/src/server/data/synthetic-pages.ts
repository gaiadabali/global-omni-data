import {
  CURRENT_INDEX,
  INSIGHT_ENTITIES,
  MONTHS,
  allProfiles,
  audienceReport,
  generateProfileDetail,
  getWorld,
  insightEntity,
  isSensitiveEntity,
  mulberry32,
  teenEntities,
  teenMarket,
  trend,
  type ActivityMapDetail,
  type InsightEntity,
  type ProfileDetail,
} from "@god/synthetic";
import { TODAY } from "@/lib/dates";
import type { CountKind } from "../privacy";
import {
  count,
  countSeries,
  type AudienceReportRaw,
  type AudienceQuery,
  type CountRow,
  type DashboardData,
  type EntityRef,
  type InsightRaw,
  type PersonActivityRaw,
  type PersonGetRaw,
  type PersonProfileRaw,
  type PersonSearchRow,
  type QualityRaw,
  type TeensRaw,
} from "./types";

/**
 * The synthetic provider for the insight, teen market, Person 360, data quality and admin pages. Exact numbers;
 * the presentation layer thresholds them. Composed into `syntheticData` in ./synthetic.ts.
 */

const ref = (e: InsightEntity): EntityRef => ({
  id: e.id,
  name: e.name,
  kind: e.kind,
  group: e.group,
});

function godPeople(): number {
  return getWorld().peopleByMonth.god[CURRENT_INDEX]!;
}

function reportRaw(e: InsightEntity, teen: boolean): AudienceReportRaw {
  const r = audienceReport(e, { teen });
  const kind: CountKind = teen ? "teen" : isSensitiveEntity(e) ? "sensitive" : "adult";
  const rows = (xs: { label: string; n: number }[]): CountRow[] =>
    xs.map((x) => ({ label: x.label, value: count(x.n, kind) }));
  return {
    entity: ref(e),
    teen,
    asOf: TODAY,
    audience: count(r.audience, kind),
    months: r.months,
    audienceSeries: countSeries(r.series, kind),
    growth90: r.growth90,
    visitsPerMonth: r.visitsPerMonth,
    shareOfGod: r.audience / godPeople(),
    homeAreas: r.homeAreas.map((a) => ({
      name: a.name,
      postcode: a.postcode,
      state: a.state,
      people: count(a.n, kind),
    })),
    activityAreas: r.activityAreas.map((a) => ({
      name: a.name,
      postcode: a.postcode,
      state: a.state,
      people: count(a.n, kind),
    })),
    age: rows(r.age),
    occupation: rows(r.occupation),
    income: rows(r.income),
    segments: r.segments.map((s) => ({
      name: s.name,
      audience: count(s.n, kind),
      areaShare: s.areaShare,
      index: s.index,
    })),
    frequency: rows(r.frequency),
    spend: rows(r.spend),
    alsoShopsAt: rows(r.alsoShopsAt),
    godBrands: rows(r.godBrands),
    census: r.census,
  };
}

async function insight(q: AudienceQuery): Promise<InsightRaw> {
  const e = insightEntity(q.entity);
  if (!e) throw new RangeError(`unknown report: ${q.entity}`);
  return { entities: INSIGHT_ENTITIES.map(ref), report: reportRaw(e, false) };
}

async function teens(q: { entity?: string }): Promise<TeensRaw> {
  const id = q.entity ?? "kidzone";
  const e = insightEntity(id);
  if (!e) throw new RangeError(`unknown report: ${id}`);
  if (isSensitiveEntity(e))
    throw new RangeError("sensitive categories never appear in teen figures");

  const m = teenMarket();
  const teensTotal = getWorld().teenPeople;
  const series = trend(31, Math.round(teensTotal * 0.3), teensTotal, 0.02);
  series[series.length - 1] = teensTotal;
  const rows = (xs: { label: string; share: number }[]): CountRow[] =>
    xs.map((x) => ({ label: x.label, value: count(Math.round(x.share * teensTotal), "teen") }));
  return {
    entities: teenEntities().map(ref),
    report: reportRaw(e, true),
    teensInGod: count(teensTotal, "teen"),
    teensSeries: countSeries(series, "teen"),
    months: [...MONTHS],
    guardianNoticeShare: m.guardianNoticeShare,
    usesYourTalShare: m.usesYourTalShare,
    alsoSnapAppShare: m.alsoSnapAppShare,
    repeatRate: m.repeatRate,
    cameBackWithin30Days: m.cameBackWithin30Days,
    alsoVisitedCompetitor: m.alsoVisitedCompetitor,
    visitsPerActiveTeen: m.visitsPerActiveTeen,
    interestsDeclared: rows(m.interestsDeclared),
    interestsLearned: rows(m.interestsLearned),
    spendPerActiveTeen: m.spendPerActiveTeen,
    loyalty: rows(m.loyalty),
    brandMix: rows([
      { label: "YourTal only", share: 0.82 },
      { label: "YourTal and SnapApp", share: 0.14 },
      { label: "SnapApp only", share: 0.04 },
    ]),
  };
}

/* ---------------- Person 360 ---------------- */

const ID_SHAPE = /^G-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

async function personSearch(q: string): Promise<PersonSearchRow[]> {
  const key = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const out: PersonSearchRow[] = [];
  for (const p of allProfiles()) {
    const hay = p.id.replace(/-/g, "");
    if (key && !(hay.startsWith(key) || hay.slice(1).startsWith(key))) continue;
    out.push(
      p.teen
        ? { id: p.id, teen: true }
        : { id: p.id, teen: false, ageBand: p.ageBand, brands: [...p.brands] },
    );
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** The activity map with every receipt count marked as a count, so the presentation layer thresholds it. */
function activityRaw(a: ActivityMapDetail): PersonActivityRaw {
  return {
    ...a,
    totalReceipts: count(a.totalReceipts),
    areas: a.areas.map((x) => ({
      ...x,
      receipts: count(x.receipts),
      categories: x.categories.map((c) => ({ ...c, receipts: count(c.receipts) })),
    })),
    points: a.points.map((p) => ({ ...p, receipts: count(p.receipts) })),
  };
}

function profileRaw(d: ProfileDetail): PersonProfileRaw {
  return { ...d, activity: d.activity ? activityRaw(d.activity) : null };
}

/** A teen id returns `{ kind: "teen" }` and nothing else. No code path here turns a teen profile into a body. */
async function personGet(id: string): Promise<PersonGetRaw> {
  const key = id.trim().toUpperCase();
  if (!ID_SHAPE.test(key)) return { kind: "not-found" };
  const p = allProfiles().find((x) => x.id === key);
  if (!p) return { kind: "not-found" };
  if (p.teen) return { kind: "teen", id: p.id };
  return { kind: "profile", profile: profileRaw(generateProfileDetail(p, TODAY)) };
}

/* ---------------- Data quality ---------------- */

async function quality(): Promise<QualityRaw> {
  const w = getWorld();
  const people = (b: "yourtal" | "snapapp" | "ftr") => w.peopleByMonth[b][CURRENT_INDEX]!;
  const biz = (b: "yourtal" | "snapapp" | "ftr") => w.businessesByMonth[b][CURRENT_INDEX]!;
  const peopleAll = godPeople();

  const lagR = mulberry32(5);
  const lag = (base: number) =>
    Array.from({ length: 24 }, () => Math.round(base * (0.6 + lagR() * 0.9)));
  const row = (app: string, table: string, inGod: number, inApp: number) => ({
    app,
    table,
    inGod: count(inGod),
    inApp: count(inApp),
  });
  const sampled = (
    id: string,
    ran: string,
    destroyOn: string,
    result: "ok" | "warn",
    detail: string,
    approvers: string[],
  ) => ({
    id,
    kind: "sampled" as const,
    check: "Monthly sampled run: 20 real teens",
    ran,
    result,
    detail,
    approvers,
    destroyOn,
    destroyed: destroyOn <= TODAY,
  });
  const fixture = (id: string, check: string, detail: string) => ({
    id,
    kind: "synthetic" as const,
    check,
    ran: "2026-11-26T03:10:00+11:00",
    result: "ok" as const,
    detail,
    approvers: [] as string[],
    destroyOn: null,
    destroyed: false,
  });

  return {
    asOf: TODAY,
    lag: [
      { source: "YourTal", seconds: 42, status: "ok", series: lag(42) },
      { source: "SnapApp", seconds: 71, status: "ok", series: lag(71) },
      { source: "Free Tax Returns", seconds: 312, status: "warn", series: lag(312) },
    ],
    rows: [
      row("YourTal", "Viewers", people("yourtal"), people("yourtal")),
      row("YourTal", "Businesses", biz("yourtal"), biz("yourtal")),
      row("YourTal", "Watch events", 612408, 612411),
      row(
        "SnapApp",
        "Workspaces",
        people("snapapp") + biz("snapapp"),
        people("snapapp") + biz("snapapp"),
      ),
      row("SnapApp", "Receipts", 1984310, 1984310),
      row("Free Tax Returns", "Accounts", people("ftr"), people("ftr")),
      row("Free Tax Returns", "Returns lodged", 4611, 4613),
    ],
    geocoding: [
      { label: "Address", value: count(Math.round(peopleAll * 0.61)) },
      { label: "Suburb", value: count(Math.round(peopleAll * 0.29)) },
      { label: "Postcode", value: count(Math.round(peopleAll * 0.1)) },
    ],
    merges: { bySignIn: count(5912), byEmail: count(2104), undone: count(7) },
    jobs: [
      {
        name: "sync-yourtal",
        schedule: "every 1 min",
        lastRun: "2026-11-26T14:48:00+11:00",
        duration: "4.1 s",
        result: "ok",
      },
      {
        name: "sync-snapapp",
        schedule: "every 1 min",
        lastRun: "2026-11-26T14:48:00+11:00",
        duration: "6.8 s",
        result: "ok",
      },
      {
        name: "sync-ftr",
        schedule: "every 1 min",
        lastRun: "2026-11-26T14:47:00+11:00",
        duration: "11.3 s",
        result: "warn",
      },
      {
        name: "geocode-batch",
        schedule: "every 15 min",
        lastRun: "2026-11-26T14:45:00+11:00",
        duration: "48 s",
        result: "ok",
      },
      {
        name: "identity-merge",
        schedule: "hourly",
        lastRun: "2026-11-26T14:00:00+11:00",
        duration: "2 min 12 s",
        result: "ok",
      },
      {
        name: "build-affinities",
        schedule: "nightly",
        lastRun: "2026-11-26T02:10:00+11:00",
        duration: "9 min 41 s",
        result: "ok",
      },
      {
        name: "build-map-tiles",
        schedule: "nightly",
        lastRun: "2026-11-26T02:30:00+11:00",
        duration: "6 min 5 s",
        result: "ok",
      },
      {
        name: "export-audit-archive",
        schedule: "nightly",
        lastRun: "2026-11-25T23:55:00+11:00",
        duration: "37 s",
        result: "crit",
      },
    ],
    verification: [
      fixture(
        "v-f1",
        "Teen aged 17 turns 18 mid-month",
        "Moves to the adult band; the profile stays closed until re-verified",
      ),
      fixture("v-f2", "Teen account with no guardian notice", "Excluded from every count"),
      fixture(
        "v-f3",
        "Group of 19 teens in one area",
        'Printed as "<20" for every role, the Owner included',
      ),
      fixture(
        "v-f4",
        "Teen id typed into Person 360 search",
        "Refused and logged; no profile body exists to return",
      ),
      fixture(
        "v-f5",
        "Pharmacy and health in a teen report",
        "Not reported: sensitive categories never appear in teen figures",
      ),
      sampled(
        "v-s-2026-11",
        "2026-11-19T03:20:00+11:00",
        "2026-11-26",
        "warn",
        "20 of 20 had a guardian notice on file. 0 leaks in 41 files. 2 rows had learned interests set by a test import; removed, and the rerun passed.",
        ["Alex Morgan (Owner)", "Jordan Lee (Data team)"],
      ),
      sampled(
        "v-s-2026-10",
        "2026-10-15T03:20:00+11:00",
        "2026-10-22",
        "ok",
        "20 of 20 had a guardian notice on file. 0 leaks in 38 files.",
        ["Alex Morgan (Owner)", "Priya Nair (Executive)"],
      ),
      sampled(
        "v-s-2026-09",
        "2026-09-17T03:20:00+11:00",
        "2026-09-24",
        "ok",
        "20 of 20 had a guardian notice on file. 0 leaks in 35 files.",
        ["Alex Morgan (Owner)", "Priya Nair (Executive)"],
      ),
      {
        id: "v-s-2026-12",
        kind: "sampled",
        check: "Monthly sampled run: 20 real teens",
        ran: "2026-12-17T03:20:00+11:00",
        result: "pending",
        detail: "Scheduled. It runs only when the Owner and a second approver have both approved.",
        approvers: [],
        destroyOn: "2026-12-24",
        destroyed: false,
      },
    ],
  };
}

export const syntheticPages: Pick<
  DashboardData,
  "insight" | "teens" | "personSearch" | "personGet" | "quality"
> = {
  insight,
  teens,
  personSearch,
  personGet,
  quality,
};
