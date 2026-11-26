import { placeName, STATE_CODES, type StateCode } from "./geo";
import { mulberry32 } from "./rng";
import { AGE_BANDS, BRANDS, MONTHS, type BrandId, type World } from "./world";

/** No 0, 1, I, L or O, so an id can be read aloud. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Pseudonymous: a GOD id only. No name, email, phone or exact address. */
export interface AdultProfile {
  id: string;
  teen: false;
  brands: BrandId[];
  /** Month ("YYYY-MM") each brand was joined. */
  joined: Partial<Record<BrandId, string>>;
  ageBand: string;
  state: StateCode;
  /** A suburb or town label, never an address. */
  area: string;
  /** Whether the person finished a profile in each brand they belong to. */
  complete: Partial<Record<BrandId, boolean>>;
  linkedBy: "YourTal sign-in" | "Verified email" | "Verified mobile";
  mergeConfidence: "high" | "medium";
  lastSeen: string;
}

/** A teen profile has no body at all: it is never openable. */
export interface TeenProfile {
  id: string;
  teen: true;
}

export type Profile = AdultProfile | TeenProfile;

function makeId(rnd: () => number): string {
  const part = (n: number) => Array.from({ length: n }, () => ALPHABET[Math.floor(rnd() * ALPHABET.length)]).join("");
  return `G-${part(4)}-${part(4)}`;
}

/** About 200 pseudonymous profiles, drawn from the world's people. Deterministic. */
export function generateProfiles(world: World, count = 200, seed = 9): Profile[] {
  const rnd = mulberry32(seed);
  const out: Profile[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (out.length < count && guard++ < count * 50) {
    const i = Math.floor(rnd() * world.n);
    if (world.isBusiness[i]) continue;
    let id = makeId(rnd);
    while (seen.has(id)) id = makeId(rnd);
    seen.add(id);
    if (world.age[i] === 0) {
      out.push({ id, teen: true });
      continue;
    }
    const brands: BrandId[] = [];
    const joined: Partial<Record<BrandId, string>> = {};
    const complete: Partial<Record<BrandId, boolean>> = {};
    BRANDS.forEach((b, bi) => {
      if (!(world.mask[i]! & (1 << bi))) return;
      brands.push(b);
      joined[b] = MONTHS[world.join[bi]![i]!];
      complete[b] = rnd() < 0.78;
    });
    const linkedBy = brands.length > 1 ? (rnd() < 0.6 ? "YourTal sign-in" : rnd() < 0.5 ? "Verified email" : "Verified mobile") : "YourTal sign-in";
    out.push({
      id,
      teen: false,
      brands,
      joined,
      ageBand: AGE_BANDS[world.age[i]!]!,
      state: STATE_CODES[world.state[i]!]!,
      area: placeName(world.lat[i]!, world.lon[i]!),
      complete,
      linkedBy,
      mergeConfidence: brands.length > 1 && rnd() < 0.25 ? "medium" : "high",
      lastSeen: MONTHS[Math.max(0, MONTHS.length - 1 - Math.floor(rnd() * rnd() * 6))]!,
    });
  }
  return out;
}
