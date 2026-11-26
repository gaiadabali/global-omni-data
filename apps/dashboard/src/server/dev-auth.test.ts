import { describe, expect, it } from "vitest";
import {
  assertDevAuthSafe,
  DevAuthRefusedError,
  devAuthState,
  isDevAuthEnabled,
  type DevAuthState,
} from "./dev-auth";

const devAuthValues = [undefined, "", "0", "1", "true", "yes", " 1"];
const deployments = [undefined, "", "dev", "DEV", "development", "staging", "production", "prod"];

describe("dev sign-in guard: every combination", () => {
  for (const auth of devAuthValues) {
    for (const dep of deployments) {
      const env = { GOD_DEV_AUTH: auth, GOD_DEPLOYMENT: dep };
      const expected: DevAuthState = auth !== "1" ? "off" : dep === "dev" ? "on" : "refuse";

      it(`GOD_DEV_AUTH=${JSON.stringify(auth)} GOD_DEPLOYMENT=${JSON.stringify(dep)} is ${expected}`, () => {
        expect(devAuthState(env)).toBe(expected);
        expect(isDevAuthEnabled(env)).toBe(expected === "on");
        if (expected === "refuse") {
          expect(() => assertDevAuthSafe(env)).toThrow(DevAuthRefusedError);
        } else {
          expect(() => assertDevAuthSafe(env)).not.toThrow();
        }
      });
    }
  }

  it("is on only for exactly GOD_DEV_AUTH=1 and GOD_DEPLOYMENT=dev", () => {
    const on = devAuthValues.flatMap((a) =>
      deployments.filter((d) => isDevAuthEnabled({ GOD_DEV_AUTH: a, GOD_DEPLOYMENT: d })).map((d) => [a, d]),
    );
    expect(on).toEqual([["1", "dev"]]);
  });

  it("names the deployment in the refusal and never mentions a secret", () => {
    expect(() => assertDevAuthSafe({ GOD_DEV_AUTH: "1", GOD_DEPLOYMENT: "production" })).toThrow(
      /GOD_DEPLOYMENT is "production"/,
    );
    expect(() => assertDevAuthSafe({ GOD_DEV_AUTH: "1" })).toThrow(/not set/);
  });

  it("reads process.env by default", () => {
    const before = { a: process.env.GOD_DEV_AUTH, d: process.env.GOD_DEPLOYMENT };
    try {
      process.env.GOD_DEV_AUTH = "1";
      process.env.GOD_DEPLOYMENT = "staging";
      expect(isDevAuthEnabled()).toBe(false);
      expect(() => assertDevAuthSafe()).toThrow(DevAuthRefusedError);
      process.env.GOD_DEPLOYMENT = "dev";
      expect(isDevAuthEnabled()).toBe(true);
    } finally {
      if (before.a === undefined) delete process.env.GOD_DEV_AUTH;
      else process.env.GOD_DEV_AUTH = before.a;
      if (before.d === undefined) delete process.env.GOD_DEPLOYMENT;
      else process.env.GOD_DEPLOYMENT = before.d;
    }
  });
});
