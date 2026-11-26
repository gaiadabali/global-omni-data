/**
 * The dev cookie's values and labels. Pure data with no server-only imports, so the role switch (a client
 * component) can use it. The viewer seam that reads the cookie is in ./viewer.ts.
 */
export const DEV_ROLE_COOKIE = "god_dev_role";

export const DEV_ROLE_VALUES = [
  "owner",
  "executive",
  "data",
  "brand_lead_yourtal",
  "brand_lead_snapapp",
  "brand_lead_ftr",
] as const;
export type DevRoleValue = (typeof DEV_ROLE_VALUES)[number];

export const DEV_ROLE_LABELS: Record<DevRoleValue, string> = {
  owner: "Owner",
  executive: "Executive",
  data: "Data team",
  brand_lead_yourtal: "Brand lead (YourTal)",
  brand_lead_snapapp: "Brand lead (SnapApp)",
  brand_lead_ftr: "Brand lead (Free Tax Returns)",
};

export function isDevRoleValue(v: string | undefined): v is DevRoleValue {
  return (DEV_ROLE_VALUES as readonly string[]).includes(v ?? "");
}
