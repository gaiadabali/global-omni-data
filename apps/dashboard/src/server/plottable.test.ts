import { describe, expect, it } from "vitest";
import { plottable, plottableCount, presentCount, type CountKind } from "./privacy";
import type { Role } from "./types";

describe("plottableCount", () => {
  it("is exactly plottable(presentCount(...)) for every role, kind and small value", () => {
    const roles: Role[] = ["owner", "executive", "data", "brand_lead"];
    const kinds: CountKind[] = ["adult", "teen", "sensitive"];
    for (const role of roles) {
      for (const kind of kinds) {
        for (let n = 0; n <= 40; n++) {
          const viewer = { role };
          expect(plottableCount(n, { kind, viewer }), `${role} ${kind} ${n}`).toBe(plottable(presentCount(n, { kind, viewer })));
        }
        for (const n of [99.4, 1234.6, 250_000]) {
          expect(plottableCount(n, { kind, viewer: { role } })).toBe(plottable(presentCount(n, { kind, viewer: { role } })));
        }
      }
    }
  });

  it("refuses what presentCount refuses", () => {
    expect(() => plottableCount(-1, { kind: "adult", viewer: { role: "owner" } })).toThrow(RangeError);
    expect(() => plottableCount(Number.NaN, { kind: "adult", viewer: { role: "owner" } })).toThrow(RangeError);
  });
});
