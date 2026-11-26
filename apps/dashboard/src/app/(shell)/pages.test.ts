import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  forbidden: () => {
    throw new Error("FORBIDDEN");
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  usePathname: () => "/",
}));
vi.mock("@/server/viewer", () => ({ getViewer: vi.fn() }));

import { getViewer } from "@/server/viewer";
import type { Viewer } from "@/server/types";
import AdminPage from "./admin/page";
import InsightPage from "./insight/page";
import HomePage from "./page";
import PersonPage from "./person/page";
import QualityPage from "./quality/page";
import TeensPage from "./teens/page";

const V: Record<string, Viewer> = {
  owner: { id: "dev-owner", displayName: "Alex Morgan", role: "owner" },
  executive: { id: "dev-executive", displayName: "Priya Nair", role: "executive" },
  data: { id: "dev-data", displayName: "Jordan Lee", role: "data" },
  brand_lead: { id: "dev-bl-yourtal", displayName: "Sam Ortega", role: "brand_lead", brand: "yourtal" },
};

const empty = { searchParams: Promise.resolve({}) };
const PAGES: Record<string, { page: (p: typeof empty) => Promise<unknown>; allowed: string[] }> = {
  insight: { page: InsightPage, allowed: ["owner", "executive", "data"] },
  teens: { page: TeensPage, allowed: ["owner", "executive", "data"] },
  person: { page: PersonPage, allowed: ["owner", "data"] },
  quality: { page: QualityPage as unknown as (p: typeof empty) => Promise<unknown>, allowed: ["owner", "data"] },
  admin: { page: AdminPage, allowed: ["owner"] },
};

const as = (role: string | null) => vi.mocked(getViewer).mockResolvedValue(role ? V[role]! : null);

describe("each new page refuses the roles it is not for", () => {
  beforeEach(() => vi.mocked(getViewer).mockReset());

  for (const [id, { page, allowed }] of Object.entries(PAGES)) {
    it(`${id}: no one signed in goes to /signin`, async () => {
      as(null);
      await expect(page(empty)).rejects.toThrow("REDIRECT /signin");
    });

    for (const role of Object.keys(V).filter((r) => !allowed.includes(r))) {
      it(`${id}: a ${role} gets a 403 before anything is read`, async () => {
        as(role);
        await expect(page(empty)).rejects.toThrow("FORBIDDEN");
      });
    }

    for (const role of allowed) {
      it(`${id}: a ${role} gets the page`, async () => {
        as(role);
        await expect(page(empty)).resolves.toBeTruthy();
      });
    }
  }
});

describe("the print view and the other query forms", () => {
  beforeEach(() => vi.mocked(getViewer).mockReset());

  it("a refused role gets a 403 on the print view and on a profile link too", async () => {
    as("brand_lead");
    await expect(InsightPage({ searchParams: Promise.resolve({ print: "1" }) })).rejects.toThrow("FORBIDDEN");
    await expect(TeensPage({ searchParams: Promise.resolve({ print: "1", entity: "cat-pharm" }) })).rejects.toThrow("FORBIDDEN");
    as("executive");
    await expect(PersonPage({ searchParams: Promise.resolve({ id: "G-AAAA-BBBB" }) })).rejects.toThrow("FORBIDDEN");
  });

  it("an unknown or sensitive entity falls back to a safe report instead of failing", async () => {
    as("owner");
    await expect(InsightPage({ searchParams: Promise.resolve({ entity: "nope" }) })).resolves.toBeTruthy();
    await expect(TeensPage({ searchParams: Promise.resolve({ entity: "cat-pharm" }) })).resolves.toBeTruthy();
  });
});

describe("the overview for a brand lead", () => {
  beforeEach(() => vi.mocked(getViewer).mockReset());

  it("redirects to their own brand page instead of a 403", async () => {
    as("brand_lead");
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /brands/yourtal");
  });

  it("still sends a brand lead with no brand to a 403, not a redirect loop", async () => {
    vi.mocked(getViewer).mockResolvedValue({ id: "x", displayName: "X", role: "brand_lead" });
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("FORBIDDEN");
  });

  it("gives everyone else the overview, and no one else is redirected", async () => {
    for (const role of ["owner", "executive", "data"]) {
      as(role);
      await expect(HomePage({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
    }
    as(null);
    await expect(HomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT /signin");
  });
});
