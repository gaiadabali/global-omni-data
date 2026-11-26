import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themeBootstrap } from "./theme-bootstrap";

describe("SECURITY-HEADERS.md", () => {
  const doc = readFileSync(new URL("../../SECURITY-HEADERS.md", import.meta.url), "utf8");

  it("lists the sha256 of the inline theme script", () => {
    const hash = createHash("sha256").update(themeBootstrap).digest("base64");
    expect(doc).toContain(`'sha256-${hash}'`);
  });

  it("is added to the page's meta CSP by astro.config.mjs from the same script", () => {
    const config = readFileSync(new URL("../../astro.config.mjs", import.meta.url), "utf8");
    expect(config).toContain("themeBootstrap");
    expect(config).toContain("scriptDirective");
  });

  it("never allows unsafe-inline or unsafe-eval", () => {
    expect(doc).not.toMatch(/script-src[^;\n]*unsafe-/);
    expect(doc).not.toMatch(/style-src[^;\n]*unsafe-/);
  });
});
