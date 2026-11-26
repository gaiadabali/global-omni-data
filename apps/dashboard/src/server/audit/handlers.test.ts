import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { allProfiles, featuredProfiles } from "@god/synthetic";
import type { FreshGate } from "../auth/fresh";
import { SESSION_ABSOLUTE_MS } from "../store/limits";
import { createMemoryAllowList, createMemorySessionStore } from "../store/memory";
import { ALLOW_LIST_SEED, devSessionSeed } from "../store/seed";
import type { Viewer } from "../types";
import { viewerFromDevCookie } from "../viewer";
import {
  handleAllowListChange,
  handleExport,
  handleInvite,
  handleOpenProfile,
  handleRevokeAllForPerson,
  handleRevokeSession,
  type Deps,
  type InviteInput,
} from "./handlers";
import { createMemoryAuditLog } from "./memory";

const viewer = (cookie: string): Viewer => {
  const v = viewerFromDevCookie(cookie);
  if (!v) throw new Error(cookie);
  return v;
};

const FRESH: () => Promise<FreshGate> = async () => ({ ok: true });
const STALE: () => Promise<FreshGate> = async () => ({
  ok: false,
  error: "Confirm with your passkey to carry on.",
  freshUrl: "/auth/start?fresh=1",
});

function setup(over: Partial<Deps> = {}) {
  const audit = createMemoryAuditLog();
  const stores = {
    allowList: createMemoryAllowList({ seed: ALLOW_LIST_SEED }),
    sessions: createMemorySessionStore({ seed: devSessionSeed(Date.now()) }),
  };
  return { audit, stores, deps: { audit, stores, fresh: FRESH, ...over } as Deps };
}

describe("open a profile", () => {
  const id = featuredProfiles().adult.id;
  const teenId = featuredProfiles().teen;

  it("needs a category and a real line of text, and writes nothing without them", async () => {
    const { audit, deps } = setup();
    const owner = viewer("owner");
    for (const bad of [
      { id, reasonId: "", note: "A perfectly fine note" },
      { id, reasonId: "made-up", note: "A perfectly fine note" },
      { id, reasonId: "geocoding", note: "short" },
      { id, reasonId: "geocoding", note: "x".repeat(401) },
    ]) {
      expect(await handleOpenProfile(owner, bad, deps)).toMatchObject({ ok: false });
    }
    expect(await audit.list()).toHaveLength(0);
  });

  it("writes one audit event with the person, the target and the reason", async () => {
    const { audit, deps } = setup();
    const res = await handleOpenProfile(
      viewer("data"),
      { id: id.toLowerCase(), reasonId: "geocoding", note: "  Home area looks too wide  " },
      deps,
    );
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
    const { audit, deps } = setup();
    const res = await handleOpenProfile(
      viewer("owner"),
      { id: teenId, reasonId: "other", note: "Trying a teen id on purpose" },
      deps,
    );
    expect(res).toEqual({ ok: true, outcome: "teen-refused", id: teenId });
    const [ev] = await audit.list();
    expect(ev).toMatchObject({ action: "person.open", target: teenId, outcome: "refused" });
  });

  it("is for the Owner and Data team only", async () => {
    const { audit, deps } = setup();
    for (const who of [viewer("executive"), viewer("brand_lead_yourtal"), null]) {
      expect(
        await handleOpenProfile(
          who,
          { id, reasonId: "geocoding", note: "A perfectly fine note" },
          deps,
        ),
      ).toMatchObject({ ok: false });
    }
    expect(await audit.list()).toHaveLength(0);
    expect(allProfiles().some((p) => p.id === id)).toBe(true);
  });
});

