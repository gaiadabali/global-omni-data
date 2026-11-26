import { describe, expect, it } from "vitest";
import { CODE_LENGTH, codeHash, newEnrolmentCode, normaliseCode } from "./break-glass.ts";

describe("break-glass enrolment codes (pure)", () => {
  it("makes 20 Crockford symbols in groups of four, different every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = newEnrolmentCode();
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
      expect(normaliseCode(c)).toHaveLength(CODE_LENGTH);
      seen.add(c);
    }
    expect(seen.size).toBe(200);
  });

  it("normalises case, spaces, dashes and the look-alikes; refuses anything else", () => {
    expect(normaliseCode(" 0123-4567 89ab-cdef-ghjk ")).toBe("0123456789ABCDEFGHJK");
    expect(normaliseCode("O123-4567-89AB-CDEF-GHJK")).toBe("0123456789ABCDEFGHJK");
    expect(normaliseCode("0I23-4567-89AB-CDEF-GHJK")).toBe("0123456789ABCDEFGHJK");
    expect(normaliseCode("0123-4567-89AB-CDEF-GHJ")).toBeNull();
    expect(normaliseCode("0123-4567-89AB-CDEF-GHJKU")).toBeNull();
    expect(normaliseCode("0123-4567-89AB-CDEF-GHJ!")).toBeNull();
    expect(normaliseCode("")).toBeNull();
  });

  it("hashes to the shared test vector (the dashboard's codes.test.ts checks the same value)", () => {
    expect(codeHash("0123456789ABCDEFGHJK")).toBe(
      "9e189e12c1631612f15277ecd293b88f19ac6097a7f62af07e5470c82815e362",
    );
  });
});
