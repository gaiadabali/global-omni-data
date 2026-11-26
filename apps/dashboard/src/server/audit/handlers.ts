import { TODAY, fmtDate, isIsoDate } from "@/lib/dates";
import { allowedInEmergency, canAccessPage, type GuardedAction } from "../access";
import { EMERGENCY_REFUSED, FRESH_REFUSED, type FreshGate } from "../auth/fresh";
import { getDashboardData } from "../data";
import type { DashboardData } from "../data/types";
import { getStores } from "../store";
import type { AllowEntry, AllowStatus, Stores } from "../store/types";
import { BRAND_LABELS, ROLES, ROLE_LABELS, isBrandId, type Role, type Viewer } from "../types";
import { getAuditLog } from "./index";
import { buildReason } from "./reasons";
import type { AuditLog } from "./types";

/**
 * What happens when someone presses a button that must be recorded. Each handler checks the viewer and the page
 * access itself (a server action is a public endpoint), validates its input, then (for exports, opening a profile
 * and allow-list changes) the fresh passkey check, does the work, and appends an audit event. The server actions in
 * ./actions.ts are thin wrappers that supply the viewer and the fresh check. Pure enough to test: the data source,
 * the audit log, the stores and the fresh check can be passed in. With no fresh check passed, the gated handlers
 * refuse: a forgotten gate never lets an action through.
 */

export interface Deps {
  source?: DashboardData;
  audit?: AuditLog;
  stores?: Pick<Stores, "allowList" | "sessions">;
  /** The fresh passkey gate for this request. Default: refuse. */
  fresh?: () => Promise<FreshGate>;
  /** The real session behind this request (null with dev sign-in): your own session cannot be revoked here. */
  currentSessionId?: string | null;
  now?: () => number;
}

export interface Fail {
  ok: false;
  error: string;
  /** Set when a fresh passkey check is needed: where to send the browser (the page adds &return=). */
  freshUrl?: string;
}

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Who may do it: signed in, a role that may open the page, and (for an emergency session) an action an emergency
 * session may take. An emergency refusal is itself recorded.
 */
async function gate(
  viewer: Viewer | null,
  page: "insight" | "teens" | "person" | "admin",
  action: GuardedAction,
  deps: Pick<Deps, "audit">,
): Promise<Fail | null> {
  if (!viewer) return { ok: false, error: "Sign in required." };
  if (!canAccessPage(viewer, page)) return { ok: false, error: "Your role cannot do this." };
  if (!allowedInEmergency(viewer, action)) {
    await (deps.audit ?? getAuditLog()).append({
      who: viewer.id,
      action: "breakglass.refused",
      target: action,
      reason: `Refused in emergency access: ${action}`,
      outcome: "refused",
    });
    return { ok: false, error: EMERGENCY_REFUSED };
  }
  return null;
}

async function freshOrFail(deps: Deps): Promise<Fail | null> {
  const g = await (deps.fresh ?? FRESH_REFUSED)();
  return g.ok
    ? null
    : { ok: false, error: g.error, ...(g.freshUrl ? { freshUrl: g.freshUrl } : {}) };
}

/* ---------------- open a Person 360 profile ---------------- */

export type OpenResult =
  { ok: true; outcome: "opened" | "teen-refused" | "not-found"; id: string } | Fail;

export async function handleOpenProfile(
  viewer: Viewer | null,
  input: { id: string; reasonId: string; note: string },
  deps: Deps = {},
): Promise<OpenResult> {
  const denied = await gate(viewer, "person", "person.open", deps);
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };
  const id = str(input.id, 20).trim().toUpperCase();
  const reason = buildReason(str(input.reasonId, 40), str(input.note, 1000));
  if (!reason.ok) return reason;
  const stale = await freshOrFail(deps);
  if (stale) return stale;
  const out = await getDashboardData(viewer, deps.source, deps.audit, deps.stores).personOpen(
    id,
    reason.reason,
  );
  return { ok: true, outcome: out.kind, id };
}

/* ---------------- export a report to PDF ---------------- */

export type ExportResult = { ok: true; reportName: string; printPath: string } | Fail;

