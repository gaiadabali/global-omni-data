// Re-captures the product screens in src/assets/screens/ from the live public pages of YourTal, SnapApps and
// Free Tax Returns. Takes no arguments. Runs on server-f only (never on the laptop), inside the Playwright image,
// under the box's build lock. Playwright and sharp are installed in a scratch folder, never in the repo:
//   ssh server-f 'mkdir -p /opt/god-build/tmp/capture && cd /opt/god-build/tmp/capture && \
//     flock -w 1800 /opt/god-build/build.lock docker run --rm --ipc=host -v /opt/god-build:/opt/god-build \
//     -w /opt/god-build/tmp/capture mcr.microsoft.com/playwright:v1.65.1-noble bash -c \
//     "npm i --no-audit --no-fund playwright@1.65.1 sharp >/dev/null && NODE_PATH=node_modules \
//      OUT=/opt/god-build/tmp/capture/out node capture-screens.mjs"'
// (copy this file to /opt/god-build/tmp/capture first; OUT defaults to ../src/assets/screens next to the script).
// Only public pages are opened: nothing is typed, no form is submitted, nobody signs in.
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const sharp = require("sharp");
const out = process.env.OUT ?? fileURLToPath(new URL("../src/assets/screens/", import.meta.url));
await mkdir(out, { recursive: true });

const PHONE = { w: 390, h: 812, dpr: 3 };
const PHONE_TALL = { w: 390, h: 844, dpr: 3 };
const DESK = { w: 1440, h: 900, dpr: 2 };

const SHOTS = [
  ["yourtal-home", "https://yourtal.gaiada.com/", PHONE, "dark"],
  ["yourtal-rewards", "https://yourtal.gaiada.com/au/rewards", PHONE, "dark"],
  ["yourtal-business", "https://yourtal.gaiada.com/au/for-business", PHONE, "light"],
  ["snapapp-how", "https://snapapps.gaiada.com/how-it-works", PHONE_TALL, "light"],
  ["snapapp-features", "https://snapapps.gaiada.com/features", PHONE_TALL, "light"],
  ["snapapp-pricing", "https://snapapps.gaiada.com/pricing", PHONE_TALL, "light"],
  ["ftr-car", "https://freetaxreturns.com.au/claim-your-car", PHONE_TALL, "light"],
  ["ftr-worksheet", "https://freetaxreturns.com.au/worksheet", PHONE_TALL, "light"],
  ["snapapp-home-desktop", "https://snapapps.gaiada.com/", DESK, "light"],
  ["ftr-car-desktop", "https://freetaxreturns.com.au/claim-your-car", DESK, "light"],
  ["ftr-lodge-desktop", "https://freetaxreturns.com.au/free-lodgement", DESK, "light"],
];
// Optional env ONLY=name1,name2 limits the run (handy for re-takes).
const only = process.env.ONLY?.split(",");

const browser = await chromium.launch();
console.log("chromium", browser.version());
for (const [name, url, vp, scheme] of SHOTS) {
  if (only && !only.includes(name)) continue;
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    deviceScaleFactor: vp.dpr,
    colorScheme: scheme,
    reducedMotion: "reduce",
    locale: "en-AU",
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  // Scroll down in steps to trigger lazy images, then back to the top.
  await page.evaluate(async () => {
    const step = innerHeight * 0.8;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    scrollTo(0, 0);
  });
  // Dismiss a cookie notice with its own "No thanks" control, if the page has one.
  await page
    .getByRole("button", { name: /^no thanks$/i })
    .click({ timeout: 1500 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  // Hide an environment banner (text mentioning "staging") stuck to the top of the page. Nothing else changes.
  const hidden = await page.evaluate(() => {
    const els = [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.top < 4 &&
        r.height > 0 &&
        r.height < 80 &&
        /staging/i.test(el.textContent ?? "") &&
        (el.textContent ?? "").length < 300 &&
        !el.querySelector("h1,h2,main,section")
      );
    });
    // Keep the outermost matches only.
    const top = els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
    top.forEach((el) => (el.style.display = "none"));
    return top.map((el) => (el.textContent ?? "").trim().slice(0, 60));
  });
  await page.waitForTimeout(300);
  const png = await page.screenshot({ type: "png" });
  const file = `${out}/${name}.webp`;
  const info = await sharp(png).webp({ quality: 82, effort: 6 }).toFile(file);
  console.log(
    name,
    `${info.width}x${info.height}`,
    `${(info.size / 1024).toFixed(0)}KB`,
    hidden.length ? `hid: ${hidden.join("|")}` : "",
  );
  await ctx.close();
}
await browser.close();
