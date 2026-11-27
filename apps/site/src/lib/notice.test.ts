import { describe, expect, it } from "vitest";
import { effectiveLabel, groupLabel, NOTICE, privacyEmail } from "./notice";
import { CONTACT_EMAIL } from "./site";

describe("privacy notice facts", () => {
  it("formats the effective date", () => {
    expect(effectiveLabel("2026-11-27")).toBe("27 November 2026");
    expect(effectiveLabel()).toBe("27 November 2026");
  });

  it("falls back without a placeholder while entity, ABN and email are unset", () => {
    const unset = { ...NOTICE, entity: null, abn: null, privacyEmail: null };
    expect(groupLabel(unset)).toBe("the GOD group (Global Omni Data)");
    expect(groupLabel(unset)).not.toMatch(/[[\]]/);
    expect(privacyEmail(unset)).toBe(CONTACT_EMAIL);
  });

  it("renders the current values without a placeholder", () => {
    expect(groupLabel()).not.toMatch(/[[\]]/);
    expect(privacyEmail()).toBe("hello@god.gaiada.com");
  });

  it("uses the real values once they are set", () => {
    const n = {
      ...NOTICE,
      entity: "GOD Pty Ltd",
      abn: "12 345 678 901",
      privacyEmail: "privacy@example.com",
    };
    expect(groupLabel(n)).toBe("the GOD group (Global Omni Data), GOD Pty Ltd, ABN 12 345 678 901");
    expect(privacyEmail(n)).toBe("privacy@example.com");
  });
});
