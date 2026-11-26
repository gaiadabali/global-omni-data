import { describe, expect, it } from "vitest";
import { plottable, presentCount, seesExactSmallNumbers, toPNum, type CountKind } from "./privacy";
import type { Role } from "./types";

const roles: Role[] = ["owner", "executive", "data", "brand_lead"];
const exactRoles: Role[] = ["owner", "data"];
const restricted: Role[] = ["executive", "brand_lead"];

describe("presentCount: adult figures (threshold 10)", () => {
  it.each(restricted)("%s: 9 is <10 with no exact value", (role) => {
    expect(presentCount(9, { kind: "adult", viewer: { role } })).toEqual({
      display: "<10",
      exact: null,
      suppressed: true,
    });
  });

  it.each(restricted)("%s: 10 is shown as 10", (role) => {
    expect(presentCount(10, { kind: "adult", viewer: { role } })).toEqual({
      display: "10",
      exact: 10,
      suppressed: false,
    });
  });

  it.each(restricted)("%s: 0 is <10 too", (role) => {
    expect(presentCount(0, { kind: "adult", viewer: { role } }).display).toBe("<10");
  });

  it.each(exactRoles)("%s: 9 is exact, marked as a small number", (role) => {
    expect(presentCount(9, { kind: "adult", viewer: { role } })).toEqual({
      display: "9",
      exact: 9,
      suppressed: true,
    });
  });

  it.each(roles)("%s: 10 is never suppressed", (role) => {
    expect(presentCount(10, { kind: "adult", viewer: { role } }).suppressed).toBe(false);
  });
});

describe("presentCount: teen figures (threshold 20 for every role)", () => {
  // Teen data standard (pack tab 3, approved 2026-11-26): every teen figure covers 20 or more teens, and no
  // teen figure under 20 exists for anyone, Owner and Data team included.
  it.each(roles)("%s: 0, 10 and 19 are <20 with no exact value", (role) => {
    for (const n of [0, 10, 19]) {
      expect(presentCount(n, { kind: "teen", viewer: { role } })).toEqual({
        display: "<20",
        exact: null,
        suppressed: true,
      });
    }
  });

  it.each(roles)("%s: 20 is shown as 20", (role) => {
    expect(presentCount(20, { kind: "teen", viewer: { role } })).toEqual({
      display: "20",
      exact: 20,
      suppressed: false,
    });
  });

  it.each(roles)("%s: a small teen count never reaches JSON", (role) => {
    expect(JSON.stringify(toPNum(17, { kind: "teen", viewer: { role } }))).not.toContain("17");
  });
});

describe.each<CountKind>(["sensitive"])("presentCount: %s figures (threshold 20)", (kind) => {
  it.each(restricted)("%s: 19 is <20 and 10 is <20", (role) => {
    for (const n of [0, 10, 19]) {
      expect(presentCount(n, { kind, viewer: { role } })).toEqual({
        display: "<20",
        exact: null,
        suppressed: true,
      });
    }
  });

  it.each(restricted)("%s: 20 is shown as 20", (role) => {
    expect(presentCount(20, { kind, viewer: { role } })).toEqual({
      display: "20",
      exact: 20,
      suppressed: false,
    });
  });

  it.each(exactRoles)("%s: 19 is exact and marked, 20 is plain", (role) => {
    expect(presentCount(19, { kind, viewer: { role } })).toEqual({
      display: "19",
      exact: 19,
      suppressed: true,
    });
    expect(presentCount(20, { kind, viewer: { role } }).suppressed).toBe(false);
  });
});

describe("presentCount: formatting and bad input", () => {
  it("groups thousands", () => {
    expect(presentCount(1234567, { kind: "adult", viewer: { role: "executive" } }).display).toBe(
      "1,234,567",
    );
  });

  it("rejects values that are not counts", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => presentCount(bad, { kind: "adult", viewer: { role: "owner" } })).toThrow(RangeError);
    }
  });

  it("only owner and data see exact small numbers", () => {
    expect(roles.filter((role) => seesExactSmallNumbers({ role }))).toEqual(["owner", "data"]);
  });

  it("never puts the exact value of a suppressed count in a JSON body for a brand role", () => {
    for (const role of restricted) {
      for (const kind of ["adult", "teen", "sensitive"] as const) {
        const small = toPNum(7, { kind, viewer: { role } });
        expect(JSON.stringify(small)).not.toContain("7");
        expect(small).toEqual({ value: 0, display: kind === "adult" ? "<10" : "<20", suppressed: true });
      }
    }
  });

  it("plots the exact value for owner and 0 for a suppressed count for others", () => {
    expect(plottable(presentCount(7, { kind: "adult", viewer: { role: "owner" } }))).toBe(7);
    expect(plottable(presentCount(7, { kind: "adult", viewer: { role: "executive" } }))).toBe(0);
    expect(plottable(presentCount(70, { kind: "adult", viewer: { role: "executive" } }))).toBe(70);
  });
});
