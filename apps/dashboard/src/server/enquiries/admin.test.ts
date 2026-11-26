import { describe, expect, it } from "vitest";
import { allowedInEmergency, canAccessPage } from "../access";
import { handleEnquiryUpdate, type Deps } from "../audit/handlers";
import { createMemoryAuditLog } from "../audit/memory";
import { EMERGENCY_REFUSED } from "../auth/fresh";
import { DataAccessError, getDashboardData } from "../data";
import { syntheticData } from "../data/synthetic";
import { createMemoryAllowList, createMemoryEnquiryStore, createMemorySessionStore } from "../store/memory";
import { ALLOW_LIST_SEED, ENQUIRY_SEED } from "../store/seed";
import type { Viewer } from "../types";
import { DEV_ROLE_VALUES, viewerFromDevCookie } from "../viewer";

const viewer = (cookie: string): Viewer => {
  const v = viewerFromDevCookie(cookie);
  if (!v) throw new Error(cookie);
  return v;
};

function setup() {
  const audit = createMemoryAuditLog();
  const enquiries = createMemoryEnquiryStore({ seed: ENQUIRY_SEED });
  const stores = {
    allowList: createMemoryAllowList({ seed: ALLOW_LIST_SEED }),
    sessions: createMemorySessionStore(),
    enquiries,
  };
  const deps: Deps = { audit, stores, now: () => Date.parse("2026-11-27T02:00:00Z") };
  return { audit, enquiries, stores, deps };
}

const NEW_ID = "enq_seed01";

describe("who can open the Enquiries tab: the Admin page gate", () => {
  it("only an Owner. An Executive cannot open Admin, so cannot read enquiries (a deliberate choice)", () => {
    for (const cookie of DEV_ROLE_VALUES) {
      expect(canAccessPage(viewer(cookie), "admin"), cookie).toBe(cookie === "owner");
    }
    expect(canAccessPage(null, "admin")).toBe(false);
  });

  it("the data layer refuses every other role too, by itself", async () => {
    const { audit, stores } = setup();
    for (const cookie of DEV_ROLE_VALUES.filter((c) => c !== "owner")) {
      const d = getDashboardData(viewer(cookie), syntheticData, audit, stores);
      await expect(d.adminEnquiries(), cookie).rejects.toBeInstanceOf(DataAccessError);
    }
  });

  it("an Owner reads them newest first, with the count of new ones and who handled each", async () => {
    const { audit, stores } = setup();
    const v = await getDashboardData(viewer("owner"), syntheticData, audit, stores).adminEnquiries();
    expect(v.rows[0]?.id).toBe("enq_seed01");
    expect(v.rows.map((r) => r.receivedAt)).toEqual([...v.rows.map((r) => r.receivedAt)].sort().reverse());
    expect(v.matching).toBe(ENQUIRY_SEED.length);
    expect(v.newCount).toBe(2);
    expect(v.rows.find((r) => r.id === "enq_seed03")?.handledByName).toBe("Alex Morgan");
    expect(v.rows.find((r) => r.id === NEW_ID)?.handledByName).toBeNull();
  });

  it("filters by status and by text", async () => {
    const { audit, stores } = setup();
    const d = getDashboardData(viewer("owner"), syntheticData, audit, stores);
    expect((await d.adminEnquiries({ status: "open" })).rows.map((r) => r.status)).not.toContain("archived");
    expect((await d.adminEnquiries({ status: "archived" })).matching).toBe(2);
    const found = await d.adminEnquiries({ q: "pharmac" });
    expect(found.rows.map((r) => r.id)).toEqual(["enq_seed02"]);
    expect(found.newCount).toBe(2);
  });
});

