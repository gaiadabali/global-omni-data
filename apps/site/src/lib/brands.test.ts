import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRANDS } from "./brands";

/** The brand colour rules are binding (AA). This reads the tokens from styles/brands.css and checks each pairing. */
const css = readFileSync(new URL("../styles/brands.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]),
  );
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };
const PAPER = { light: "#f5f6fa", dark: "#0a0c17" };
const CARD = { light: "#ffffff", dark: "#11142a" };

function lum(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** A token's value, failing the test (not typing) when it is missing. */
function tok(t: Record<string, string>, name: string): string {
  const v = t[name];
  if (!v) throw new Error(`missing token ${name}`);
  return v;
}

describe("brand colour tokens", () => {
  const brands = ["snapapp", "yourtal", "ftr"] as const;

  for (const [mode, t] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    for (const b of brands) {
      it(`${b} accent text is AA on the ${mode} page and card (${mode})`, () => {
        expect(ratio(tok(t, `--${b}-text`), tok(PAPER, mode))).toBeGreaterThanOrEqual(4.5);
        expect(ratio(tok(t, `--${b}-text`), tok(CARD, mode))).toBeGreaterThanOrEqual(4.5);
      });
      it(`${b} button text is AA on its fill (${mode})`, () => {
        expect(ratio(tok(t, `--${b}-fill`), tok(t, `--${b}-on-fill`))).toBeGreaterThanOrEqual(4.5);
      });
      it(`${b} stage text is AA on its stage (${mode})`, () => {
        expect(ratio(tok(t, `--${b}-stage`), tok(t, `--${b}-on-stage`))).toBeGreaterThanOrEqual(
          4.5,
        );
      });
    }
  }

  it("never uses a brand fill as text on a light page", () => {
    expect(light["--yourtal-text"]).not.toBe(light["--yourtal-fill"]);
    expect(light["--ftr-text"]).not.toBe(light["--ftr-green"]);
    expect(light["--snapapp-text"]).not.toBe(light["--snapapp-fill"]);
  });

  it("keeps the logo-file colours", () => {
    expect(light["--snapapp-fill"]).toBe("#ea542d");
    expect(light["--yourtal-fill"]).toBe("#ffda00");
    expect(light["--yourtal-plate"]).toBe("#363636");
    expect(light["--ftr-fill"]).toBe("#101529");
    expect(light["--ftr-green"]).toBe("#54be92");
  });
});

describe("brand links", () => {
  it("gives every brand an https site whose host matches the label", () => {
    for (const b of BRANDS) {
      expect(new URL(b.href).protocol).toBe("https:");
      expect(new URL(b.href).host).toBe(b.host);
      if (b.webApp) expect(new URL(b.webApp.href).host).toBe(b.webApp.host);
    }
  });

  it("has exactly one brand key per brand and no Spambank card", () => {
    expect(BRANDS.map((b) => b.key)).toEqual(["yourtal", "snapapp", "ftr"]);
  });
});
