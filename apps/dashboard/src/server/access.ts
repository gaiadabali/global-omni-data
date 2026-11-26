import { forbidden, redirect } from "next/navigation";
import {
  NAV_GROUP_ORDER,
  PAGES,
  PHONE_BAR,
  type IconName,
  type PageId,
} from "@/lib/pages";
import type { BrandId, Role, Viewer } from "./types";

/**
 * ACCESS: the one table of which role may open which page and which API.
 * Every page and route handler checks it on the server (requirePage / requireApi). The nav is derived from the
 * same table (navFor), so a link that is hidden is also a page that is refused. Hiding a link is cosmetic only.
 *
 * A brand lead sees only their own brand: the brand pages are further limited by `brandOfPage`, and the map
 * queries are limited by `canQueryBrand`.
 */
const OWNER_EXEC_DATA: readonly Role[] = ["owner", "executive", "data"];
const EVERYONE: readonly Role[] = ["owner", "executive", "data", "brand_lead"];

export const PAGE_ACCESS: Record<PageId, readonly Role[]> = {
  home: OWNER_EXEC_DATA,
  yourtal: EVERYONE,
  snapapp: EVERYONE,
  ftr: EVERYONE,
  map: EVERYONE,
  activity: EVERYONE,
  insight: OWNER_EXEC_DATA,
  teens: OWNER_EXEC_DATA,
  person: ["owner", "data"],
  quality: ["owner", "data"],
  admin: ["owner"],
};

export const API_IDS = [
  "map.influence",
  "map.summary",
  "map.area",
  "map.activity",
  "map.hotspots",
  "map.activityArea",
] as const;
export type ApiId = (typeof API_IDS)[number];

export const API_ACCESS: Record<ApiId, readonly Role[]> = {
  "map.influence": EVERYONE,
  "map.summary": EVERYONE,
  "map.area": EVERYONE,
  "map.activity": EVERYONE,
  "map.hotspots": EVERYONE,
  "map.activityArea": EVERYONE,
};

/** Pages that belong to one brand. A brand lead may open only their own. */
export const BRAND_PAGE: Partial<Record<PageId, BrandId>> = {
  yourtal: "yourtal",
  snapapp: "snapapp",
  ftr: "ftr",
};

export type Check = "ok" | "signin" | "forbidden";

function roleAllowed(viewer: Viewer, roles: readonly Role[]): boolean {
  return roles.includes(viewer.role);
}

export function canAccessPage(viewer: Viewer | null, pageId: PageId): boolean {
  if (!viewer) return false;
  if (!roleAllowed(viewer, PAGE_ACCESS[pageId])) return false;
  const brand = BRAND_PAGE[pageId];
  if (brand && viewer.role === "brand_lead") return viewer.brand === brand;
  return true;
}

export function canAccessApi(viewer: Viewer | null, apiId: ApiId): boolean {
  return viewer !== null && roleAllowed(viewer, API_ACCESS[apiId]);
}

/** Whether the viewer may ask about a brand ("all" means every brand together). */
export function canQueryBrand(viewer: Viewer | null, brand: BrandId | "all"): boolean {
  if (!viewer) return false;
  if (viewer.role !== "brand_lead") return true;
  return brand !== "all" && viewer.brand === brand;
}

export function checkPage(viewer: Viewer | null, pageId: PageId): Check {
  if (!viewer) return "signin";
  return canAccessPage(viewer, pageId) ? "ok" : "forbidden";
}

/**
 * Call at the top of every page. No viewer: redirect to /signin. A role that may not open the page: a real 403
 * (forbidden.tsx). Returns the viewer so the page can carry on.
 */
export function requirePage(viewer: Viewer | null, pageId: PageId): Viewer {
  const result = checkPage(viewer, pageId);
  if (result === "signin") redirect("/signin");
  if (result === "forbidden" || !viewer) forbidden();
  return viewer;
}

export type ApiGate =
  | { ok: true; viewer: Viewer }
  | { ok: false; status: 401 | 403; error: string };

/** Call at the top of every route handler. A refusal carries the status to send. */
export function requireApi(viewer: Viewer | null, apiId: ApiId): ApiGate {
  if (!viewer) return { ok: false, status: 401, error: "Sign in required" };
  if (!canAccessApi(viewer, apiId)) return { ok: false, status: 403, error: "Your role cannot use this" };
  return { ok: true, viewer };
}

/** Where a viewer lands: a brand lead on their brand page, everyone else on the overview. */
export function homeFor(viewer: Viewer): PageId {
  if (viewer.role === "brand_lead" && viewer.brand) return viewer.brand;
  return "home";
}

export function homePathFor(viewer: Viewer): string {
  return PAGES[homeFor(viewer)].path;
}

/* ---------------- the nav, derived from the same table ---------------- */

export interface NavItem {
  id: PageId;
  href: string;
  label: string;
  icon: IconName;
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

function item(id: PageId): NavItem {
  const p = PAGES[id];
  return { id, href: p.path, label: p.navLabel, icon: p.icon };
}

export function navFor(viewer: Viewer | null): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const title of NAV_GROUP_ORDER) {
    const items = (Object.keys(PAGES) as PageId[])
      .filter((id) => PAGES[id].navGroup === title && canAccessPage(viewer, id))
      .map(item);
    if (items.length) groups.push({ title, items });
  }
  return groups;
}

export interface PhoneItem {
  id: PageId;
  href: string;
  label: string;
  icon: IconName;
}

/** Up to four pages for the phone bar; the rest sit behind "More". */
export function phoneNavFor(viewer: Viewer | null): PhoneItem[] {
  return PHONE_BAR.filter((id) => canAccessPage(viewer, id))
    .slice(0, 4)
    .map((id) => ({
      id,
      href: PAGES[id].path,
      label: PAGES[id].phoneLabel ?? PAGES[id].navLabel,
      icon: PAGES[id].icon,
    }));
}
