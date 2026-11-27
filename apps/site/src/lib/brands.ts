/**
 * The three GOD brands, in one place for the home page, the brands overview, the brand pages and the footer.
 * Every line here comes from the brand's own repo or live site; REDESIGN.md §6 lists the source of each.
 * This file is also the only place a brand's own web address is written. SnapApp and YourTal are staging hosts
 * today, so a final domain is a one-line change here. Brand colours live in `styles/brands.css`.
 */
export type BrandKey = "yourtal" | "snapapp" | "ftr";

export type BrandStatus = "live" | "beta" | "review";

export interface Brand {
  key: BrandKey;
  name: string;
  /** This site's page about the brand. */
  page: string;
  /** The brand's own site. */
  href: string;
  host: string;
  /** A second address that is the product itself rather than its marketing site (SnapApp's web app). */
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
    name: "SnapApp",
    page: "/brands/snapapp/",
    href: "https://snapapp.gaiada.com",
    host: "snapapp.gaiada.com",
    webApp: { href: "https://snapapp.app.gaiada.com", host: "snapapp.app.gaiada.com" },
    tagline: "The receipt app that reads every line.",
    summary:
      "Photograph a docket and SnapApp reads each line, splits GST-free from taxable, checks it is a valid tax invoice and keeps a true copy for five years.",
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
];

export function brand(key: BrandKey): Brand {
  const b = BRANDS.find((x) => x.key === key);
  if (!b) throw new Error(`unknown brand ${key}`);
  return b;
}
