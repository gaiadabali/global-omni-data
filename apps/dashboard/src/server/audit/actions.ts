"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "../viewer";
import {
  handleExport,
  handleInvite,
  handleOpenProfile,
  handleRevokeSession,
  type ExportResult,
  type InviteInput,
  type InviteResult,
  type OpenResult,
  type RevokeResult,
} from "./handlers";

/**
 * The server actions the pages call. Each is a public endpoint, so each takes the viewer from the viewer seam
 * (never from the client) and the handler checks the role again. Every one ends in an audit event.
 */

export async function openProfileAction(input: { id: string; reasonId: string; note: string }): Promise<OpenResult> {
  const res = await handleOpenProfile(await getViewer(), input);
  if (res.ok) revalidatePath("/person");
  return res;
}

export async function exportReportAction(input: { kind: string; entity: string }): Promise<ExportResult> {
  return handleExport(await getViewer(), input);
}

export async function inviteAction(input: InviteInput): Promise<InviteResult> {
  const res = await handleInvite(await getViewer(), input);
  if (res.ok) revalidatePath("/admin");
  return res;
}

export async function revokeSessionAction(input: { sessionId: string }): Promise<RevokeResult> {
  const res = await handleRevokeSession(await getViewer(), input);
  if (res.ok) revalidatePath("/admin");
  return res;
}
