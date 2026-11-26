// Makes the social preview images: public/og-image.png (home and default) and public/og/<page>.png.
//
// Runs on server-f only, after a build (it reads apps/site/dist for the dotted map), inside the Playwright image:
//   docker run --rm -v /opt/god-build:/opt/god-build -w <tree>/apps/site mcr.microsoft.com/playwright:v1.65.1-noble \
//     bash -c "npm i --prefix /tmp/og playwright@1.65.1 >/dev/null && NODE_PATH=/tmp/og/node_modules node scripts/make-og.mjs"
// Chromium draws each card with the site's own fonts and map; sharp (a dev dependency) compresses the PNG.
// The PNGs are checked in, so a normal build does not run this.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const font = (p) => `file://${here(`../node_modules/${p}`)}`;

const html = await readFile(here("../dist/index.html"), "utf8");
const map = html.match(/<svg class="aus[\s\S]*?<\/svg>/)?.[0];
if (!map) throw new Error("no map in dist/index.html: build first");
const logo = `file://${here("../src/assets/god-logo.png")}`;

const CARDS = [
  {
    file: "og-image.png",
    kicker: "Global Omni Data",
    title: "Know your market by what Australians actually do",
  },
  { file: "og/brands.png", kicker: "Our brands", title: "YourTal, SnapApp and Free Tax Returns" },
  {
    file: "og/yourtal.png",
    kicker: "YourTal",
    title: "Rewards for paying attention, spent where you live",
  },
  { file: "og/snapapp.png", kicker: "SnapApp", title: "The receipt app that reads every line" },
  {
    file: "og/free-tax-returns.png",
    kicker: "Free Tax Returns",
    title: "A free worksheet for every deduction you're owed",
  },
  {
    file: "og/for-brands.png",
    kicker: "For brands",
    title: "See your market. Never the people in it.",
  },
  { file: "og/how-it-works.png", kicker: "How it works", title: "How a receipt becomes a report" },
  { file: "og/privacy.png", kicker: "Trust & privacy", title: "Trust is a rule, not a promise" },
  { file: "og/about.png", kicker: "About GOD", title: "The company behind three useful apps" },
  { file: "og/contact.png", kicker: "Talk to us", title: "Ask a question about your market" },
];

const page = (c) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:N;src:url("${font("@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2")}");font-weight:200 800}
@font-face{font-family:M;src:url("${font("@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2")}")}
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:linear-gradient(180deg,#070a33,#0e1350);color:#f2f3fb;position:relative}
.logo{position:absolute;left:72px;top:64px;height:56px;filter:brightness(0) invert(1)}
.k{position:absolute;left:72px;top:250px;font:400 24px/1 M;color:#9ba1cf;display:flex;align-items:center;gap:14px}
.k:before{content:"";width:12px;height:12px;border-radius:50%;background:#e0a14a}
h1{position:absolute;left:72px;top:292px;width:640px;margin:0;font:420 60px/1.06 N;letter-spacing:-.015em}
.map{position:absolute;right:40px;top:70px;width:470px}
.map path{fill:none;stroke-linecap:round}.map .dot{stroke:#e8eaff}.map .dim{stroke:#4b54ad}
.map .city{fill:#e0a14a}.map .halo{fill:none;stroke:#e0a14a;stroke-opacity:.55}.map .lbl{display:none}
</style></head><body><img class="logo" src="${logo}" alt=""><p class="k">${c.kicker}</p><h1>${c.title}</h1>
<div class="map">${map}</div></body></html>`;

await mkdir(here("../public/og/"), { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const c of CARDS) {
  const tmp = join(tmpdir(), "god-og-card.html");
  await writeFile(tmp, page(c));
  await tab.goto(`file://${tmp}`, { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  const png = await tab.screenshot({ type: "png" });
  await sharp(png)
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(here(`../public/${c.file}`));
  console.log(c.file);
}
await browser.close();
