import { findSuburbs, nearestSa2 } from "@god/geo";
import { CITIES, STATE_CODES, SUBURBS, kmBetween } from "./geo";
import { generateMerchants, type Merchant } from "./merchants";
import { buildActivityMap, MAX_HOME_SA2_KM2, type ActivityMapDetail, type MapReceipt } from "./person-map";
import { hash01, mulberry32, type Rng } from "./rng";
import { generateProfiles, type AdultProfile, type Profile } from "./profiles";
import { CATEGORIES, getWorld, type BrandId } from "./world";

/**
 * Person 360 detail for ONE adult profile: linked accounts, a timeline, receipt locations, activity areas and
 * interests. Pseudonymous: a GOD id and a band, never a name, email, phone or address. Deterministic.
 *
 * There is deliberately no function here that takes a teen profile: a teen profile has no body (see TeenProfile).
 * Sensitive categories (pharmacy and health) are left out of person-level receipts altogether.
 */

export interface PersonAccount {
  brand: BrandId;
  /** Month the account was opened, "YYYY-MM". */
  since: string;
  /** How this account was joined to the first one, or null for the first account. */
  linkedBy: AdultProfile["linkedBy"] | null;
  complete: boolean;
}

export interface TimelineEvent {
  /** "YYYY-MM-DD" */
  date: string;
  title: string;
  detail: string;
}

export interface ReceiptPlace {
  merchant: string;
  suburb: string;
  state: string;
  category: string;
  /** Receipts at this merchant and suburb in the last 90 days (one person's own history, not an aggregate). */
  receipts: number;
  lastVisit: string;
}

export interface PersonInterest {
  label: string;
  kind: "Declared" | "Learned";
  source: string;
  /** 0 to 100 */
  confidence: number;
}

export interface ProfileDetail {
  id: string;
  ageBand: string;
  homeArea: string;
  state: string;
  accounts: PersonAccount[];
  occupation: { title: string; group: string; incomeBand: string } | null;
  mergeConfidence: AdultProfile["mergeConfidence"];
  linkedBy: AdultProfile["linkedBy"];
  lastSeen: string;
  timeline: TimelineEvent[];
  places: ReceiptPlace[];
  /** Where the receipts cluster (fenced areas) and the ones that fit no area. Suburb precision: see person-map.ts. */
  activity: ActivityMapDetail | null;
  interests: PersonInterest[];
}

const OCC: readonly (readonly [string, string])[] = [
  ["Registered nurse", "Healthcare and care"],
  ["Electrician", "Trades and construction"],
  ["Primary school teacher", "Education"],
  ["Café supervisor", "Hospitality and retail"],
  ["Office administrator", "Office and admin"],
  ["Carpenter", "Trades and construction"],
  ["University student", "Students"],
  ["Aged care worker", "Healthcare and care"],
  ["Retail team leader", "Hospitality and retail"],
  ["Bookkeeper", "Office and admin"],
  ["Plumber", "Trades and construction"],
  ["Warehouse operator", "Other"],
];
const INCOMES = ["Up to A$18,200", "A$18,201–45,000", "A$45,001–120,000", "A$45,001–120,000", "A$120,001–180,000"];
const DECLARED = ["Coffee", "Running", "Fishing", "Reading", "Cooking", "Cycling", "Gaming", "Gardening", "Camping"];
const CAMPAIGNS = [
  "Harbour & Bean: a free flat white on Fridays",
  "Coastline Grocers: scan three, win a trolley",
  "Kidzone Play: weekend entry deal",
  "Southern Cross Fuel: 6c a litre off",
  "Tidewater Fashion: spring edit",
];
const LEARNED_BY_CATEGORY: Record<string, string> = {
  fuel: "Fuel savings",
  groc: "Budget groceries",
  cafe: "Cafés",
  retail: "Home renovation",
  ent: "Family days out",
};
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-24" gives "24 Nov 2026". Kept here so the text never depends on a locale. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTH_NAMES[Number(m) - 1] ?? ""} ${y}`;
}

function isoDay(base: Date, minusDays: number): string {
  const d = new Date(base.getTime() - minusDays * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Where a profile's home label points: a real suburb or a city, from the label ("Around X, ST" or "... near X"). */
function homeOf(area: string): { lat: number; lon: number } {
  const near = /near (.+)$/.exec(area)?.[1];
  const around = /^Around ([^,]+)(?:, ([A-Z]+))?/.exec(area);
  const name = (near ?? around?.[1] ?? "").trim();
  const real = findSuburbs(name, near ? undefined : around?.[2]);
  if (real.length) return { lat: real[0]!.lat, lon: real[0]!.lon };
  const sub = SUBURBS.find((s) => s[0] === name);
  if (sub) return { lat: sub[3], lon: sub[2] };
  const city = CITIES.find((c) => c.name === name) ?? CITIES[0]!;
  return { lat: city.lat, lon: city.lon };
}

function pick<T>(r: Rng, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)]!;
}

