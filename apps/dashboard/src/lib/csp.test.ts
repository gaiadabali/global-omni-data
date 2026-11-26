import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "./csp";

describe("buildCsp", () => {
  const prod = buildCsp({ nonce: "abc123", dev: false, upgradeInsecure: true });
  const directive = (csp: string, name: string) =>
    csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("scripts: nonce and strict-dynamic, no unsafe-inline or unsafe-eval in production", () => {
    const s = directive(prod, "script-src");
    expect(s).toContain("'nonce-abc123'");
    expect(s).toContain("'strict-dynamic'");
    expect(s).not.toContain("unsafe-inline");
    expect(s).not.toContain("unsafe-eval");
  });

  it("styles: no unsafe-inline in production", () => {
    expect(directive(prod, "style-src")).toBe("style-src 'self' 'nonce-abc123'");
  });

  it("has the fixed directives", () => {
    for (const d of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "worker-src 'self' blob:",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "default-src 'self'",
    ]) {
      expect(prod.split("; ")).toContain(d);
    }
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("allows unsafe-eval only in dev and leaves out upgrade-insecure-requests when asked", () => {
    const dev = buildCsp({ nonce: "n", dev: true, upgradeInsecure: false });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("makes a fresh nonce each time", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(generateNonce()).not.toBe(a);
  });
});
