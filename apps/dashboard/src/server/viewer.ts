import { cache } from "react";
import { cookies } from "next/headers";
import { isDevAuthEnabled } from "./dev-auth";
import { DEV_ROLE_COOKIE, isDevRoleValue, type DevRoleValue } from "./dev-roles";
import type { Viewer } from "./types";

/**
 * THE VIEWER SEAM. Everything that needs to know who is signed in calls getViewer(), and nothing else reads
 * identity. In this phase it honours only the dev cookie (god_dev_role), and only while dev sign-in is on.
 * Real sign-in (Sign in with YourTal, allow-list, passkey) replaces the inside of getViewer() later, and
 * nothing else changes: pages, access checks and the data layer only ever see a Viewer or null.
 */

/** Fictional people. Nothing here is real. */
const DEV_VIEWERS: Record<DevRoleValue, Viewer> = {
  owner: { id: "dev-owner", displayName: "Alex Morgan", role: "owner" },
  executive: { id: "dev-executive", displayName: "Priya Nair", role: "executive" },
  data: { id: "dev-data", displayName: "Jordan Lee", role: "data" },
  brand_lead_yourtal: {
    id: "dev-bl-yourtal",
    displayName: "Sam Ortega",
    role: "brand_lead",
    brand: "yourtal",
  },
  brand_lead_snapapp: {
    id: "dev-bl-snapapp",
    displayName: "Taylor Reid",
    role: "brand_lead",
    brand: "snapapp",
  },
  brand_lead_ftr: {
    id: "dev-bl-ftr",
    displayName: "Morgan Blake",
    role: "brand_lead",
    brand: "ftr",
  },
};

/** Pure: the viewer a dev cookie value stands for, or null. */
export function viewerFromDevCookie(value: string | undefined): Viewer | null {
  return isDevRoleValue(value) ? { ...DEV_VIEWERS[value] } : null;
}

/** The dev cookie value that matches a viewer (for the role switch's selected option). */
export function devRoleValueOf(viewer: Viewer): DevRoleValue {
  if (viewer.role === "brand_lead") {
    return `brand_lead_${viewer.brand ?? "yourtal"}` as DevRoleValue;
  }
  return viewer.role;
}

/** The signed-in person, or null. Cached for the length of one request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (!isDevAuthEnabled()) return null;
  const jar = await cookies();
  return viewerFromDevCookie(jar.get(DEV_ROLE_COOKIE)?.value);
});

export { DEV_ROLE_COOKIE, DEV_ROLE_VALUES, DEV_ROLE_LABELS, isDevRoleValue } from "./dev-roles";
export type { DevRoleValue } from "./dev-roles";
