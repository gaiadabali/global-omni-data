import { describe, expect, it } from "vitest";
import { allProfiles, featuredProfiles, teenEntities } from "@god/synthetic";
import { createMemoryAuditLog } from "../audit";
import { createMemoryAllowList, createMemorySessionStore } from "../store/memory";
import { ALLOW_LIST_SEED, devSessionSeed } from "../store/seed";
import type { PNum } from "../privacy";
import type { Viewer } from "../types";
import { viewerFromDevCookie } from "../viewer";
import { DataAccessError, getDashboardData } from "./index";
import { syntheticData } from "./synthetic";
import {
  count,
  isRawCount,
  isRawSeries,
  type DashboardData,
  type RawCount,
  type RawSeries,
} from "./types";

const viewer = (cookie: string): Viewer => {
  const v = viewerFromDevCookie(cookie);
  if (!v) throw new Error(cookie);
  return v;
};

/** Every presented count (PNum) anywhere in a page result. */
function pnums(v: unknown, out: PNum[] = []): PNum[] {
  if (Array.isArray(v)) {
    for (const x of v) pnums(x, out);
  } else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (
      typeof o.display === "string" &&
      typeof o.suppressed === "boolean" &&
      typeof o.value === "number"
    ) {
      out.push(o as unknown as PNum);
    } else {
      for (const x of Object.values(o)) pnums(x, out);
    }
  }
  return out;
}

/** Every raw count or series a provider returned. */
function raws(v: unknown, out: (RawCount | RawSeries)[] = []): (RawCount | RawSeries)[] {
  if (isRawCount(v) || isRawSeries(v)) out.push(v);
  else if (Array.isArray(v)) for (const x of v) raws(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) raws(x, out);
  return out;
}

/** Numbers in presented series (a hidden point is plotted as 0). */
function seriesNumbers(t: {
  teensSeries: number[];
  report: { audienceSeries: number[] };
}): number[] {
  return [...t.teensSeries, ...t.report.audienceSeries];
}

const ROLES = ["owner", "executive", "data"] as const;

describe("teen market", () => {
  it("every teen figure is a group of 20 or more, for every role, the Owner included", async () => {
    for (const role of ROLES) {
      const d = getDashboardData(viewer(role));
      for (const e of teenEntities()) {
        const t = await d.teens({ entity: e.id });
        const all = pnums(t);
        expect(all.length).toBeGreaterThan(40);
        for (const p of all) {
          if (p.suppressed) {
            expect(p.display).toBe("<20");
            expect(p.value).toBe(0);
          } else {
            expect(p.value).toBeGreaterThanOrEqual(20);
          }
        }
        for (const n of seriesNumbers(t)) expect(n === 0 || n >= 20).toBe(true);
      }
    }
  });

  it("a group of 12 teens prints as <20 for the Owner and Data team too, and nobody gets the exact number", async () => {
    const real = await syntheticData.teens({ entity: "kidzone" });
    const small: DashboardData = {
      ...syntheticData,
      teens: async () => ({
        ...real,
        interestsDeclared: [
          { label: "Tiny", value: count(12, "teen") },
          ...real.interestsDeclared.slice(1),
        ],
        report: {
          ...real.report,
          homeAreas: [
            { ...real.report.homeAreas[0]!, people: count(19, "teen") },
            ...real.report.homeAreas.slice(1),
          ],
        },
      }),
    };
    for (const role of ROLES) {
      const t = await getDashboardData(viewer(role), small).teens({});
      expect(t.interestsDeclared[0]?.value).toEqual({ value: 0, display: "<20", suppressed: true });
      expect(t.report.homeAreas[0]?.people).toEqual({ value: 0, display: "<20", suppressed: true });
      expect(JSON.stringify(t)).not.toMatch(/"display":"(12|19)"/);
    }
  });

  it("the provider marks every teen count as teen-kind, and none is sensitive-kind", async () => {
    for (const e of teenEntities()) {
      const raw = await syntheticData.teens({ entity: e.id });
      const nodes = raws(raw);
      expect(nodes.length).toBeGreaterThan(40);
      for (const n of nodes) expect(n.kind).toBe("teen");
    }
  });

  it("never carries alcohol, vape, gambling, pharmacy or health, in any teen report", async () => {
    const banned = /pharm|health|alcohol|vape|vaping|gambl|betting|wagering|liquor/i;
    for (const e of teenEntities()) {
      const json = JSON.stringify(await syntheticData.teens({ entity: e.id }));
      expect(json).not.toMatch(banned);
    }
    const owner = getDashboardData(viewer("owner"));
    const entities = (await owner.teens({})).entities;
    expect(entities.some((e) => /pharm|health/i.test(`${e.id} ${e.name}`))).toBe(false);
  });

  it("refuses a sensitive category outright", async () => {
    await expect(syntheticData.teens({ entity: "cat-pharm" })).rejects.toThrow(/sensitive/);
    await expect(getDashboardData(viewer("owner")).teens({ entity: "cat-pharm" })).rejects.toThrow(
      /sensitive/,
    );
    await expect(getDashboardData(viewer("owner")).teens({ entity: "nope" })).rejects.toThrow(
      /unknown/,
    );
  });

  it("has no occupation or income for teens", async () => {
    const t = await getDashboardData(viewer("executive")).teens({});
    expect(t.report.occupation).toEqual([]);
    expect(t.report.income).toEqual([]);
    expect(t.report.age.map((a) => a.label)).toEqual(["13–14", "15–16", "17"]);
  });
});