export async function handleExport(
  viewer: Viewer | null,
  input: { kind: string; entity: string },
  deps: Deps = {},
): Promise<ExportResult> {
  const kind = input.kind === "teens" ? "teens" : input.kind === "insight" ? "insight" : null;
  if (!kind) return { ok: false, error: "Unknown report." };
  const denied = await gate(viewer, kind, "export", deps);
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };
  const entity = str(input.entity, 40);
  const audit = deps.audit ?? getAuditLog();
  const data = getDashboardData(viewer, deps.source, audit, deps.stores);

  let name: string;
  try {
    // Building the export view also proves the entity exists and may be reported on (a teen report never
    // covers a sensitive category).
    const r =
      kind === "insight"
        ? await data.insight({ entity, forExport: true })
        : await data.teens({ entity, forExport: true });
    name = r.report.entity.name;
  } catch (e) {
    if (e instanceof RangeError) return { ok: false, error: "That report is not available." };
    throw e;
  }
  const stale = await freshOrFail(deps);
  if (stale) return stale;
  await audit.append({
    who: viewer.id,
    action: "export.pdf",
    target: `${kind}:${entity}`,
    reason: `${kind === "insight" ? "Brand insight report" : "Teen market report"}: ${name} (PDF)`,
  });
  return {
    ok: true,
    reportName: name,
    printPath: `/${kind}?entity=${encodeURIComponent(entity)}&print=1&auto=1`,
  };
}

/* ---------------- invite someone to the allow-list ---------------- */

export interface InviteInput {
  name: string;
  email: string;
  role: string;
  brand?: string;
  agreementSigned: string;
  originalHeldBy: string;
}

export type InviteResult = { ok: true; name: string } | Fail;

/** A plain, lower-case email address. YourTal sends lower-case, verified addresses (docs/26 §1.3). */
export function normaliseEmail(v: unknown): string | null {
  const e = str(v, 254).trim().toLowerCase();
  return /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(e) && !e.includes("..") ? e : null;
}

function roleLabel(role: Role, brand?: AllowEntry["brand"]): string {
  return role === "brand_lead" && brand
    ? `${ROLE_LABELS.brand_lead} (${BRAND_LABELS[brand]})`
    : ROLE_LABELS[role];
}

export async function handleInvite(
  viewer: Viewer | null,
  input: InviteInput,
  deps: Deps = {},
): Promise<InviteResult> {
  const denied = await gate(viewer, "admin", "allowlist.invite", deps);
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };

  const name = str(input.name, 80).trim();
  if (name.length < 2) return { ok: false, error: "Add the person's full name." };
  const email = normaliseEmail(input.email);
  if (!email) return { ok: false, error: "Add the email address of their YourTal account." };
  const roleText = str(input.role, 20);
  const role = (ROLES as readonly string[]).includes(roleText) ? (roleText as Role) : null;
  if (!role) return { ok: false, error: "Choose a role." };
  const brandText = str(input.brand, 20);
  if (role === "brand_lead" && !isBrandId(brandText))
    return { ok: false, error: "Choose the brand this brand lead looks after." };
  const date = str(input.agreementSigned, 10);
  if (!isIsoDate(date) || date < "2020-01-01" || date > TODAY) {
    return {
      ok: false,
      error: "Enter the date the paper agreement was signed. It cannot be in the future.",
    };
  }
  const heldBy = str(input.originalHeldBy, 80).trim();
  if (!heldBy) return { ok: false, error: "Say who holds the signed paper original." };

  const stale = await freshOrFail(deps);
  if (stale) return stale;

  const brand = role === "brand_lead" && isBrandId(brandText) ? brandText : undefined;
  const added = await (deps.stores ?? getStores()).allowList.invite({
    name,
    email,
    role,
    ...(brand ? { brand } : {}),
    agreementSigned: date,
    originalHeldBy: heldBy,
    invitedBy: viewer.id,
  });
  if (!added) return { ok: false, error: "That email is already on the allow-list." };

  await (deps.audit ?? getAuditLog()).append({
    who: viewer.id,
    action: "allowlist.invite",
    target: added.id,
    reason: `${name}, ${roleLabel(role, brand)}. Paper agreement signed ${fmtDate(date)}, original held by ${heldBy}`,
  });
  return { ok: true, name };
}

/* ---------------- suspend, reinstate or remove an allow-list entry ---------------- */

export type ChangeResult =
  { ok: true; name: string; status: AllowStatus; sessionsEnded: number } | Fail;

const CHANGES = { suspend: "suspended", remove: "removed", reinstate: "active" } as const;

