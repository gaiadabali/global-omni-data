import type { AllowListEntry } from "./types";

/**
 * The allow-list store (dev: in memory). Read by the synthetic provider and written by the Admin invite handler.
 * Real storage replaces this file. It lives on globalThis so every route bundle sees the same list.
 *
 * Fictional people. Nothing here is real.
 */
const SEED: readonly AllowListEntry[] = [
  {
    id: "dev-owner",
    name: "Alex Morgan",
    handle: "@alex.m",
    role: "owner",
    agreementSigned: "2026-11-02",
    originalHeldBy: "GOD registered office, safe",
    status: "active",
    lastSignIn: "2026-11-26T09:12:00+11:00",
  },
  {
    id: "dev-executive",
    name: "Priya Nair",
    handle: "@priya.nair",
    role: "executive",
    agreementSigned: "2026-11-09",
    originalHeldBy: "Alex Morgan",
    status: "active",
    lastSignIn: "2026-11-25T16:40:00+11:00",
  },
  {
    id: "dev-data",
    name: "Jordan Lee",
    handle: "@jordan.lee",
    role: "data",
    agreementSigned: "2026-11-09",
    originalHeldBy: "Alex Morgan",
    status: "active",
    lastSignIn: "2026-11-26T08:41:00+11:00",
  },
  {
    id: "u-chen-wei",
    name: "Chen Wei",
    handle: "@chen.w",
    role: "data",
    agreementSigned: "2026-11-16",
    originalHeldBy: "Priya Nair",
    status: "passkey-needed",
    lastSignIn: null,
  },
  {
    id: "dev-bl-yourtal",
    name: "Sam Ortega",
    handle: "@sam.ortega",
    role: "brand_lead",
    brand: "yourtal",
    agreementSigned: "2026-11-18",
    originalHeldBy: "YourTal office, Brisbane",
    status: "active",
    lastSignIn: "2026-11-24T11:03:00+11:00",
  },
  {
    id: "dev-bl-snapapp",
    name: "Taylor Reid",
    handle: "@taylor.reid",
    role: "brand_lead",
    brand: "snapapp",
    agreementSigned: "2026-11-19",
    originalHeldBy: "Alex Morgan",
    status: "active",
    lastSignIn: "2026-11-25T10:20:00+11:00",
  },
  {
    id: "dev-bl-ftr",
    name: "Morgan Blake",
    handle: "@morgan.blake",
    role: "brand_lead",
    brand: "ftr",
    agreementSigned: "2026-11-19",
    originalHeldBy: "Alex Morgan",
    status: "active",
    lastSignIn: "2026-11-23T14:55:00+11:00",
  },
];

type Holder = { __godAllowList?: AllowListEntry[] };

function rows(): AllowListEntry[] {
  const g = globalThis as Holder;
  g.__godAllowList ??= SEED.map((e) => ({ ...e }));
  return g.__godAllowList;
}

export const allowListStore = {
  /** Copies, so a caller cannot change the store by editing a row. */
  list(): AllowListEntry[] {
    return rows().map((e) => ({ ...e }));
  },
  find(id: string): AllowListEntry | undefined {
    const e = rows().find((r) => r.id === id);
    return e ? { ...e } : undefined;
  },
  /** Adds an entry. A handle that is already listed is refused (returns false). */
  add(entry: AllowListEntry): boolean {
    if (rows().some((r) => r.handle.toLowerCase() === entry.handle.toLowerCase() || r.id === entry.id)) return false;
    rows().push({ ...entry });
    return true;
  },
};

/** Who may hold the signed paper original. Listed so the invite form offers a closed set. */
export const ORIGINAL_HOLDERS = [
  "Alex Morgan",
  "Priya Nair",
  "GOD registered office, safe",
  "YourTal office, Brisbane",
] as const;
