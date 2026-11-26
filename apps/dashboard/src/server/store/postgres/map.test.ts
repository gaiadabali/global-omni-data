import type pg from "pg";
import { describe, expect, it } from "vitest";
import { createPostgresAuditLog } from "./audit";
import { normEmail, toAllowEntry, toAuditEvent, toSessionRecord } from "./map";

describe("Postgres row mapping (no database)", () => {
  it("allow-list rows become entries with ISO times and no brand unless set", () => {
    const base = {
      id: "u-1", name: "Ann", email: "ann@example.test", yourtal_sub: null, role: "data" as const, brand: null,
      agreement_signed: "2026-11-02", original_held_by: "Safe", status: "invited" as const, invited_by: "dev-owner",
      invited_at: new Date("2026-11-26T01:02:03.456Z"), last_sign_in: null,
    };
    const e = toAllowEntry(base);
    expect(e).toEqual({
      id: "u-1", name: "Ann", email: "ann@example.test", yourtalSub: null, role: "data", agreementSigned: "2026-11-02",
      originalHeldBy: "Safe", status: "invited", invitedBy: "dev-owner", invitedAt: "2026-11-26T01:02:03.456Z", lastSignIn: null,
    });
    expect("brand" in e).toBe(false);
    const lead = toAllowEntry({ ...base, role: "brand_lead", brand: "ftr", last_sign_in: new Date("2026-11-26T02:00:00Z") });
    expect(lead.brand).toBe("ftr");
    expect(lead.lastSignIn).toBe("2026-11-26T02:00:00.000Z");
  });

  it("session rows become records with ISO times and a frozen amr", () => {
    const s = toSessionRecord({
      id: "ses_1", user_id: "u-1", created_at: new Date("2026-11-26T00:00:00Z"), last_seen_at: new Date("2026-11-26T00:10:00Z"),
      absolute_expires_at: new Date("2026-11-26T08:00:00Z"), auth_time: new Date("2026-11-26T00:00:00Z"), amr: ["hwk"],
      user_agent: null, ip_prefix: "203.0.113.x", revoked_at: null, revoked_by: null,
    });
    expect(s.absoluteExpiresAt).toBe("2026-11-26T08:00:00.000Z");
    expect(s.amr).toEqual(["hwk"]);
    expect(Object.isFrozen(s.amr)).toBe(true);
    expect(s.revokedAt).toBeNull();
  });

  it("audit rows become frozen events; bigint seq arrives as a string", () => {
    const ev = toAuditEvent({
      seq: "42", occurred_at: new Date("2026-11-26T03:04:05.678Z"), who: "u-1", action: "person.open", target: "GOD-1",
      reason: "", outcome: "done",
    });
    expect(ev).toMatchObject({ id: "ev-42", seq: 42, when: "2026-11-26T03:04:05.678Z", outcome: "done" });
    expect(Object.isFrozen(ev)).toBe(true);
  });

  it("emails are trimmed and lower-cased", () => {
    expect(normEmail("  Ann@Example.TEST ")).toBe("ann@example.test");
  });

  it("append validates before it touches the database", async () => {
    const log = createPostgresAuditLog({} as pg.Pool);
    await expect(log.append({ who: " ", action: "person.open", target: "x" })).rejects.toThrow(RangeError);
    await expect(log.append({ who: "a", action: "person.open", target: "" })).rejects.toThrow(RangeError);
    await expect(log.append({ who: "a", action: "nope" as never, target: "x" })).rejects.toThrow(RangeError);
    expect(Object.keys(log).sort()).toEqual(["append", "list"]);
  });
});