function money(r: Rng, lo: number, hi: number): string {
  return `A$${(lo + r() * (hi - lo)).toFixed(2)}`;
}

let nonSensitive: readonly Merchant[] | null = null;
/** Every merchant outside the sensitive categories (pharmacy and health), built once. */
function shops(): readonly Merchant[] {
  nonSensitive ??= generateMerchants().filter((m) => !CATEGORIES[m.category]!.sensitive);
  return nonSensitive;
}

/** Merchants within `radiusKm` of a point, nearest first. */
function within(lat: number, lon: number, radiusKm: number): Merchant[] {
  return shops()
    .map((m) => ({ m, km: kmBetween(lat, lon, m.lat, m.lon) }))
    .filter((s) => s.km <= radiusKm)
    .sort((a, b) => a.km - b.km || a.m.id.localeCompare(b.m.id))
    .map((s) => s.m);
}

function shuffled<T>(r: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** An anchor shop between `lo` and `hi` km from home with at least three shops within 3.5 km of it, and those shops. */
function pickAnchor(
  r: Rng,
  home: { lat: number; lon: number },
  lo: number,
  hi: number,
  avoid: { lat: number; lon: number } | null,
): { lat: number; lon: number; pool: Merchant[] } | null {
  const cands = shuffled(
    r,
    shops().filter((m) => {
      const d = kmBetween(home.lat, home.lon, m.lat, m.lon);
      return d >= lo && d <= hi && (!avoid || kmBetween(avoid.lat, avoid.lon, m.lat, m.lon) >= 15);
    }),
  ).slice(0, 25);
  for (const c of cands) {
    const pool = within(c.lat, c.lon, 3.5);
    if (pool.length >= 3) return { lat: c.lat, lon: c.lon, pool };
  }
  return null;
}

type DayRule = "any" | "weekday" | "weekend";

function dayFor(r: Rng, today: Date, rule: DayRule): string {
  let iso = isoDay(today, Math.floor(r() * 88));
  for (let t = 0; t < 14; t++) {
    const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    if (rule === "any" || (rule === "weekend") === weekend) return iso;
    iso = isoDay(today, Math.floor(r() * 88));
  }
  return iso;
}

/** `n` receipts at the shops of one pool. The first three shops are always used, so the area has three places. */
function receiptsAt(r: Rng, today: Date, pool: readonly Merchant[], n: number, rule: DayRule): { m: Merchant; date: string }[] {
  const near = shuffled(r, pool.slice(0, 8));
  const out: { m: Merchant; date: string }[] = [];
  for (let i = 0; i < n; i++) {
    const m = i < 3 && near.length >= 3 ? near[i]! : near[Math.floor(r() * r() * near.length)]!;
    out.push({ m, date: dayFor(r, today, rule) });
  }
  return out;
}

export function generateProfileDetail(p: AdultProfile, asOf = "2026-11-26", opts: { skipContext?: boolean } = {}): ProfileDetail {
  const r = mulberry32(Math.floor(hash01(p.id) * 2147483647));
  const today = new Date(`${asOf}T00:00:00Z`);
  const home = homeOf(p.area);
  const hasYt = p.brands.includes("yourtal");
  const hasSa = p.brands.includes("snapapp");
  const hasFtr = p.brands.includes("ftr");

  const accounts: PersonAccount[] = [...p.brands]
    .sort((a, b) => (p.joined[a] ?? "").localeCompare(p.joined[b] ?? ""))
    .map((brand, i) => ({
      brand,
      since: p.joined[brand] ?? "",
      linkedBy: i === 0 ? null : p.linkedBy,
      complete: p.complete[brand] === true,
    }));

  const occ = hasFtr ? pick(r, OCC) : null;
  const occupation = occ ? { title: occ[0], group: occ[1], incomeBand: pick(r, INCOMES) } : null;

  // Receipts: SnapApp people only, over 90 days. A home pattern, usually a work pattern on weekdays and a weekend
  // pattern, and now and then a receipt far away (a trip). Shops are real merchants; people are not.
  const made: { m: Merchant; date: string }[] = [];
  let declaredSa2: string | null = null;
  if (hasSa) {
    const homeSa2 = hasFtr ? nearestSa2(home.lon, home.lat) : null;
    // Free Tax Returns holds a declared postcode, which gives the home area its SA2 (when it is about suburb size).
    if (homeSa2 && homeSa2.areaKm2 <= MAX_HOME_SA2_KM2) declaredSa2 = homeSa2.id;
    let homePool = within(home.lat, home.lon, 4);
    // With a declared SA2, the home shops are the ones inside it.
    const inside = homePool.filter((m) => m.sa2 === declaredSa2);
    if (declaredSa2 && inside.length >= 3) homePool = inside;
    if (homePool.length < 3) homePool = within(home.lat, home.lon, 60).slice(0, 6);
    if (homePool.length) made.push(...receiptsAt(r, today, homePool, 14 + Math.floor(r() * 14), "any"));
    const work = r() < 0.85 ? pickAnchor(r, home, 15, 35, null) : null;
    if (work) made.push(...receiptsAt(r, today, work.pool, 8 + Math.floor(r() * 12), "weekday"));
    const weekend = r() < 0.8 ? pickAnchor(r, home, 14, 55, work) : null;
    if (weekend) made.push(...receiptsAt(r, today, weekend.pool, 6 + Math.floor(r() * 9), "weekend"));
    // A trip: one to four receipts a long way from every area, in one town or two.
    const away = r() < 0.9 ? 1 + Math.floor(r() * 4) : 0;
    if (away) {
      const anchors = [home, work, weekend].filter((a): a is { lat: number; lon: number } => a !== null);
      const far = shops().filter((m) => anchors.every((a) => kmBetween(a.lat, a.lon, m.lat, m.lon) >= 40));
      const regional = far.filter((m) => kmBetween(home.lat, home.lon, m.lat, m.lon) <= 300);
      const base = r() < 0.55 && regional.length ? regional : far;
      const trip = base.length ? base[Math.floor(r() * base.length)]! : null;
      if (trip) {
        const nearTrip = base.filter((m) => kmBetween(trip.lat, trip.lon, m.lat, m.lon) <= 15);
        for (let i = 0; i < away; i++) {
          const m = i === 0 || r() < 0.5 ? trip : (nearTrip[Math.floor(r() * nearTrip.length)] ?? trip);
          made.push({ m, date: dayFor(r, today, "any") });
        }
      }
    }
  }
  const places = new Map<string, ReceiptPlace>();
  for (const { m, date } of made) {
    const cat = CATEGORIES[m.category]!;
    const key = `${m.chain}|${m.suburb}`;
    const hit = places.get(key);
    if (hit) {
      hit.receipts += 1;
      if (date > hit.lastVisit) hit.lastVisit = date;
    } else {
      places.set(key, {
        merchant: m.chain,
        suburb: m.suburb,
        state: STATE_CODES[m.state] ?? "",
        category: cat.id,
        receipts: 1,
        lastVisit: date,
      });
    }
  }
  const receiptEvents: TimelineEvent[] = [...made]
    .sort((a, b) => b.date.localeCompare(a.date) || a.m.id.localeCompare(b.m.id))
    .slice(0, 4)
    .map(({ m, date }) => {
      const cat = CATEGORIES[m.category]!;
      return {
        date,
        title: "Scanned a receipt",
        detail: `${m.chain}, ${m.suburb} · ${money(r, 6, cat.id === "groc" ? 180 : cat.id === "fuel" ? 110 : 60)} · ${cat.name}`,
      };
    });
  const placeList = [...places.values()].sort((a, b) => b.receipts - a.receipts || a.merchant.localeCompare(b.merchant));

  const events: TimelineEvent[] = [...receiptEvents];
  if (hasYt) {
    events.push({
      date: isoDay(today, 1 + Math.floor(r() * 30)),
      title: "Watched a campaign to the end",
      detail: `${pick(r, CAMPAIGNS)} · +${20 + Math.floor(r() * 5) * 10} points`,
    });
    if (r() < 0.6) {
      events.push({
        date: isoDay(today, 20 + Math.floor(r() * 40)),
        title: "Redeemed a voucher",
        detail: `${pick(r, ["Harbour & Bean", "Coastline Grocers", "Kidzone Play"])} · A$5 (simulated)`,
      });
    }
  }
  if (hasSa && hasFtr) {
    events.push({
      date: isoDay(today, 8 + Math.floor(r() * 25)),
      title: `Sent ${3 + Math.floor(r() * 8)} receipts to Free Tax Returns`,
      detail: "Work expenses",
    });
  }
  if (hasFtr && p.complete.ftr === true) {
    events.push({ date: isoDay(today, 12 + Math.floor(r() * 30)), title: "Lodged a tax return", detail: "2025–26, Free Tax Returns" });
  }
  events.sort((a, b) => b.date.localeCompare(a.date));

  // Activity areas and outliers, at suburb precision (cells about 2 km across, or the declared home SA2).
  const activity = made.length
    ? buildActivityMap(
        made.map(
          ({ m, date }): MapReceipt => ({
            merchantId: m.id,
            merchant: m.name,
            suburb: m.suburb,
            suburbCode: m.suburbCode,
            state: STATE_CODES[m.state] ?? "",
            sa2: m.sa2,
            category: CATEGORIES[m.category]!.id,
            categoryName: CATEGORIES[m.category]!.name,
            date,
            lat: m.lat,
            lon: m.lon,
          }),
        ),
        { lat: home.lat, lon: home.lon, declaredSa2, ...(opts.skipContext ? { skipContext: true } : {}) },
      )
    : null;

  // Interests: declared in a profile, learned from receipts and campaigns.
  const interests: PersonInterest[] = [];
  if (hasYt || hasSa) {
    interests.push({
      label: pick(r, DECLARED),
      kind: "Declared",
      source: hasYt ? "YourTal profile" : "SnapApp profile",
      confidence: 100,
    });
  }
  const byCat = new Map<string, number>();
  for (const pl of placeList) byCat.set(pl.category, (byCat.get(pl.category) ?? 0) + pl.receipts);
  for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    const label = LEARNED_BY_CATEGORY[cat];
    if (!label) continue;
    interests.push({
      label,
      kind: "Learned",
      source: `${CATEGORIES.find((c) => c.id === cat)?.name ?? cat} receipts, ${n} in 90 days`,
      confidence: Math.min(95, 55 + n * 8 + Math.floor(r() * 10)),
    });
  }
  if (hasYt && interests.length < 3) {
    interests.push({
      label: "Local deals",
      kind: "Learned",
      source: `Watches of campaigns, ${6 + Math.floor(r() * 10)} in 90 days`,
      confidence: 60 + Math.floor(r() * 25),
    });
  }

  return {
    id: p.id,
    ageBand: p.ageBand,
    homeArea: p.area,
    state: p.state,
    accounts,
    occupation,
    mergeConfidence: p.mergeConfidence,
    linkedBy: p.linkedBy,
    lastSeen: p.lastSeen,
    timeline: events.slice(0, 8),
    places: placeList,
    activity,
    interests,
  };
}

