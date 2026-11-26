import { describe, expect, it } from "vitest";
import { DevAuthRefusedError, assertDevAuthSafe, isDevAuthEnabled } from "../dev-auth";
import {
  AuthConfigError,
  assertAuthConfig,
  authConfigProblems,
  isRealSignInOn,
  readAuthConfig,
} from "./config";
import { deriveKey, open, seal, subLabel } from "./crypto";
import { safeReturnPath } from "./paths";
import { TXN_TTL_MS, openTransaction, sealTransaction } from "./transaction";

const GOOD = {
  YOURTAL_ISSUER: "https://yourtal.gaiada.com/oidc",
  GOD_OIDC_CLIENT_ID: "god-dashboard",
  GOD_OIDC_KEY_FILE: "/opt/god/secrets/oidc-client.jwk.json",
  GOD_PUBLIC_URL: "https://dashboard.god.gaiada.com",
  GOD_SESSION_SECRET: "k".repeat(32),
};
const exists = () => true;

describe("sign-in settings", () => {
  it("accepts the staging settings and derives the redirect URI", () => {
    expect(authConfigProblems(GOOD, exists)).toEqual([]);
    expect(readAuthConfig(GOOD)).toMatchObject({
      redirectUri: "https://dashboard.god.gaiada.com/auth/callback",
      insecure: false,
    });
    expect(isRealSignInOn(GOOD)).toBe(true);
  });

  it("names every missing or bad variable, and never a value", () => {
    const bad = {
      YOURTAL_ISSUER: "http://yourtal.gaiada.com/oidc",
      GOD_PUBLIC_URL: "https://dashboard.god.gaiada.com/app",
      GOD_SESSION_SECRET: "short-secret-value",
    };
    const problems = authConfigProblems(bad, () => false);
    expect(problems.join(" ")).toMatch(
      /YOURTAL_ISSUER.*GOD_OIDC_CLIENT_ID.*GOD_OIDC_KEY_FILE.*GOD_PUBLIC_URL.*GOD_SESSION_SECRET/,
    );
    expect(problems.join(" ")).not.toContain("short-secret-value");
    expect(
      authConfigProblems({ ...GOOD, GOD_SESSION_SECRET: "k".repeat(31) }, exists),
    ).toHaveLength(1);
    expect(authConfigProblems(GOOD, () => false)).toEqual([
      "GOD_OIDC_KEY_FILE does not point at a file",
    ]);
  });

  it("allows plain http only with GOD_DEPLOYMENT=dev", () => {
    const local = {
      ...GOOD,
      YOURTAL_ISSUER: "http://localhost:3001/oidc",
      GOD_PUBLIC_URL: "http://localhost:3000",
    };
    expect(authConfigProblems(local, exists)).toHaveLength(2);
    expect(authConfigProblems({ ...local, GOD_DEPLOYMENT: "dev" }, exists)).toEqual([]);
  });

  it("refuses to start with dev sign-in off and the settings missing; dev sign-in skips the check", () => {
    expect(() => assertAuthConfig({}, exists)).toThrow(AuthConfigError);
    expect(() => assertAuthConfig({ GOD_DEPLOYMENT: "production" }, exists)).toThrow(
      /YOURTAL_ISSUER/,
    );
    expect(() => assertAuthConfig(GOOD, exists)).not.toThrow();
    expect(() =>
      assertAuthConfig({ GOD_DEV_AUTH: "1", GOD_DEPLOYMENT: "dev" }, exists),
    ).not.toThrow();
  });

  it("never runs real sign-in while dev sign-in is on: never both", () => {
    const both = { ...GOOD, GOD_DEV_AUTH: "1", GOD_DEPLOYMENT: "dev" };
    expect(isDevAuthEnabled(both)).toBe(true);
    expect(isRealSignInOn(both)).toBe(false);
  });

  it("the dev guard is as strict as before: dev sign-in outside dev still refuses to start", () => {
    for (const deployment of [undefined, "staging", "production", "Dev", "dev "]) {
      const env = { ...GOOD, GOD_DEV_AUTH: "1", GOD_DEPLOYMENT: deployment };
      expect(isDevAuthEnabled(env)).toBe(false);
      expect(() => assertDevAuthSafe(env)).toThrow(DevAuthRefusedError);
      // And it is not quietly replaced by real sign-in either.
      expect(isRealSignInOn(env)).toBe(false);
    }
  });
});

describe("the transaction cookie", () => {
  const SECRET = "s".repeat(40);
  const T0 = Date.parse("2026-11-26T00:00:00Z");
  const t = {
    state: "st",
    nonce: "no",
    codeVerifier: "cv",
    returnTo: "/admin",
    freshFor: null,
    startedAt: T0,
  };

  it("round-trips, and holds nothing readable", () => {
    const sealed = sealTransaction(t, SECRET);
    expect(openTransaction(sealed, SECRET, T0 + 1000)).toEqual(t);
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toMatch(/admin|"state"/);
  });

  it("is tamper-proof: any changed byte, a truncation or another secret fails", () => {
    const sealed = sealTransaction(t, SECRET);
    const raw = Buffer.from(sealed, "base64url");
    for (let i = 0; i < raw.length; i += 7) {
      const bad = Buffer.from(raw);
      bad[i] = bad[i]! ^ 0x01;
      expect(openTransaction(bad.toString("base64url"), SECRET, T0)).toBeNull();
    }
    expect(openTransaction(sealed.slice(0, -4), SECRET, T0)).toBeNull();
    expect(openTransaction(sealed, "t".repeat(40), T0)).toBeNull();
    expect(openTransaction("", SECRET, T0)).toBeNull();
    expect(openTransaction(undefined, SECRET, T0)).toBeNull();
  });

  it("lasts 10 minutes", () => {
    const sealed = sealTransaction(t, SECRET);
    expect(openTransaction(sealed, SECRET, T0 + TXN_TTL_MS - 1)).not.toBeNull();
    expect(openTransaction(sealed, SECRET, T0 + TXN_TTL_MS)).toBeNull();
  });

  it("cannot be swapped with another sealed value: each purpose has its own key and label", () => {
    const k = deriveKey(SECRET, "oidc-transaction-v1");
    expect(deriveKey(SECRET, "audit-sub-v1").equals(k)).toBe(false);
    expect(open(seal("x", k, "other-use"), k, "god-oidc-transaction")).toBeNull();
  });

  it("labels a sub for the audit log without revealing it", () => {
    const label = subLabel("q8mE3s0dW9xYbVvLr2H4tA", SECRET);
    expect(label).toMatch(/^sub#[0-9a-f]{16}$/);
    expect(label).toBe(subLabel("q8mE3s0dW9xYbVvLr2H4tA", SECRET));
    expect(label).not.toBe(subLabel("q8mE3s0dW9xYbVvLr2H4tA", "t".repeat(40)));
    expect(subLabel(null, SECRET)).toBe("sub#none");
  });
});

describe("return paths", () => {
  it("keeps same-origin paths and their query", () => {
    expect(safeReturnPath("/insight?entity=harbour")).toBe("/insight?entity=harbour");
    expect(safeReturnPath("/person?id=G-AAAA-BBBB")).toBe("/person?id=G-AAAA-BBBB");
  });

  it("refuses anything that could leave the site or loop", () => {
    for (const bad of [
      "https://evil.example/",
      "//evil.example/x",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "/a\nb",
      "admin",
      "",
      "/auth/start?fresh=1",
      "/auth/callback",
      "/signin",
      `/${"a".repeat(600)}`,
      null,
    ]) {
      expect(safeReturnPath(bad)).toBeNull();
    }
  });
});
