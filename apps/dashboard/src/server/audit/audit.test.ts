import { describe, expect, it } from "vitest";
import { createMemoryAuditLog, getAuditLog, type SeedEvent } from "./index";
import type { AuditEvent, AuditInput } from "./types";

const input = (over: Partial<AuditInput> = {}): AuditInput => ({
  who: "dev-owner",
  action: "export.pdf",
  target: "insight:southern",
  reason: "test",
  ...over,
});

describe("audit log is append-only", () => {
  it("has exactly two methods: append and list. No update, delete or clear", () => {
    const log = createMemoryAuditLog();
    expect(Object.keys(log).sort()).toEqual(["append", "list"]);
    for (const forbidden of ["update", "delete", "remove", "clear", "set", "replace", "events", "splice"]) {
      expect(forbidden in log).toBe(false);
    }
    expect(Object.isFrozen(log)).toBe(true);
    expect(() => {
      (log as unknown as Record<string, unknown>).delete = () => undefined;
    }).toThrow(TypeError);
  });

  it("sets the id, sequence and time itself: a caller cannot choose them", async () => {
    let clock = Date.parse("2026-11-26T01:00:00Z");
    const log = createMemoryAuditLog({ now: () => clock });
    const smuggled = { ...input(), when: "1999-01-01T00:00:00Z", seq: 999, id: "forged" } as AuditInput;
    const a = await log.append(smuggled);
    clock += 60_000;
    const b = await log.append(input({ action: "person.open", target: "G-AAAA-BBBB" }));
    expect(a.when).toBe("2026-11-26T01:00:00.000Z");
    expect(a.seq).toBe(1);
    expect(a.id).toBe("ev-1");
    expect(b.seq).toBe(2);
    expect(b.when).toBe("2026-11-26T01:01:00.000Z");
  });

  it("freezes every event, so a stored event cannot be edited", async () => {
    const log = createMemoryAuditLog();
    const ev = await log.append(input());
    expect(Object.isFrozen(ev)).toBe(true);
    expect(() => {
      (ev as { who: string }).who = "someone-else";
    }).toThrow(TypeError);
    const [again] = await log.list();
    expect(again?.who).toBe("dev-owner");
  });

  it("hands out copies: changing a list result changes nothing in the log", async () => {
    const log = createMemoryAuditLog();
    await log.append(input());
    const first = await log.list();
    expect(() => (first as AuditEvent[]).push(first[0]!)).toThrow(TypeError);
    expect(() => (first as AuditEvent[]).pop()).toThrow(TypeError);
    const second = await log.list();
    expect(second).toHaveLength(1);
    expect(second).not.toBe(first);
  });

  it("refuses an event with no who, no target or an unknown action", async () => {
    const log = createMemoryAuditLog();
    await expect(log.append(input({ who: " " }))).rejects.toThrow(/who/);
    await expect(log.append(input({ target: "" }))).rejects.toThrow(/target/);
    await expect(log.append({ ...input(), action: "event.delete" as never })).rejects.toThrow(/unknown action/);
    expect(await log.list()).toHaveLength(0);
  });

  it("lists newest first and filters by who, action, target, outcome and date", async () => {
    const seed: SeedEvent[] = [
      { when: "2026-11-20T10:00:00+11:00", who: "a", action: "person.open", target: "G-1" },
      { when: "2026-11-22T10:00:00+11:00", who: "b", action: "export.pdf", target: "insight:x" },
      { when: "2026-11-24T23:30:00+11:00", who: "a", action: "person.open", target: "G-2", outcome: "refused" },
    ];
    let clock = Date.parse("2026-11-26T00:00:00Z");
    const log = createMemoryAuditLog({ seed, now: () => clock });
    clock += 1000;
    await log.append(input({ who: "c", action: "session.revoke", target: "s-1" }));

    const all = await log.list();
    expect(all.map((e) => e.who)).toEqual(["c", "a", "b", "a"]);
    expect(all.map((e) => e.seq)).toEqual([4, 3, 2, 1]);

    expect((await log.list({ who: "a" })).map((e) => e.target)).toEqual(["G-2", "G-1"]);
    expect((await log.list({ action: "export.pdf" })).map((e) => e.who)).toEqual(["b"]);
    expect((await log.list({ target: "G-1" })).map((e) => e.who)).toEqual(["a"]);
    expect((await log.list({ outcome: "refused" })).map((e) => e.target)).toEqual(["G-2"]);
    // Dates are Australian Eastern days, inclusive.
    expect((await log.list({ from: "2026-11-22", to: "2026-11-22" })).map((e) => e.who)).toEqual(["b"]);
    expect((await log.list({ from: "2026-11-24", to: "2026-11-24" })).map((e) => e.target)).toEqual(["G-2"]);
    expect((await log.list({ limit: 2 })).map((e) => e.seq)).toEqual([4, 3]);
  });

  it("loads seed history without it being an append, and appends after it", async () => {
    const log = createMemoryAuditLog({
      seed: [{ when: "2026-11-01T00:00:00Z", who: "a", action: "allowlist.change", target: "@x", reason: "r" }],
    });
    expect((await log.list()).map((e) => e.seq)).toEqual([1]);
    const ev = await log.append(input());
    expect(ev.seq).toBe(2);
  });
});

describe("the dev log", () => {
  it("is one shared log, seeded with synthetic history of every action it can show", async () => {
    const a = getAuditLog();
    expect(getAuditLog()).toBe(a);
    const events = await a.list();
    expect(events.length).toBeGreaterThanOrEqual(10);
    const actions = new Set(events.map((e) => e.action));
    for (const act of ["person.open", "export.pdf", "allowlist.invite", "allowlist.change", "session.revoke", "signin.refused"]) {
      expect(actions.has(act as AuditEvent["action"])).toBe(true);
    }
    // Newest first.
    const times = events.map((e) => Date.parse(e.when));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });
});
