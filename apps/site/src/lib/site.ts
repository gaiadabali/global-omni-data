export const SITE_URL = "https://god.gaiada.com";
export const SITE_NAME = "GOD (Global Omni Data)";
export const THEME_KEY = "god-theme";

export interface NavItem {
  href: string;
  label: string;
}

/** The main navigation. The logo links home; "Talk to us" renders as the header's one button. */
export const NAV: NavItem[] = [
  { href: "/brands/", label: "Our brands" },
  { href: "/for-brands/", label: "For brands" },
  { href: "/how-it-works/", label: "How it works" },
  { href: "/privacy/", label: "Trust" },
  { href: "/about/", label: "About" },
  { href: "/contact/", label: "Talk to us" },
];

export const CONTACT_EMAIL = "hello@god.gaiada.com";

/** Strip a trailing slash so "/about/" and "/about" compare equal. */
export function normalisePath(path: string): string {
  const p = path.split(/[?#]/)[0] ?? "/";
  return p.length > 1 ? p.replace(/\/+$/, "") : "/";
}

export function isCurrent(navHref: string, pathname: string): boolean {
  return normalisePath(navHref) === normalisePath(pathname);
}

/** True on a page inside a nav item's section, such as /brands/yourtal/ under "Our brands". */
export function inSection(navHref: string, pathname: string): boolean {
  const nav = normalisePath(navHref);
  const p = normalisePath(pathname);
  return nav !== "/" && p !== nav && p.startsWith(`${nav}/`);
}

export function canonicalUrl(pathname: string): string {
  const p = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return new URL(p, SITE_URL).toString();
}