describe("brand insight", () => {
  it("export counts are thresholded for everyone: no exact small number reaches a PDF", async () => {
    // A report with groups of 4 and 7 in it, so the threshold has something to hide.
    const real = await syntheticData.insight({ entity: "southern" });
    const small: DashboardData = {
      ...syntheticData,
      insight: async () => ({
        ...real,
        report: {
          ...real.report,
          homeAreas: [
            { ...real.report.homeAreas[0]!, people: count(4) },
            ...real.report.homeAreas.slice(1),
          ],
          segments: [
            { ...real.report.segments[0]!, audience: count(7) },
            ...real.report.segments.slice(1),
          ],
          alsoShopsAt: [
            { label: "Tiny rival", value: count(9, "adult") },
            ...real.report.alsoShopsAt.slice(1),
          ],
        },
      }),
    };

    for (const role of ROLES) {
      const d = getDashboardData(viewer(role), small);
      const printed = await d.insight({ entity: "southern", forExport: true });
      const all = pnums(printed);
      expect(all.length).toBeGreaterThan(30);
      for (const p of all) {
        if (p.suppressed) {
          expect(p.display).toBe("<10");
          expect(p.value).toBe(0);
        } else {
          expect(p.value).toBeGreaterThanOrEqual(10);
        }
      }
      expect(printed.report.homeAreas[0]?.people).toEqual({
        value: 0,
        display: "<10",
        suppressed: true,
      });
      expect(JSON.stringify(printed)).not.toMatch(/small number/);
    }

    // On screen the Owner and Data team still see the exact value, with the marker.
    const screen = await getDashboardData(viewer("owner"), small).insight({ entity: "southern" });
    expect(screen.report.homeAreas[0]?.people).toEqual({
      value: 4,
      display: "4",
      suppressed: true,
    });
    const exec = await getDashboardData(viewer("executive"), small).insight({ entity: "southern" });
    expect(exec.report.homeAreas[0]?.people).toEqual({
      value: 0,
      display: "<10",
      suppressed: true,
    });
  });

  it("sensitive-category reports use the higher threshold", async () => {
    const raw = await syntheticData.insight({ entity: "cat-pharm" });
    const nodes = raws(raw);
    expect(nodes.length).toBeGreaterThan(30);
    for (const n of nodes) expect(n.kind).toBe("sensitive");
  });

  it("refuses an unknown report", async () => {
    await expect(getDashboardData(viewer("owner")).insight({ entity: "nope" })).rejects.toThrow(
      /unknown/,
    );
  });
});

describe("overview: what changed", () => {
  it("prints its numbers through the threshold", async () => {
    const exec = await getDashboardData(viewer("executive")).overview({ period: "month" });
    const owner = await getDashboardData(viewer("owner")).overview({ period: "month" });
    const merge = (o: typeof exec) => o.changes.find((c) => c.title.startsWith("Identity merge"))!;
    // 3 merges undone is under 10: hidden from an executive, exact (and marked) for the Owner.
    expect(merge(exec).detail).toBe("<10 merges undone by the data team");
    expect(merge(owner).detail).toBe("3 (small number) merges undone by the data team");
    expect(exec.changes[0]?.title).toContain("1,420");
    for (const c of exec.changes) expect(`${c.title} ${c.detail}`).not.toMatch(/\{\w+\}/);
  });
});