describe("export a report", () => {
  it("records the export and sends the browser to the print view", async () => {
    const { audit, deps } = setup();
    const res = await handleExport(
      viewer("executive"),
      { kind: "insight", entity: "harbour" },
      deps,
    );
    expect(res).toEqual({
      ok: true,
      reportName: "Harbour & Bean",
      printPath: "/insight?entity=harbour&print=1&auto=1",
    });
    const [ev] = await audit.list();
    expect(ev).toMatchObject({
      who: "dev-executive",
      action: "export.pdf",
      target: "insight:harbour",
      reason: "Brand insight report: Harbour & Bean (PDF)",
    });
  });

  it("covers the teen report too, but never a sensitive category", async () => {
    const { audit, deps } = setup();
    expect(
      await handleExport(viewer("owner"), { kind: "teens", entity: "kidzone" }, deps),
    ).toMatchObject({ ok: true });
    expect(
      await handleExport(viewer("owner"), { kind: "teens", entity: "cat-pharm" }, deps),
    ).toMatchObject({ ok: false });
    expect(await audit.list()).toHaveLength(1);
  });

  it("refuses a brand lead, an unknown report and an unknown kind, and records nothing", async () => {
    const { audit, deps } = setup();
    expect(
      await handleExport(
        viewer("brand_lead_yourtal"),
        { kind: "insight", entity: "harbour" },
        deps,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await handleExport(viewer("owner"), { kind: "insight", entity: "nope" }, deps),
    ).toMatchObject({ ok: false });
    expect(
      await handleExport(viewer("owner"), { kind: "map", entity: "harbour" }, deps),
    ).toMatchObject({ ok: false });
    expect(await handleExport(null, { kind: "insight", entity: "harbour" }, deps)).toMatchObject({
      ok: false,
    });
    expect(await audit.list()).toHaveLength(0);
  });
});

describe("invite", () => {
  const good = (over: Partial<InviteInput> = {}): InviteInput => ({
    name: "Riley Tran",
    email: "Riley.Tran@Example.com",
    role: "executive",
    agreementSigned: "2026-11-24",
    originalHeldBy: "Alex Morgan",
    ...over,
  });

  it("needs a signed-agreement date that is a real date and not in the future", async () => {
    const { audit, deps } = setup();
    for (const bad of ["", "not a date", "2026-13-40", "2026-11-27", "2019-12-31"]) {
      const res = await handleInvite(viewer("owner"), good({ agreementSigned: bad }), deps);
      expect(res).toMatchObject({ ok: false });
    }
    expect(await audit.list()).toHaveLength(0);
  });

  it("needs a real email address", async () => {
    const { deps } = setup();
    for (const bad of [
      "",
      "@riley.tran",
      "riley",
      "riley@",
      "a b@example.com",
      "riley@example..com",
    ]) {
      expect(await handleInvite(viewer("owner"), good({ email: bad }), deps)).toMatchObject({
        ok: false,
      });
    }
  });

  it("adds the person by lower-case email and records the invitation", async () => {
    const { audit, stores, deps } = setup();
    const res = await handleInvite(viewer("owner"), good(), deps);
    expect(res).toEqual({ ok: true, name: "Riley Tran" });
    const added = (await stores.allowList.list()).find((p) => p.email === "riley.tran@example.com");
    expect(added).toMatchObject({
      role: "executive",
      agreementSigned: "2026-11-24",
      status: "invited",
      lastSignIn: null,
      yourtalSub: null,
      invitedBy: "dev-owner",
    });
    const [ev] = await audit.list();
    expect(ev).toMatchObject({ who: "dev-owner", action: "allowlist.invite", target: added?.id });
    expect(ev?.reason).toContain("24 Nov 2026");
    // The same email twice is refused, and records nothing more.
    expect(
      await handleInvite(viewer("owner"), good({ email: "RILEY.TRAN@example.com" }), deps),
    ).toMatchObject({ ok: false });
    expect(await audit.list()).toHaveLength(1);
  });

  it("a brand lead needs a brand; others need none", async () => {
    const { stores, deps } = setup();
    expect(
      await handleInvite(
        viewer("owner"),
        good({ email: "lead.two@example.com", role: "brand_lead" }),
        deps,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await handleInvite(
        viewer("owner"),
        good({ email: "lead.two@example.com", role: "brand_lead", brand: "ftr" }),
        deps,
      ),
    ).toMatchObject({ ok: true });
    expect(
      (await stores.allowList.list()).find((p) => p.email === "lead.two@example.com"),
    ).toMatchObject({ role: "brand_lead", brand: "ftr" });
    expect(
      await handleInvite(
        viewer("owner"),
        good({ email: "lead.three@example.com", role: "wizard" }),
        deps,
      ),
    ).toMatchObject({ ok: false });
  });

  it("is for the Owner only", async () => {
    const { audit, stores, deps } = setup();
    for (const who of [viewer("data"), viewer("executive"), viewer("brand_lead_ftr"), null]) {
      expect(await handleInvite(who, good({ email: "nobody@example.com" }), deps)).toMatchObject({
        ok: false,
      });
    }
    expect(await audit.list()).toHaveLength(0);
    expect((await stores.allowList.list()).some((p) => p.email === "nobody@example.com")).toBe(
      false,
    );
  });
});

describe("the fresh passkey check gates exports, profile opens, invites and allow-list changes", () => {
  const id = featuredProfiles().adult.id;
  const invite: InviteInput = {
    name: "Riley Tran",
    email: "riley@example.com",
    role: "data",
    agreementSigned: "2026-11-24",
    originalHeldBy: "Alex Morgan",
  };
  const attempts = (deps: Deps) => [
    () => handleExport(viewer("owner"), { kind: "insight", entity: "harbour" }, deps),
    () => handleExport(viewer("owner"), { kind: "teens", entity: "kidzone" }, deps),
    () =>
      handleOpenProfile(
        viewer("owner"),
        { id, reasonId: "geocoding", note: "Home area looks too wide" },
        deps,
      ),
    () => handleInvite(viewer("owner"), invite, deps),
    () => handleAllowListChange(viewer("owner"), { id: "dev-data", change: "suspend" }, deps),
  ];

  it("a stale check sends the browser to /auth/start?fresh=1, and nothing is done or recorded", async () => {
    const { audit, stores, deps } = setup({ fresh: STALE });
    for (const run of attempts(deps)) {
      expect(await run()).toEqual({
        ok: false,
        error: "Confirm with your passkey to carry on.",
        freshUrl: "/auth/start?fresh=1",
      });
    }
    expect(await audit.list()).toHaveLength(0);
    expect((await stores.allowList.find("dev-data"))?.status).toBe("active");
    expect((await stores.allowList.list()).some((e) => e.email === "riley@example.com")).toBe(
      false,
    );
  });

  it("with no gate passed at all, every one is refused (fail closed)", async () => {
    const { audit, deps } = setup();
    delete deps.fresh;
    for (const run of attempts(deps)) expect(await run()).toMatchObject({ ok: false });
    expect(await audit.list()).toHaveLength(0);
  });

  it("a fresh check lets each one through", async () => {
    const { audit, deps } = setup();
    for (const run of attempts(deps)) expect(await run()).toMatchObject({ ok: true });
    expect((await audit.list()).map((e) => e.action).sort()).toEqual([
      "allowlist.change",
      "allowlist.invite",
      "export.pdf",
      "export.pdf",
      "person.open",
    ]);
  });

  it("a role that may not act is told so before any passkey step", async () => {
    const { deps } = setup({ fresh: STALE });
    expect(
      await handleExport(viewer("brand_lead_ftr"), { kind: "insight", entity: "harbour" }, deps),
    ).toEqual({ ok: false, error: "Your role cannot do this." });
    expect(await handleInvite(viewer("data"), invite, deps)).toEqual({
      ok: false,
      error: "Your role cannot do this.",
    });
  });
});

describe("allow-list changes", () => {
  it("suspending or removing someone ends their sessions; reinstating does not start any", async () => {
    const { audit, stores, deps } = setup();
    const now = new Date().toISOString();
    expect((await stores.sessions.listActive(now)).some((s) => s.userId === "dev-data")).toBe(true);
    expect(
      await handleAllowListChange(viewer("owner"), { id: "dev-data", change: "suspend" }, deps),
    ).toMatchObject({ ok: true, status: "suspended", sessionsEnded: 1 });
    expect(
      (await stores.sessions.listActive(new Date().toISOString())).some(
        (s) => s.userId === "dev-data",
      ),
    ).toBe(false);
    expect(
      await handleAllowListChange(viewer("owner"), { id: "dev-data", change: "reinstate" }, deps),
    ).toMatchObject({ ok: true, status: "active", sessionsEnded: 0 });
    expect(
      await handleAllowListChange(
        viewer("owner"),
        { id: "dev-bl-yourtal", change: "remove" },
        deps,
      ),
    ).toMatchObject({ ok: true, status: "removed", sessionsEnded: 1 });
    expect((await audit.list()).map((e) => e.action)).toEqual([
      "allowlist.change",
      "allowlist.change",
      "allowlist.change",
    ]);
  });

  it("a reinstated person who never signed in goes back to invited", async () => {
    const { stores, deps } = setup();
    await handleAllowListChange(viewer("owner"), { id: "u-chen-wei", change: "suspend" }, deps);
    await handleAllowListChange(viewer("owner"), { id: "u-chen-wei", change: "reinstate" }, deps);
    expect((await stores.allowList.find("u-chen-wei"))?.status).toBe("invited");
  });

  it("refuses your own entry, an unknown change and an unknown person", async () => {
    const { deps } = setup();
    expect(
      await handleAllowListChange(viewer("owner"), { id: "dev-owner", change: "suspend" }, deps),
    ).toMatchObject({ ok: false });
    expect(
      await handleAllowListChange(viewer("owner"), { id: "dev-data", change: "promote" }, deps),
    ).toMatchObject({ ok: false });
    expect(
      await handleAllowListChange(viewer("owner"), { id: "nobody", change: "remove" }, deps),
    ).toMatchObject({ ok: false });
    expect(
      await handleAllowListChange(viewer("executive"), { id: "dev-data", change: "remove" }, deps),
    ).toMatchObject({ ok: false });
  });
});

describe("revoke sessions", () => {
  it("ends one session for real and records it; your own current session is refused", async () => {
    const { audit, stores, deps } = setup();
    const owner = viewer("owner");
    // Dev sign-in: the viewer's own sessions count as current.
    expect(await handleRevokeSession(owner, { sessionId: "s-dev-1" }, deps)).toMatchObject({
      ok: false,
    });
    expect(await handleRevokeSession(owner, { sessionId: "s-nope" }, deps)).toMatchObject({
      ok: false,
    });
    expect(await audit.list()).toHaveLength(0);

    expect(await handleRevokeSession(owner, { sessionId: "s-dev-2" }, deps)).toEqual({
      ok: true,
      person: "Jordan Lee",
      ended: 1,
    });
    expect(
      (await stores.sessions.listActive(new Date().toISOString())).map((s) => s.id),
    ).not.toContain("s-dev-2");
    const [ev] = await audit.list();
    expect(ev).toMatchObject({
      who: "dev-owner",
      action: "session.revoke",
      target: "dev-data (s-dev-2)",
    });
  });

  it("with a real session, only that one is yours", async () => {
    const { deps } = setup({ currentSessionId: "s-dev-1" });
    expect(
      await handleRevokeSession(viewer("owner"), { sessionId: "s-dev-1" }, deps),
    ).toMatchObject({ ok: false });
  });

  it("signs one person out everywhere, but not yourself", async () => {
    const { stores, deps } = setup();
    const base = {
      userId: "dev-data",
      createdAt: new Date().toISOString(),
      absoluteExpiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS).toISOString(),
      authTime: new Date().toISOString(),
      amr: ["hwk"],
      userAgent: null,
      ipPrefix: null,
    };
    await stores.sessions.create({
      ...base,
      tokenHash: createHash("sha256").update("x").digest("hex"),
    });
    expect(await handleRevokeAllForPerson(viewer("owner"), { personId: "dev-data" }, deps)).toEqual(
      { ok: true, person: "Jordan Lee", ended: 2 },
    );
    expect(
      await handleRevokeAllForPerson(viewer("owner"), { personId: "dev-owner" }, deps),
    ).toMatchObject({ ok: false });
  });

  it("is for the Owner only", async () => {
    const { audit, deps } = setup();
    expect(await handleRevokeSession(viewer("data"), { sessionId: "s-dev-2" }, deps)).toMatchObject(
      { ok: false },
    );
    expect(
      await handleRevokeAllForPerson(viewer("executive"), { personId: "dev-data" }, deps),
    ).toMatchObject({ ok: false });
    expect(await audit.list()).toHaveLength(0);
  });
});
