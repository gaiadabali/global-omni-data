import { describe, expect, it } from "vitest";
import { passwordSignInAllowed } from "./config";
import { isFreshAuth, strongEnough } from "./fresh";

// The staging-only switch (founder, 2026-11-27): a password is accepted only while GOD_ALLOW_PASSWORD_SIGNIN=1.
describe("GOD_ALLOW_PASSWORD_SIGNIN", () => {
  const on = { GOD_ALLOW_PASSWORD_SIGNIN: "1" };
  const off = {};

  it("is off unless set to exactly 1", () => {
    expect(passwordSignInAllowed(off)).toBe(false);
    expect(passwordSignInAllowed({ GOD_ALLOW_PASSWORD_SIGNIN: "true" })).toBe(false);
    expect(passwordSignInAllowed(on)).toBe(true);
  });

  it("always accepts a passkey", () => {
    expect(strongEnough(["hwk"], off)).toBe(true);
    expect(strongEnough(["hwk"], on)).toBe(true);
  });

  it("accepts a password or password plus code only while the switch is on", () => {
    for (const amr of [["pwd"], ["mfa"], ["pwd", "mfa"]]) {
      expect(strongEnough(amr, off)).toBe(false);
      expect(strongEnough(amr, on)).toBe(true);
    }
  });

  it("never accepts an empty or unknown amr", () => {
    expect(strongEnough([], on)).toBe(false);
    expect(strongEnough(["otp-sms"], on)).toBe(false);
  });

  it("the fresh check follows the process switch (off in tests)", () => {
    const now = Date.now();
    expect(isFreshAuth({ authTime: new Date(now - 1000).toISOString(), amr: ["pwd"] }, now)).toBe(false);
    expect(isFreshAuth({ authTime: new Date(now - 1000).toISOString(), amr: ["hwk"] }, now)).toBe(true);
  });
});