describe("Person 360", () => {
  const teens = allProfiles().filter((p) => p.teen);
  const adults = allProfiles().filter((p) => !p.teen);

  it("has about 200 profiles, some of them teens, with ids like G-XXXX-XXXX", () => {
    expect(allProfiles()).toHaveLength(200);
    expect(teens.length).toBeGreaterThan(2);
    for (const p of allProfiles()) expect(p.id).toMatch(/^G-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("a teen profile cannot be fetched: no method returns a body, and the provider answers with the id alone", async () => {
    for (const t of teens) {
      expect(await syntheticData.personGet(t.id)).toEqual({ kind: "teen", id: t.id });
    }
    // The contract has no teen variant that carries a profile, and no other way in.
    const methods = Object.keys(syntheticData).filter((k) => /person/i.test(k));
    expect(methods.sort()).toEqual(["personGet", "personSearch"]);
  });

  it("refuses a teen through the data layer for every role, logs it, and never grants access", async () => {
    const audit = createMemoryAuditLog();
    for (const role of ["owner", "data"] as const) {
      const d = getDashboardData(viewer(role), syntheticData, audit);
      for (const t of teens.slice(0, 6)) {
        const got = await d.personGet(t.id);
        expect(got).toEqual({ kind: "teen-refused", id: t.id });
        const opened = await d.personOpen(t.id, "Check a sync or merge problem: trying a teen id");
        expect(opened).toEqual({ kind: "teen-refused", id: t.id });
        expect(await d.personGet(t.id)).toEqual({ kind: "teen-refused", id: t.id });
        expect(JSON.stringify(got)).not.toMatch(/ageBand|accounts|timeline|homeArea|interests/);
      }
    }
    const events = await audit.list();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.outcome === "refused" && e.action === "person.open")).toBe(true);
  });

  it("a teen search hit is an id and nothing more", async () => {
    const rows = await syntheticData.personSearch("");
    const teenRows = rows.filter((r) => r.teen);
    expect(teenRows.length).toBe(teens.length);
    for (const r of teenRows) expect(Object.keys(r).sort()).toEqual(["id", "teen"]);
  });

  it("an adult profile opens only after a reason, and every opening writes an audit event", async () => {
    const audit = createMemoryAuditLog();
    const id = featuredProfiles().adult.id;
    const owner = getDashboardData(viewer("owner"), syntheticData, audit);
    expect(await owner.personGet(id)).toEqual({ kind: "needs-reason", id });
    await expect(owner.personOpen(id, "short")).rejects.toBeInstanceOf(DataAccessError);
    expect(await audit.list()).toHaveLength(0);

    expect(
      await owner.personOpen(id, "Check a sync or merge problem: two accounts joined"),
    ).toEqual({ kind: "opened", id });
    const [ev] = await audit.list();
    expect(ev).toMatchObject({
      who: "dev-owner",
      action: "person.open",
      target: id,
      outcome: "done",
    });
    expect(ev?.reason).toContain("Check a sync or merge problem");

    const got = await owner.personGet(id);
    expect(got.kind).toBe("profile");
    // The grant is the Owner's own: the Data team has not given a reason.
    const data = getDashboardData(viewer("data"), syntheticData, audit);
    expect(await data.personGet(id)).toEqual({ kind: "needs-reason", id });
    // And it shows who accessed it.
    expect((await owner.personAccessedBy(id)).map((a) => a.who)).toEqual(["Alex Morgan"]);
  });

  it("an adult profile holds no name, email, phone or address", async () => {
    for (const p of adults.slice(0, 25)) {
      const got = await syntheticData.personGet(p.id);
      expect(got.kind).toBe("profile");
      const json = JSON.stringify(got);
      expect(json).not.toMatch(/"(name|email|phone|mobile|address|street|dob|birth)\w*"/i);
      expect(json).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    }
  });

  it("person-level receipts leave out sensitive categories", async () => {
    for (const p of adults.slice(0, 60)) {
      const got = await syntheticData.personGet(p.id);
      if (got.kind !== "profile") continue;
      for (const pl of got.profile.places) expect(pl.category).not.toBe("pharm");
      for (const d of got.profile.dots) expect(d.category).not.toBe("pharm");
    }
  });

  it("search takes a GOD id or the start of one, and finds nothing by name", async () => {
    const id = adults[0]!.id;
    expect((await syntheticData.personSearch(id)).map((r) => r.id)).toEqual([id]);
    expect((await syntheticData.personSearch(id.slice(0, 6))).some((r) => r.id === id)).toBe(true);
    expect(await syntheticData.personSearch("Jane Citizen")).toEqual([]);
    expect(await syntheticData.personSearch("jane@example.com")).toEqual([]);
  });
});

describe("each page's data refuses the roles it is not for", () => {
  const people = (c: string) => getDashboardData(viewer(c), syntheticData, createMemoryAuditLog());

  it("brand leads get no insight, teen, person, quality or admin data", async () => {
    for (const c of ["brand_lead_yourtal", "brand_lead_snapapp", "brand_lead_ftr"]) {
      const d = people(c);
      await expect(d.insight({ entity: "southern" })).rejects.toBeInstanceOf(DataAccessError);
      await expect(d.teens({})).rejects.toBeInstanceOf(DataAccessError);
      await expect(d.personSearch("")).rejects.toBeInstanceOf(DataAccessError);
      await expect(d.personGet("G-AAAA-BBBB")).rejects.toBeInstanceOf(DataAccessError);
      await expect(d.quality()).rejects.toBeInstanceOf(DataAccessError);
      await expect(d.adminAllowList()).rejects.toBeInstanceOf(DataAccessError);
      await expect(d.adminAudit()).rejects.toBeInstanceOf(DataAccessError);
    }
  });

  it("executives get no person, quality or admin data; the Data team gets no admin data", async () => {
    const exec = people("executive");
    await expect(exec.personSearch("")).rejects.toBeInstanceOf(DataAccessError);
    await expect(
      exec.personOpen("G-AAAA-BBBB", "Check a sync or merge problem: x"),
    ).rejects.toBeInstanceOf(DataAccessError);
    await expect(exec.quality()).rejects.toBeInstanceOf(DataAccessError);
    await expect(exec.adminSessions(null)).rejects.toBeInstanceOf(DataAccessError);
    await expect(exec.insight({ entity: "southern" })).resolves.toBeDefined();
    await expect(exec.teens({})).resolves.toBeDefined();

    const data = people("data");
    await expect(data.adminAllowList()).rejects.toBeInstanceOf(DataAccessError);
    await expect(data.adminAudit()).rejects.toBeInstanceOf(DataAccessError);
    await expect(data.quality()).resolves.toBeDefined();
    await expect(data.personSearch("")).resolves.toBeDefined();
  });

  it("only the Owner reads the allow-list, the audit log and sessions", async () => {
    const stores = {
      allowList: createMemoryAllowList({ seed: ALLOW_LIST_SEED }),
      sessions: createMemorySessionStore({ seed: devSessionSeed(Date.now()) }),
    };
    const owner = getDashboardData(viewer("owner"), syntheticData, undefined, stores);
    expect((await owner.adminAllowList()).length).toBeGreaterThanOrEqual(5);
    expect((await owner.adminAudit()).rows.length).toBeGreaterThan(0);
    // Dev sign-in has no session id: the viewer's own sessions are "current".
    const sessions = await owner.adminSessions(null);
    expect(sessions.filter((s) => s.current).map((s) => s.person)).toEqual(["Alex Morgan"]);
    expect(sessions.map((s) => s.device)).toContain("Chrome on Windows");
    // With a real session, only that one is "current".
    const marked = await owner.adminSessions("s-dev-2");
    expect(marked.filter((s) => s.current).map((s) => s.id)).toEqual(["s-dev-2"]);
    expect(JSON.stringify(sessions)).not.toMatch(/tokenHash|[0-9a-f]{64}/);
  });
});

describe("data quality", () => {
  it("lists teen verification runs with approvers and destroy dates, all synthetic", async () => {
    const q = await getDashboardData(viewer("owner")).quality();
    const sampled = q.verification.filter((v) => v.kind === "sampled");
    expect(sampled.length).toBeGreaterThanOrEqual(3);
    for (const s of sampled.filter((v) => v.result !== "pending")) {
      expect(s.approvers.length).toBeGreaterThanOrEqual(2);
      expect(s.approvers[0]).toContain("(Owner)");
      expect(s.destroyOn).not.toBeNull();
      const ran = Date.parse(s.ran);
      const destroy = Date.parse(`${s.destroyOn}T03:20:00+11:00`);
      expect(Math.round((destroy - ran) / 86_400_000)).toBe(7);
    }
    expect(q.verification.some((v) => v.kind === "synthetic")).toBe(true);
    expect(q.lag).toHaveLength(3);
    expect(q.merges.undone).toEqual({ value: 7, display: "7", suppressed: true });
  });
});
