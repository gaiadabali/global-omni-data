"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isDevAuthEnabled } from "./dev-auth";
import { DEV_ROLE_COOKIE, isDevRoleValue } from "./dev-roles";

/**
 * Dev role switch. Each action checks the dev sign-in guard itself, because a server action is a public
 * endpoint: hiding the switch in the UI is not a check.
 */
export async function setDevRole(role: string): Promise<{ ok: boolean }> {
  if (!isDevAuthEnabled()) return { ok: false };
  if (!isDevRoleValue(role)) return { ok: false };
  const jar = await cookies();
  jar.set(DEV_ROLE_COOKIE, role, { httpOnly: true, sameSite: "strict", path: "/" });
  return { ok: true };
}

export async function clearDevRole(): Promise<void> {
  if (isDevAuthEnabled()) (await cookies()).delete(DEV_ROLE_COOKIE);
  redirect("/signin");
}

/** Form action for the plain role list at /dev-role. */
export async function chooseDevRole(formData: FormData): Promise<void> {
  const role = String(formData.get("role") ?? "");
  const res = await setDevRole(role);
  if (res.ok) redirect("/");
  redirect("/signin");
}