/** Suspending or removing ends every session the person has. Your own entry cannot be changed here. */
export async function handleAllowListChange(
  viewer: Viewer | null,
  input: { id: string; change: string },
  deps: Deps = {},
): Promise<ChangeResult> {
  const denied = await gate(viewer, "admin", "allowlist.change", deps);
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };
  const change = Object.hasOwn(CHANGES, input.change)
    ? (input.change as keyof typeof CHANGES)
    : null;
  if (!change) return { ok: false, error: "Unknown change." };
  const stores = deps.stores ?? getStores();
  const entry = await stores.allowList.find(str(input.id, 60));
  if (!entry || entry.status === "removed")
    return { ok: false, error: "That person is not on the allow-list." };
  if (entry.id === viewer.id) return { ok: false, error: "You cannot change your own entry." };
  if (change === "reinstate" && entry.status !== "suspended")
    return { ok: false, error: "Only a suspended person can be reinstated." };
  if (change === "suspend" && entry.status === "suspended")
    return { ok: false, error: "That person is already suspended." };

  const stale = await freshOrFail(deps);
  if (stale) return stale;

  // A reinstated person who never signed in goes back to invited.
  const status: AllowStatus =
    change === "reinstate" && entry.yourtalSub === null ? "invited" : CHANGES[change];
  await stores.allowList.setStatus(entry.id, status);
  const at = new Date((deps.now ?? Date.now)()).toISOString();
  const sessionsEnded =
    change === "reinstate" ? 0 : await stores.sessions.revokeAllForUser(entry.id, viewer.id, at);
  await (deps.audit ?? getAuditLog()).append({
    who: viewer.id,
    action: "allowlist.change",
    target: entry.id,
    reason: `${entry.name}: ${change === "remove" ? "removed" : change === "suspend" ? "suspended" : "reinstated"}${
      sessionsEnded
        ? `, ${sessionsEnded} ${sessionsEnded === 1 ? "session" : "sessions"} ended`
        : ""
    }`,
  });
  return { ok: true, name: entry.name, status, sessionsEnded };
}

/* ---------------- revoke sessions ---------------- */

export type RevokeResult = { ok: true; person: string; ended: number } | Fail;

/** Revoking protects, so it needs no fresh check. Your own current session is ended by signing out instead. */
export async function handleRevokeSession(
  viewer: Viewer | null,
  input: { sessionId: string },
  deps: Deps = {},
): Promise<RevokeResult> {
  const denied = await gate(viewer, "admin", "session.revoke", deps);
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };
  const audit = deps.audit ?? getAuditLog();
  const stores = deps.stores ?? getStores();
  const sessions = await getDashboardData(viewer, deps.source, audit, stores).adminSessions(
    deps.currentSessionId ?? null,
  );
  const found = sessions.find((s) => s.id === str(input.sessionId, 60));
  if (!found) return { ok: false, error: "That session is not in the list." };
  if (found.current)
    return { ok: false, error: "That is your own session. Sign out from the menu instead." };
  await stores.sessions.revoke(
    found.id,
    viewer.id,
    new Date((deps.now ?? Date.now)()).toISOString(),
  );
  await audit.append({
    who: viewer.id,
    action: "session.revoke",
    target: `${found.personId} (${found.id})`,
    reason: `Signed ${found.person} out of one session`,
  });
  return { ok: true, person: found.person, ended: 1 };
}

/** "Sign out everywhere" for one person. Not for yourself: sign out from the menu. */
export async function handleRevokeAllForPerson(
  viewer: Viewer | null,
  input: { personId: string },
  deps: Deps = {},
): Promise<RevokeResult> {
  const denied = await gate(viewer, "admin", "session.revoke", deps);
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };
  const stores = deps.stores ?? getStores();
  const entry = await stores.allowList.find(str(input.personId, 60));
  if (!entry) return { ok: false, error: "That person is not on the allow-list." };
  if (entry.id === viewer.id)
    return { ok: false, error: "That is you. Sign out from the menu instead." };
  const ended = await stores.sessions.revokeAllForUser(
    entry.id,
    viewer.id,
    new Date((deps.now ?? Date.now)()).toISOString(),
  );
  await (deps.audit ?? getAuditLog()).append({
    who: viewer.id,
    action: "session.revoke",
    target: entry.id,
    reason: `Signed ${entry.name} out everywhere: ${ended} ${ended === 1 ? "session" : "sessions"} ended`,
  });
  return { ok: true, person: entry.name, ended };
}
