/**
 * The four GOD brands, in one place for the home page, the brands overview, the brand pages and the footer.
 * Every line here comes from the brand's own repo or live site; REDESIGN.md §6 lists the source of each.
 * This file is also the only place a brand's own web address is written. SnapApps and YourTal are staging hosts
 * today, so a final domain is a one-line change here. Brand colours live in `styles/brands.css`.
 */
export type BrandKey = "yourtal" | "snapapp" | "ftr" | "spambank";

export type BrandStatus = "live" | "beta" | "review";

export interface Brand {
  key: BrandKey;
  name: string;
  /**
   * "app" is a product with its own site and its own data that feeds GOD (YourTal, SnapApps, Free Tax Returns).
   * "feature" lives inside the apps and has no site of its own (Spambank): its page on this site is its website.
   */
  kind: "app" | "feature";
  /** This site's page about the brand. */
  page: string;
  /** The brand's own site, or null for a feature that has none (then see `availableIn`). */
  href: string | null;
  host: string | null;
  /** For a feature with no site: the brands it can be used in. */
  availableIn?: BrandKey[];
  /** A second address that is the product itself rather than its marketing site (SnapApps' web app). */
  webApp?: { href: string; host: string };
  /** The brand's own tagline, quoted as it writes it. */
  tagline: string;
  /** Two plain sentences on what it does. */
  summary: string;
  /** Who it serves, in a few words. */
  serves: string;
  facts: [string, string];
  status: { kind: BrandStatus; label: string };
  /** What the brand contributes to GOD's aggregate picture. */
  adds: string;
}

export const BRANDS: Brand[] = [
  {
    key: "yourtal",
    name: "YourTal",
    kind: "app",
    page: "/brands/yourtal/",
    href: "https://yourtal.gaiada.com",
    host: "yourtal.gaiada.com",
    tagline: "Watch, learn, earn — and spend it where you live.",
    summary:
      "Short videos from local businesses. Viewers answer a question or two, earn points and spend them on vouchers at the businesses they watched.",
    serves: "Viewers and local businesses",
    facts: [
      "Teens join from 13 with a guardian's approval",
      "Businesses only ever see grouped results",
    ],
    status: { kind: "review", label: "In staging review" },
    adds: "Declared interests, area by postcode, age band, and what people choose to watch",
  },
  {
    key: "snapapp",
    name: "SnapApps",
    kind: "app",
    page: "/brands/snapapp/",
    href: "https://snapapp.gaiada.com",
    host: "snapapp.gaiada.com",
    webApp: { href: "https://app.snapapps.gaiada.com", host: "app.snapapps.gaiada.com" },
    tagline: "The receipt app that reads every line.",
    summary:
      "Photograph a docket and SnapApps reads each line, splits GST-free from taxable, checks it is a valid tax invoice and keeps a true copy for five years.",
    serves: "People and households",
    facts: [
      "10 free scans, then 10 cents a scan",
      "Work expenses can go straight to Free Tax Returns",
    ],
    status: { kind: "beta", label: "Android beta · iPhone in development" },
    adds: "Where people shop, by the suburb printed on the receipt, and what they buy by category",
  },
  {
    key: "ftr",
    name: "Free Tax Returns",
    kind: "app",
    page: "/brands/free-tax-returns/",
    href: "https://freetaxreturns.com.au",
    host: "freetaxreturns.com.au",
    tagline: "Your biggest refund starts here.",
    summary:
      "A free deduction worksheet for Australian workers. Pick your occupation, itemise what you spent and copy the exact totals into your own return on myGov.",
    serves: "Australian workers at tax time",
    facts: ["No fees and no sign-up to start", "Never lodges or sends anything to the ATO"],
    status: { kind: "live", label: "Live at freetaxreturns.com.au" },
    adds: "Occupation, income bracket and return status. Never a tax file number or bank details",
  },
  {
    key: "spambank",
    name: "Spambank",
    kind: "feature",
    page: "/brands/spambank/",
    // No site of its own: this page is its website. It is used inside the three apps.
    href: null,
    host: null,
    availableIn: ["snapapp", "yourtal", "ftr"],
    // Draft tagline, written for this site: founder to approve (REDESIGN.md section 8).
    tagline: "Your real inbox, kept clean.",
    summary:
      "One free email address per person, shared across SnapApps, YourTal and Free Tax Returns. Use it for sign-ups and newsletters, and spam and bulk mail goes to Junk on its own.",
    serves: "Adults who sign up for things online",
    facts: ["One address, the same mail in all three apps", "Adults only"],
    status: { kind: "review", label: "In staging testing" },
    adds: "Nothing from your mail. Spambank keeps your real inbox clean; GOD never reads email contents",
  },
];

export function brand(key: BrandKey): Brand {
  const b = BRANDS.find((x) => x.key === key);
  if (!b) throw new Error(`unknown brand ${key}`);
  return b;
}

/** Where a brand can be reached on the web: its own site, or the apps a feature lives in. */
export function sitesFor(b: Brand): { key: BrandKey; name: string; href: string; host: string }[] {
  if (b.href && b.host) return [{ key: b.key, name: b.name, href: b.href, host: b.host }];
  return (b.availableIn ?? []).flatMap((k) => {
    const a = brand(k);
    return a.href && a.host ? [{ key: a.key, name: a.name, href: a.href, host: a.host }] : [];
  });
}
