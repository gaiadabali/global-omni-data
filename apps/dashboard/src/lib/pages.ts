/**
 * The page registry: one entry per page. Titles, paths and nav placement live here; WHO may open a page lives in
 * src/server/access.ts. To add a page, add it here, add its access rule there, then create the route.
 */
export const PAGE_IDS = [
  "home",
  "yourtal",
  "snapapp",
  "ftr",
  "map",
  "activity",
  "insight",
  "teens",
  "person",
  "quality",
  "admin",
] as const;
export type PageId = (typeof PAGE_IDS)[number];

export type IconName =
  | "home"
  | "map"
  | "pin"
  | "target"
  | "spark"
  | "person"
  | "gauge"
  | "shield"
  | "more"
  | "sun"
  | "key"
  | "user"
  | "sw:yt"
  | "sw:sa"
  | "sw:ftr";

export interface PageDef {
  id: PageId;
  path: string;
  title: string;
  /** Plain Australian English, one or two short sentences. */
  sub: string;
  navLabel: string;
  navGroup: "Overview" | "Brands" | "Australia" | "Insight" | "Data" | "Admin";
  icon: IconName;
  /** Label on the phone bar, when this page is shown there. */
  phoneLabel?: string;
}

export const PAGES: Record<PageId, PageDef> = {
  home: {
    id: "home",
    path: "/",
    title: "Group overview",
    sub: "People and businesses registered across YourTal, SnapApp and Free Tax Returns, counted once per person.",
    navLabel: "Group overview",
    navGroup: "Overview",
    icon: "home",
    phoneLabel: "Overview",
  },
  yourtal: {
    id: "yourtal",
    path: "/brands/yourtal",
    title: "YourTal",
    sub: "Watch-to-earn campaigns: viewers earn points, businesses fund the campaigns.",
    navLabel: "YourTal",
    navGroup: "Brands",
    icon: "sw:yt",
    phoneLabel: "YourTal",
  },
  snapapp: {
    id: "snapapp",
    path: "/brands/snapapp",
    title: "SnapApp",
    sub: "Receipt capture for people and small businesses.",
    navLabel: "SnapApp",
    navGroup: "Brands",
    icon: "sw:sa",
  },
  ftr: {
    id: "ftr",
    path: "/brands/ftr",
    title: "Free Tax Returns",
    sub: "Free tax return lodgement for Australians, with SnapApp receipts as deductions.",
    navLabel: "Free Tax Returns",
    navGroup: "Brands",
    icon: "sw:ftr",
  },
  map: {
    id: "map",
    path: "/map",
    title: "Influence map",
    sub: "Where registered people and businesses are, by brand and over time. Zoom in and the areas get smaller.",
    navLabel: "Influence map",
    navGroup: "Australia",
    icon: "map",
    phoneLabel: "Map",
  },
  activity: {
    id: "activity",
    path: "/activity",
    title: "Activity map",
    sub: "Where people spend, from the shop locations on their receipts.",
    navLabel: "Activity map",
    navGroup: "Australia",
    icon: "pin",
  },
  insight: {
    id: "insight",
    path: "/insight",
    title: "Brand insight",
    sub: "Pick a merchant, chain or category and see who shops there. Names here are fictional.",
    navLabel: "Brand insight",
    navGroup: "Insight",
    icon: "target",
    phoneLabel: "Insight",
  },
  teens: {
    id: "teens",
    path: "/teens",
    title: "Teen market",
    sub: "Aged 13 to 17, counted in groups only. Built for kids and youth brands.",
    navLabel: "Teen market",
    navGroup: "Insight",
    icon: "spark",
  },
  person: {
    id: "person",
    path: "/person",
    title: "Person 360",
    sub: "Check how one person is joined across the three apps. Pseudonymous: GOD id only.",
    navLabel: "Person 360",
    navGroup: "Data",
    icon: "person",
    phoneLabel: "Person",
  },
  quality: {
    id: "quality",
    path: "/quality",
    title: "Data quality",
    sub: "Whether GOD matches the apps, how fresh it is, and how teen data is checked.",
    navLabel: "Data quality",
    navGroup: "Data",
    icon: "gauge",
  },
  admin: {
    id: "admin",
    path: "/admin",
    title: "Admin",
    sub: "Who can open the dashboard, what they did, and where they are signed in.",
    navLabel: "Admin",
    navGroup: "Admin",
    icon: "shield",
  },
};

export const NAV_GROUP_ORDER = ["Overview", "Brands", "Australia", "Insight", "Data", "Admin"] as const;

/** Pages shown on the phone bar, in order, before "More". */
export const PHONE_BAR: readonly PageId[] = ["home", "yourtal", "map", "insight", "person"];

export function isPageId(v: string): v is PageId {
  return (PAGE_IDS as readonly string[]).includes(v);
}
