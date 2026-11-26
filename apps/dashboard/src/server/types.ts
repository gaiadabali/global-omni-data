export const ROLES = ["owner", "executive", "data", "brand_lead"] as const;
export type Role = (typeof ROLES)[number];

export const BRAND_IDS = ["yourtal", "snapapp", "ftr"] as const;
export type BrandId = (typeof BRAND_IDS)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  executive: "Executive",
  data: "Data team",
  brand_lead: "Brand lead",
};

export const BRAND_LABELS: Record<BrandId, string> = {
  yourtal: "YourTal",
  snapapp: "SnapApp",
  ftr: "Free Tax Returns",
};

/** The signed-in person. The only thing the rest of the app knows about identity. */
export interface Viewer {
  id: string;
  displayName: string;
  role: Role;
  /** Set for a brand lead: the one brand they may see. */
  brand?: BrandId;
}

export function isBrandId(v: string): v is BrandId {
  return (BRAND_IDS as readonly string[]).includes(v);
}
