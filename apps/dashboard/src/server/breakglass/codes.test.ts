import { describe, expect, it } from "vitest";
import { codeHash, newEnrolmentCode, normaliseCode } from "./codes";
import { createCeremonyStore, createRateLimiter } from "./ceremonies";
import { keyLabel, notifyBreakGlass } from "./notify";

describe("enrolment codes", () => {
  it("hash to the same test vector as the server CLI (packages/db/src/break-glass.test.ts)", () => {
    expect(codeHash("0123456789ABCDEFGHJK")).toBe(
      "9e189e12c1631612f15277ecd293b88f19ac6097a7f62af07e5470c82815e362",
    );
  });

  it("round-trip through normalise, forgiving case, spaces and look-alikes", () => {
    const c = newEnrolmentCode();
    expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
    expect(normaliseCode(c.toLowerCase())).toBe(c.replace(/-/g, ""));
    expect(normaliseCode("o123 4567 89ab cdef ghjk")).toBe("0123456789ABCDEFGHJK");
    for (const bad of [null, 42, "", "short", "U".repeat(20), "x".repeat(65)]) expect(normaliseCode(bad)).toBeNull();
  });
});

describe("ceremonies", () => {
  it("are single-use and expire after their time", () => {
    const s = createCeremonyStore({ ttlMs: 1000 });
    const id = s.put({ kind: "signin", challenge: "c1" }, 0);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(s.take(id, 999)).toEqual({ kind: "signin", challenge: "c1" });
    expect(s.take(id, 999)).toBeNull();
    const late = s.put({ kind: "signin", challenge: "c2" }, 0);
    expect(s.take(late, 1000)).toBeNull();
    expect(s.take(42, 0)).toBeNull();
    expect(s.take("../../etc", 0)).toBeNull();
  });

  it("stay bounded: a flood pushes out the oldest", () => {
    const s = createCeremonyStore({ ttlMs: 60_000, max: 3 });
    const ids = [1, 2, 3, 4].map((n) => s.put({ kind: "signin", challenge: `c${n}` }, 0));
    expect(s.take(ids[0], 1)).toBeNull();
    expect(s.take(ids[3], 1)).toMatchObject({ challenge: "c4" });
  });
});

describe("rate limiter", () => {
  it("per prefix and in total, in a sliding window; the first refusal in a window is flagged once", () => {
    const r = createRateLimiter({ windowMs: 100, perPrefix: 2, global: 3 });
    expect(r.take("a", 0)).toEqual({ ok: true });
    expect(r.take("a", 10)).toEqual({ ok: true });
    expect(r.take("a", 20)).toEqual({ ok: false, scope: "prefix", first: true });
    expect(r.take("a", 30)).toEqual({ ok: false, scope: "prefix", first: false });
    expect(r.take("b", 40)).toEqual({ ok: true });
    expect(r.take("c", 50)).toEqual({ ok: false, scope: "global", first: true });
    // The first attempt (t=0) has left the window at t=100.
    expect(r.take("c", 100)).toEqual({ ok: true });
  });
});

describe("the alert hook", () => {
  it("writes one JSON line and never throws", () => {
    const lines: string[] = [];
    notifyBreakGlass({ event: "breakglass.signin", at: "2026-11-27T00:00:00.000Z", ownerId: "u-1", key: keyLabel("abcdefghijklmnop") }, (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      level: "ALERT",
      source: "god-dashboard",
      alert: "break-glass",
      event: "breakglass.signin",
      at: "2026-11-27T00:00:00.000Z",
      ownerId: "u-1",
      key: "key:abcdefghijkl",
    });
    expect(() =>
      notifyBreakGlass({ event: "breakglass.enrol", at: "x", ownerId: "u", key: "k" }, () => {
        throw new Error("disk full");
      }),
    ).not.toThrow();
  });
});
