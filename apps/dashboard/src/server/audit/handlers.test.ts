import { describe, expect, it } from "vitest";
import { allProfiles, featuredProfiles } from "@god/synthetic";
import { allowListStore } from "../data/allowlist";
import type { Viewer } from "../types";
import { viewerFromDevCookie } from "../viewer";
import { handleExport, handleInvite, handleOpenProfile, handleRevokeSession, type InviteInput } from "./handlers";
import { createMemoryAuditLog } from "./memory";

const viewer = (cookie: string): Viewer => {
  const v = viewerFromDevCookie(cookie);
  if (!v) throw new Error(cookie);
  return v;
};

describe("open a profile", () => {
  const id = featuredProfiles().adult.id;
  const teenId = featuredProfiles().teen;

  it("needs a category and a real line of text, and writes nothing without them", async () => {
    const audit = createMemoryAuditLog();
    const owner = viewer("owner");
    for (const bad of [
      { id, reasonId: "", note: "A perfectly fine note" },
      { id, reasonId: "made-up", note: "A perfectly fine note" },
      { id, reasonId: "geocoding", note: "short" },
      { id, reasonId: "geocoding", note: "x".repeat(401) },
    ]) {
      expect(await handleOpenProfile(owner, bad, { audit })).toMatchObject({ ok: false });
    }
    expect(await audit.list()).toHaveLength(0);
  });

  it("writes one audit event with the person, the target and the reason", async () => {
    const audit = createMemoryAuditLog();
    const res = await handleOpenProfile(viewer("data"), { id: id.toLowerCase(), reasonId: "geocoding", note: "  Home area looks too wide  " }, { audit });
    expect(res).toEqual({ ok: true, outcome: "opened", id });
    const events = await audit.list();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      who: "dev-data",
      action: "person.open",
      target: id,
      reason: "Confirm a geocoding result: Home area looks too wide",
      outcome: "done",
    });
  });

  it("refuses a teen id and records the refusal", async () => {
    const audit = createMemoryAuditLog();
    const res = await handleOpenProfile(viewer("owner"), { id: teenId, reasonId: "other", note: "Trying a teen id on purpose" }, { audit });
    expect(res).toEqual({ ok: true, outcome: "teen-refused", id: teenId });
    const [ev] = await audit.list();
    expect(ev).toMatchObject({ action: "person.open", target: teenId, outcome: "refused" });
  });

  it("is for the Owner and Data team only", async () => {
    const audit = createMemoryAuditLog();
    for (const who of [viewer("executive"), viewer("brand_lead_yourtal"), null]) {
      expect(await handleOpenProfile(who, { id, reasonId: "geocoding", note: "A perfectly fine note" }, { audit })).toMatchObject({ ok: false });
    }
    expect(await audit.list()).toHaveLength(0);
    expect(allProfiles().some((p) => p.id === id)).toBe(true);
  });
});

describe("export a report", () => {
  it("records the export and sends the browser to the print view", async () => {
    const audit = createMemoryAuditLog();
    const res = await handleExport(viewer("executive"), { kind: "insight", entity: "harbour" }, { audit });
    expect(res).toEqual({
      ok: true,
      reportName: "Harbour & Bean",
      printPath: "/insight?entity=harbour&print=1&auto=1",
    });
    const [ev] = await audit.list();
    expect(ev).toMatchObject({ who: "dev-executive", action: "export.pdf", target: "insight:harbour", reason: "Brand insight report: Harbour & Bean (PDF)" });
  });

  it("covers the teen report too, but never a sensitive category", async () => {
    const audit = createMemoryAuditLog();
    expect(await handleExport(viewer("owner"), { kind: "teens", entity: "kidzone" }, { audit })).toMatchObject({ ok: true });
    expect(await handleExport(viewer("owner"), { kind: "teens", entity: "cat-pharm" }, { audit })).toMatchObject({ ok: false });
    expect(await audit.list()).toHaveLength(1);
  });

  it("refuses a brand lead, an unknown report and an unknown kind, and records nothing", async () => {
    const audit = createMemoryAuditLog();
    expect(await handleExport(viewer("brand_lead_yourtal"), { kind: "insight", entity: "harbour" }, { audit })).toMatchObject({ ok: false });
    expect(await handleExport(viewer("owner"), { kind: "insight", entity: "nope" }, { audit })).toMatchObject({ ok: false });
    expect(await handleExport(viewer("owner"), { kind: "map", entity: "harbour" }, { audit })).toMatchObject({ ok: false });
    expect(await handleExport(null, { kind: "insight", entity: "harbour" }, { audit })).toMatchObject({ ok: false });
    expect(await audit.list()).toHaveLength(0);
  });
});

