"use server";

import { revalidatePath } from "next/cache";
import { checkFresh, getSessionState } from "../auth/current";
import { getViewer } from "../viewer";
import {
  handleAllowListChange,
  handleExport,
  handleInvite,
  handleOpenProfile,
  handleRevokeAllForPerson,
  handleRevokeSession,
  type ChangeResult,
  type Deps,
  type ExportResult,
  type InviteInput,
  type InviteResult,
  type OpenResult,
  type RevokeResult,
} from "./handlers";

/**
 * The server actions the pages call. Each is a public endpoint, so each takes the viewer from the viewer seam
 * (never from the client) and the handler checks the role again. Exports, profile opens and allow-list changes
 * also take this request's fresh passkey gate. Every one ends in an audit event.
 */

async function deps(): Promise<Deps> {
  const state = await getSessionState();
  return { fresh: checkFresh, currentSessionId: state.kind === "ok" ? state.session.id : null };
}

export async function openProfileAction(input: { id: string; reasonId: string; note: string }): Promise<OpenResult> {
  const res = await handleOpenProfile(await getViewer(), input, await deps());
  if (res.ok) revalidatePath("/person");
  return res;
}

export async function exportReportAction(input: { kind: string; entity: string }): Promise<ExportResult> {
  return handleExport(await getViewer(), input, await deps());
}

export async function inviteAction(input: InviteInput): Promise<InviteResult> {
  const res = await handleInvite(await getViewer(), input, await deps());
  if (res.ok) revalidatePath("/admin");
  return res;
}

export async function allowListChangeAction(input: { id: string; change: string }): Promise<ChangeResult> {
  const res = await handleAllowListChange(await getViewer(), input, await deps());
  if (res.ok) revalidatePath("/admin");
  return res;
}

export async function revokeSessionAction(input: { sessionId: string }): Promise<RevokeResult> {
  const res = await handleRevokeSession(await getViewer(), input, await deps());
  if (res.ok) revalidatePath("/admin");
  return res;
}

export async function revokeAllForPersonAction(input: { personId: string }): Promise<RevokeResult> {
  const res = await handleRevokeAllForPerson(await getViewer(), input, await deps());
  if (res.ok) revalidatePath("/admin");
  return res;
}
