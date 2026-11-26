import { CITIES, STATE_CODES, SUBURBS, kmBetween, nearestPlace } from "./geo";
import { generateMerchants, type Merchant } from "./merchants";
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

export interface ActivityArea {
  label: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

export interface ShopDot {
  lat: number;
  lon: number;
  label: string;
  category: string;
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
  dots: ShopDot[];
  areas: ActivityArea[];
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

/** Where a profile's home label points: a suburb or a city, from the label ("Around X, ST" or "... near X"). */
function homeOf(area: string): { lat: number; lon: number } {
  const near = /near (.+)$/.exec(area)?.[1];
  const around = /^Around ([^,]+)/.exec(area)?.[1];
  const name = (near ?? around ?? "").trim();
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

/** Non-sensitive merchants near a point, nearest first. */
function merchantsNear(lat: number, lon: number): Merchant[] {
  const all = generateMerchants().filter((m) => !CATEGORIES[m.category]!.sensitive);
  const scored = all.map((m) => ({ m, km: kmBetween(lat, lon, m.lat, m.lon) })).sort((a, b) => a.km - b.km);
  const near = scored.filter((s) => s.km <= 25);
  return (near.length >= 4 ? near : scored.slice(0, 6)).slice(0, 12).map((s) => s.m);
}

export function generateProfileDetail(p: AdultProfile, asOf = "2026-11-26"): ProfileDetail {
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

  // Receipts: SnapApp people only. A handful of shops near home, visited more or less often.
  const shops = hasSa ? merchantsNear(home.lat + (r() - 0.5) * 0.03, home.lon + (r() - 0.5) * 0.03).slice(0, 7) : [];
  const places = new Map<string, ReceiptPlace>();
  const receiptEvents: TimelineEvent[] = [];
  if (shops.length) {
    const n = 5 + Math.floor(r() * 9);
    for (let i = 0; i < n; i++) {
      const m = shops[Math.floor(r() * r() * shops.length)]!;
      const cat = CATEGORIES[m.category]!;
      const suburb = nearestPlace(m.lat, m.lon).name || "Nearby";
      const date = isoDay(today, Math.floor(r() * 88));
      const key = `${m.chain}|${suburb}`;
      const hit = places.get(key);
      if (hit) {
        hit.receipts += 1;
        if (date > hit.lastVisit) hit.lastVisit = date;
      } else {
        places.set(key, {
          merchant: m.chain,
          suburb,
          state: STATE_CODES[m.state] ?? "",
          category: cat.id,
          receipts: 1,
          lastVisit: date,
        });
      }
      if (i < 4) {
        receiptEvents.push({
          date,
          title: "Scanned a receipt",
          detail: `${m.chain}, ${suburb} · ${money(r, 6, cat.id === "groc" ? 180 : cat.id === "fuel" ? 110 : 60)} · ${cat.name}`,
        });
      }
    }
  }
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

  // Activity areas: home, plus a work area and a weekend area when there is receipt history.
  const areas: ActivityArea[] = [{ label: "Home area", lat: home.lat, lon: home.lon, radiusKm: 2 + Math.round(r() * 15) / 10 }];
  const dots: ShopDot[] = shops
    .filter((m) => placeList.some((pl) => pl.merchant === m.chain))
    .map((m) => ({
      lat: m.lat,
      lon: m.lon,
      label: `${m.chain}, ${nearestPlace(m.lat, m.lon).name}`,
      category: CATEGORIES[m.category]!.id,
    }));
  if (dots.length >= 2) {
    const far = [...dots].sort((a, b) => kmBetween(home.lat, home.lon, b.lat, b.lon) - kmBetween(home.lat, home.lon, a.lat, a.lon));
    areas.push({ label: "Work area", lat: far[0]!.lat, lon: far[0]!.lon, radiusKm: 2 + Math.round(r() * 20) / 10 });
    if (dots.length >= 4) {
      const w = far[Math.floor(far.length / 2)]!;
      areas.push({ label: "Weekend area", lat: w.lat, lon: w.lon, radiusKm: 2.5 });
    }
  }

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
    dots,
    areas,
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