describe("handleEnquiryUpdate", () => {
  it("marks an enquiry read, and the audit log records it with the id and nothing the visitor wrote", async () => {
    const { audit, enquiries, deps } = setup();
    const res = await handleEnquiryUpdate(viewer("owner"), { id: NEW_ID, status: "read" }, deps);
    expect(res).toEqual({ ok: true, id: NEW_ID, status: "read", unchanged: false });
    expect(await enquiries.find(NEW_ID)).toMatchObject({ status: "read", handledBy: "dev-owner" });
    const events = await audit.list();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      who: "dev-owner",
      action: "enquiry.update",
      target: NEW_ID,
      reason: "Marked as read (was new)",
      outcome: "done",
    });
    const seed = ENQUIRY_SEED.find((e) => e.id === NEW_ID)!;
    const written = JSON.stringify(events[0]);
    for (const secret of [seed.name, seed.company, seed.email, seed.want]) expect(written).not.toContain(secret);
  });

  it("archives and restores, one audit event each", async () => {
    const { audit, enquiries, deps } = setup();
    await handleEnquiryUpdate(viewer("owner"), { id: NEW_ID, status: "archived" }, deps);
    expect((await enquiries.find(NEW_ID))?.status).toBe("archived");
    await handleEnquiryUpdate(viewer("owner"), { id: NEW_ID, status: "read" }, deps);
    await handleEnquiryUpdate(viewer("owner"), { id: NEW_ID, status: "new" }, deps);
    expect(await enquiries.find(NEW_ID)).toMatchObject({ status: "new", handledBy: null, handledAt: null });
    expect((await audit.list()).map((e) => e.reason).reverse()).toEqual([
      "Archived (was new)",
      "Marked as read (was archived)",
      "Marked as new (was read)",
    ]);
  });

  it("a change to the status it already has is a quiet no-op: no write, no audit event", async () => {
    const { audit, deps } = setup();
    expect(await handleEnquiryUpdate(viewer("owner"), { id: NEW_ID, status: "new" }, deps)).toMatchObject({ ok: true, unchanged: true });
    expect(await audit.list()).toHaveLength(0);
  });

  it("refuses an unknown status or an unknown enquiry, writing nothing", async () => {
    const { audit, deps } = setup();
    for (const status of ["", "deleted", "NEW", "read ", "__proto__"]) {
      expect(await handleEnquiryUpdate(viewer("owner"), { id: NEW_ID, status }, deps), status).toMatchObject({ ok: false });
    }
    expect(await handleEnquiryUpdate(viewer("owner"), { id: "enq_nope", status: "read" }, deps)).toEqual({
      ok: false,
      error: "That enquiry is not in the list.",
    });
    expect(await audit.list()).toHaveLength(0);
  });

  it("every role but Owner is refused, and so is no one at all; nothing changes and nothing is audited", async () => {
    const { audit, enquiries, deps } = setup();
    for (const cookie of DEV_ROLE_VALUES.filter((c) => c !== "owner")) {
      expect(await handleEnquiryUpdate(viewer(cookie), { id: NEW_ID, status: "read" }, deps), cookie).toMatchObject({ ok: false });
    }
    expect(await handleEnquiryUpdate(null, { id: NEW_ID, status: "read" }, deps)).toEqual({ ok: false, error: "Sign in required." });
    expect((await enquiries.find(NEW_ID))?.status).toBe("new");
    expect(await audit.list()).toHaveLength(0);
  });

  it("is a write, so an emergency (break-glass) session is refused, and the refusal is audited", async () => {
    const { audit, enquiries, deps } = setup();
    const emergency: Viewer = { ...viewer("owner"), breakGlass: true };
    expect(allowedInEmergency(emergency, "enquiry.update")).toBe(false);
    expect(await handleEnquiryUpdate(emergency, { id: NEW_ID, status: "read" }, deps)).toEqual({ ok: false, error: EMERGENCY_REFUSED });
    expect((await enquiries.find(NEW_ID))?.status).toBe("new");
    expect((await audit.list()).map((e) => [e.action, e.target, e.outcome])).toEqual([["breakglass.refused", "enquiry.update", "refused"]]);
    // Reading is fine for an emergency Owner: the page gate lets it in.
    expect(canAccessPage(emergency, "admin")).toBe(true);
  });
});