/* ---------------- the profile set, and what may leave it ---------------- */

let cached: readonly Profile[] | null = null;

/** The 200 synthetic profiles (about 9% are teens), built once. */
export function allProfiles(): readonly Profile[] {
  if (!cached) cached = generateProfiles(getWorld());
  return cached;
}

/** The first adult with all three brands (the richest profile) and the first teen. For fixtures and screenshots. */
export function featuredProfiles(): { adult: AdultProfile; teen: string } {
  const list = allProfiles();
  const adults = list.filter((p): p is AdultProfile => !p.teen);
  const adult = adults.find((p) => p.brands.length === 3) ?? adults.find((p) => p.brands.length === 2) ?? adults[0]!;
  const teen = list.find((p) => p.teen)?.id ?? "";
  return { adult, teen };
}

/**
 * The adult whose activity map shows the most (three areas, a few outliers, one of them far, a declared home
 * outline). For fixtures and screenshots; the first best one, so it is stable. Null when nobody has receipts.
 */
let mapProfile: { p: AdultProfile | null } | null = null;
export function featuredMapProfile(): AdultProfile | null {
  if (mapProfile) return mapProfile.p;
  let best: { p: AdultProfile; score: number } | null = null;
  for (const p of allProfiles()) {
    if (p.teen) continue;
    const a = generateProfileDetail(p, "2026-11-26", { skipContext: true }).activity;
    if (!a) continue;
    const far = Math.max(0, ...a.outliers.map((o) => o.distanceKm));
    const score =
      (a.areas.length === 3 ? 4 : a.areas.length) +
      (a.outliers.length >= 2 ? 2 : a.outliers.length) +
      (far >= 100 ? 2 : 0) +
      (far >= 500 ? 1 : 0) +
      (a.areas.some((x) => x.basis === "declared") ? 1 : 0);
    if (!best || score > best.score) best = { p, score };
  }
  mapProfile = { p: best?.p ?? null };
  return mapProfile.p;
}