describe("invite", () => {
  const good = (over: Partial<InviteInput> = {}): InviteInput => ({
    name: "Riley Tran",
    handle: "@riley.tran",
    role: "executive",
    agreementSigned: "2026-11-24",
    originalHeldBy: "Alex Morgan",
    ...over,
  });

  it("needs a signed-agreement date that is a real date and not in the future", async () => {
    const audit = createMemoryAuditLog();
    for (const bad of ["", "not a date", "2026-13-40", "2026-11-27", "2019-12-31"]) {
      const res = await handleInvite(viewer("owner"), good({ agreementSigned: bad }), { audit });
      expect(res).toMatchObject({ ok: false });
    }
    expect(await audit.list()).toHaveLength(0);
  });

  it("adds the person to the allow-list and records the invitation", async () => {
    const audit = createMemoryAuditLog();
    const res = await handleInvite(viewer("owner"), good({ handle: "riley.tran.one" }), { audit });
    expect(res).toEqual({ ok: true, name: "Riley Tran" });
    const added = allowListStore.list().find((p) => p.handle === "@riley.tran.one");
    expect(added).toMatchObject({ role: "executive", agreementSigned: "2026-11-24", status: "invited", lastSignIn: null });
    const [ev] = await audit.list();
    expect(ev).toMatchObject({ who: "dev-owner", action: "allowlist.invite", target: "@riley.tran.one" });
    expect(ev?.reason).toContain("24 Nov 2026");
    // The same person twice is refused, and records nothing more.
    expect(await handleInvite(viewer("owner"), good({ handle: "@riley.tran.one" }), { audit })).toMatchObject({ ok: false });
    expect(await audit.list()).toHaveLength(1);
  });

  it("a brand lead needs a brand; others need none", async () => {
    const audit = createMemoryAuditLog();
    expect(await handleInvite(viewer("owner"), good({ handle: "@lead.two", role: "brand_lead" }), { audit })).toMatchObject({ ok: false });
    expect(await handleInvite(viewer("owner"), good({ handle: "@lead.two", role: "brand_lead", brand: "ftr" }), { audit })).toMatchObject({ ok: true });
    expect(allowListStore.list().find((p) => p.handle === "@lead.two")).toMatchObject({ role: "brand_lead", brand: "ftr" });
    expect(await handleInvite(viewer("owner"), good({ handle: "@lead.three", role: "wizard" }), { audit })).toMatchObject({ ok: false });
  });

  it("is for the Owner only", async () => {
    const audit = createMemoryAuditLog();
    for (const who of [viewer("data"), viewer("executive"), viewer("brand_lead_ftr"), null]) {
      expect(await handleInvite(who, good({ handle: "@nobody.here" }), { audit })).toMatchObject({ ok: false });
    }
    expect(await audit.list()).toHaveLength(0);
    expect(allowListStore.list().some((p) => p.handle === "@nobody.here")).toBe(false);
  });
});

describe("revoke a session", () => {
  it("records the request and ends nothing; your own session is refused", async () => {
    const audit = createMemoryAuditLog();
    const owner = viewer("owner");
    expect(await handleRevokeSession(owner, { sessionId: "s-1" }, { audit })).toMatchObject({ ok: false });
    expect(await handleRevokeSession(owner, { sessionId: "s-nope" }, { audit })).toMatchObject({ ok: false });
    expect(await audit.list()).toHaveLength(0);

    expect(await handleRevokeSession(owner, { sessionId: "s-2" }, { audit })).toEqual({ ok: true, person: "Jordan Lee" });
    const [ev] = await audit.list();
    expect(ev).toMatchObject({ who: "dev-owner", action: "session.revoke", target: "Jordan Lee (s-2)" });
    expect(ev?.reason).toContain("no session was ended");
  });

  it("is for the Owner only", async () => {
    const audit = createMemoryAuditLog();
    expect(await handleRevokeSession(viewer("data"), { sessionId: "s-2" }, { audit })).toMatchObject({ ok: false });
    expect(await audit.list()).toHaveLength(0);
  });
});
