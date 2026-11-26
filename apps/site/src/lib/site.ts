export const SITE_URL = "https://god.gaiada.com";
export const SITE_NAME = "GOD (Global Omni Data)";
export const THEME_KEY = "god-theme";

export interface NavItem {
  href: string;
  label: string;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/brands/", label: "Our brands" },
  { href: "/for-brands/", label: "For brands" },
  { href: "/privacy/", label: "Trust & privacy" },
  { href: "/about/", label: "About" },
  { href: "/contact/", label: "Contact" },
];

export const BRAND_LINKS = [
  { name: "YourTal", href: "https://yourtal.gaiada.com", host: "yourtal.gaiada.com" },
  { name: "SnapApp", href: "https://snapapp.gaiada.com", host: "snapapp.gaiada.com" },
  {
    name: "Free Tax Returns",
    href: "https://freetaxreturns.com.au",
    host: "freetaxreturns.com.au",
  },
] as const;

export const CONTACT_EMAIL = "hello@god.gaiada.com";

/** Strip a trailing slash so "/about/" and "/about" compare equal. */
export function normalisePath(path: string): string {
  const p = path.split(/[?#]/)[0] ?? "/";
  return p.length > 1 ? p.replace(/\/+$/, "") : "/";
}

export function isCurrent(navHref: string, pathname: string): boolean {
  return normalisePath(navHref) === normalisePath(pathname);
}

export function canonicalUrl(pathname: string): string {
  const p = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return new URL(p, SITE_URL).toString();
}
