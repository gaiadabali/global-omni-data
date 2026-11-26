import { cache } from "react";
import { cookies } from "next/headers";
import { getSessionState } from "./auth/current";
import { isDevAuthEnabled } from "./dev-auth";
import { DEV_ROLE_COOKIE, isDevRoleValue, type DevRoleValue } from "./dev-roles";
import type { Viewer } from "./types";

/**
 * THE VIEWER SEAM. Everything that needs to know who is signed in calls getViewer(), and nothing else reads
 * identity. Exactly one source answers, never both:
 *   - dev sign-in on (GOD_DEV_AUTH=1 and GOD_DEPLOYMENT=dev): the dev cookie (god_dev_role), nothing else;
 *   - otherwise: the real session (Sign in with YourTal, allow-list, passkey), checked on every request for the
 *     idle and absolute limits, revocation and the person's allow-list status (src/server/auth/session.ts).
 * Pages, access checks and the data layer only ever see a Viewer or null.
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
  if (isDevAuthEnabled()) {
    const jar = await cookies();
    return viewerFromDevCookie(jar.get(DEV_ROLE_COOKIE)?.value);
  }
  const state = await getSessionState();
  return state.kind === "ok" ? { ...state.viewer } : null;
});

export { DEV_ROLE_COOKIE, DEV_ROLE_VALUES, DEV_ROLE_LABELS, isDevRoleValue } from "./dev-roles";
export type { DevRoleValue } from "./dev-roles";
