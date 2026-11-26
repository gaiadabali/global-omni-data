import { TODAY, fmtDate, isIsoDate } from "@/lib/dates";
import { canAccessPage } from "../access";
import { getDashboardData } from "../data";
import { allowListStore } from "../data/allowlist";
import type { AllowListEntry, DashboardData } from "../data/types";
import { BRAND_LABELS, ROLES, ROLE_LABELS, isBrandId, type Role, type Viewer } from "../types";
import { getAuditLog } from "./index";
import { buildReason } from "./reasons";
import type { AuditLog } from "./types";

/**
 * What happens when someone presses a button that must be recorded. Each handler checks the viewer and the page
 * access itself (a server action is a public endpoint), validates its input, does the work, and appends an audit
 * event. The server actions in ./actions.ts are thin wrappers that supply the viewer. Pure enough to test: the
 * data source and the audit log can be passed in.
 */

export interface Deps {
  source?: DashboardData;
  audit?: AuditLog;
}

export interface Fail {
  ok: false;
  error: string;
}

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.slice(0, max) : "");

function gate(viewer: Viewer | null, page: "insight" | "teens" | "person" | "admin"): Fail | null {
  if (!viewer) return { ok: false, error: "Sign in required." };
  if (!canAccessPage(viewer, page)) return { ok: false, error: "Your role cannot do this." };
  return null;
}

/* ---------------- open a Person 360 profile ---------------- */

export type OpenResult = { ok: true; outcome: "opened" | "teen-refused" | "not-found"; id: string } | Fail;

export async function handleOpenProfile(
  viewer: Viewer | null,
  input: { id: string; reasonId: string; note: string },
  deps: Deps = {},
): Promise<OpenResult> {
  const denied = gate(viewer, "person");
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };
  const id = str(input.id, 20).trim().toUpperCase();
  const reason = buildReason(str(input.reasonId, 40), str(input.note, 1000));
  if (!reason.ok) return reason;
  const out = await getDashboardData(viewer, deps.source, deps.audit).personOpen(id, reason.reason);
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
  const denied = gate(viewer, kind);
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };
  const entity = str(input.entity, 40);
  const audit = deps.audit ?? getAuditLog();
  const data = getDashboardData(viewer, deps.source, audit);

  let name: string;
  try {
    // Building the export view also proves the entity exists and may be reported on (a teen report never
    // covers a sensitive category).
    const r = kind === "insight" ? await data.insight({ entity, forExport: true }) : await data.teens({ entity, forExport: true });
    name = r.report.entity.name;
  } catch (e) {
    if (e instanceof RangeError) return { ok: false, error: "That report is not available." };
    throw e;
  }
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
  handle: string;
  role: string;
  brand?: string;
  agreementSigned: string;
  originalHeldBy: string;
}

export type InviteResult = { ok: true; name: string } | Fail;

export async function handleInvite(
  viewer: Viewer | null,
  input: InviteInput,
  deps: Deps = {},
): Promise<InviteResult> {
  const denied = gate(viewer, "admin");
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };

  const name = str(input.name, 80).trim();
  if (name.length < 2) return { ok: false, error: "Add the person's full name." };
  const rawHandle = str(input.handle, 60).trim().toLowerCase();
  const handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;
  if (!/^@[a-z0-9._-]{2,40}$/.test(handle)) return { ok: false, error: "Add their YourTal account, like @first.last." };
  const roleText = str(input.role, 20);
  const role = (ROLES as readonly string[]).includes(roleText) ? (roleText as Role) : null;
  if (!role) return { ok: false, error: "Choose a role." };
  const brandText = str(input.brand, 20);
  if (role === "brand_lead" && !isBrandId(brandText)) return { ok: false, error: "Choose the brand this brand lead looks after." };
  const date = str(input.agreementSigned, 10);
  if (!isIsoDate(date) || date < "2020-01-01" || date > TODAY) {
    return { ok: false, error: "Enter the date the paper agreement was signed. It cannot be in the future." };
  }
  const heldBy = str(input.originalHeldBy, 80).trim();
  if (!heldBy) return { ok: false, error: "Say who holds the signed paper original." };

  const entry: AllowListEntry = {
    id: `u-${handle.slice(1).replace(/[^a-z0-9]+/g, "-")}`,
    name,
    handle,
    role,
    ...(role === "brand_lead" && isBrandId(brandText) ? { brand: brandText } : {}),
    agreementSigned: date,
    originalHeldBy: heldBy,
    status: "invited",
    lastSignIn: null,
  };
  if (!allowListStore.add(entry)) return { ok: false, error: "That person is already on the allow-list." };

  const roleLabel = role === "brand_lead" && entry.brand ? `${ROLE_LABELS.brand_lead} (${BRAND_LABELS[entry.brand]})` : ROLE_LABELS[role];
  await (deps.audit ?? getAuditLog()).append({
    who: viewer.id,
    action: "allowlist.invite",
    target: handle,
    reason: `${name}, ${roleLabel}. Paper agreement signed ${fmtDate(date)}, original held by ${heldBy}`,
  });
  return { ok: true, name };
}

/* ---------------- revoke a session ---------------- */

export type RevokeResult = { ok: true; person: string } | Fail;

/** In dev this ends nothing: it records the request. Real sessions arrive with real sign-in. */
export async function handleRevokeSession(
  viewer: Viewer | null,
  input: { sessionId: string },
  deps: Deps = {},
): Promise<RevokeResult> {
  const denied = gate(viewer, "admin");
  if (denied || !viewer) return denied ?? { ok: false, error: "Sign in required." };
  const audit = deps.audit ?? getAuditLog();
  const sessions = await getDashboardData(viewer, deps.source, audit).adminSessions();
  const found = sessions.find((s) => s.id === str(input.sessionId, 40));
  if (!found) return { ok: false, error: "That session is not in the list." };
  if (found.current) return { ok: false, error: "That is your own session. Sign out from the menu instead." };
  await audit.append({
    who: viewer.id,
    action: "session.revoke",
    target: `${found.person} (${found.id})`,
    reason: "Dev: no session was ended; the request is recorded",
  });
  return { ok: true, person: found.person };
}
