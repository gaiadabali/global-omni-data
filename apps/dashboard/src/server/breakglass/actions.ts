"use server";

import { revalidatePath } from "next/cache";
import { checkFresh, getSessionState } from "../auth/current";
import { getStores } from "../store";
import { getViewer } from "../viewer";
import { getBreakGlassRuntime } from "./ceremonies";
import { readBreakGlassConfig } from "./config";
import {
  beginEnrol,
  finishEnrol,
  revokeKey,
  type BeginResult,
  type EnrolDeps,
  type FinishResult,
  type RevokeKeyResult,
} from "./enrol";
import { simpleWebAuthn } from "./webauthn";

/**
 * The server actions behind Admin, Emergency access. Each is a public endpoint, so each takes the viewer and the
 * session from the server (never from the client), and the handler checks everything again (./enrol.ts).
 */
async function deps(): Promise<EnrolDeps> {
  const state = await getSessionState();
  return {
    stores: getStores(),
    config: readBreakGlassConfig(),
    webauthn: simpleWebAuthn,
    ceremonies: getBreakGlassRuntime().ceremonies,
    fresh: checkFresh,
    sessionId: state.kind === "ok" ? state.session.id : null,
    now: Date.now,
  };
}

export async function beginEnrolAction(input: { code: string }): Promise<BeginResult> {
  return beginEnrol(await getViewer(), { code: input?.code }, await deps());
}

export async function finishEnrolAction(input: {
  ceremonyId: string;
  response: unknown;
}): Promise<FinishResult> {
  const res = await finishEnrol(
    await getViewer(),
    { ceremonyId: input?.ceremonyId, response: input?.response },
    await deps(),
  );
  if (res.ok) revalidatePath("/admin");
  return res;
}

export async function revokeKeyAction(input: { credentialId: string }): Promise<RevokeKeyResult> {
  const res = await revokeKey(await getViewer(), { credentialId: input?.credentialId }, await deps());
  if (res.ok) revalidatePath("/admin");
  return res;
}
