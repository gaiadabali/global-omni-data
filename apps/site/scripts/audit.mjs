// Speed and accessibility audit of the built site. Runs on server-f inside the Playwright image, with
// Lighthouse and @axe-core/playwright installed in a temp folder outside the repo (see apps/site/AUDIT.md).
//
//   node audit.mjs <target> <out.json> [--runs N] [--pages a,b] [--no-lh] [--no-axe]
//
// <target> is either a URL (https://god.gaiada.com) or a dist folder, which is served on 127.0.0.1 with gzip,
// the long-cache rule for /_astro/ and the same CSP header nginx sends, so the numbers match staging.
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createGzip } from "node:zlib";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import lighthouse from "lighthouse";
import { launch as launchChrome } from "chrome-launcher";

const args = process.argv.slice(2);
const target = args[0];
const outFile = args[1];
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const runs = Number(opt("--runs", "1"));
const only = opt("--pages", "").split(",").filter(Boolean);
const doLh = !args.includes("--no-lh");
const doAxe = !args.includes("--no-axe");

const PAGES = [
  ["home", "/"], ["brands", "/brands/"], ["yourtal", "/brands/yourtal/"], ["snapapp", "/brands/snapapp/"],
  ["free-tax-returns", "/brands/free-tax-returns/"], ["for-brands", "/for-brands/"],
  ["how-it-works", "/how-it-works/"], ["privacy", "/privacy/"], ["privacy-notice", "/privacy-notice/"],
  ["about", "/about/"], ["contact", "/contact/"], ["404", "/404.html"],
].filter(([n]) => !only.length || only.includes(n));

const CSP = "default-src 'self'; script-src 'self' 'sha256-4yqhSqf81ppW8/WsfavaexVCHZqxjBRJWiLRdsj8inY='; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; frame-ancestors 'none'";
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif",
  ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml", ".webmanifest": "application/manifest+json" };
const GZ = new Set([".html", ".css", ".js", ".json", ".svg", ".txt", ".xml", ".webmanifest"]);

function serve(dir) {
  dir = resolve(dir);
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const safe = normalize(join(dir, url));
    if (!safe.startsWith(dir + sep) && safe !== dir) return res.writeHead(400).end();
    const file = [safe, join(safe, "index.html"), `${safe}.html`].find((p) => existsSync(p) && statSync(p).isFile());
    const f = file ?? join(dir, "404.html");
    const ext = extname(f);
    const h = { "content-type": TYPES[ext] ?? "application/octet-stream", "content-security-policy": CSP,
      "cache-control": url.startsWith("/_astro/") ? "public, max-age=31536000, immutable" : ext === ".html" ? "no-cache" : "public, max-age=86400" };
    const gz = GZ.has(ext) && /gzip/.test(req.headers["accept-encoding"] ?? "");
    if (gz) { h["content-encoding"] = "gzip"; h.vary = "Accept-Encoding"; }
    res.writeHead(file ? 200 : 404, h);
    const s = createReadStream(f);
    (gz ? s.pipe(createGzip({ level: 6 })) : s).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ base: `http://127.0.0.1:${server.address().port}`, stop: () => server.close() })));
}

let base = target;
let stop = () => {};
if (!/^https?:/.test(target)) ({ base, stop } = await serve(target));
console.log(`target ${base}`);

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
// --bp adds axe's best-practice rules (heading order, landmarks, region) on top of WCAG 2.2 AA.
const tags = args.includes("--bp") ? [...WCAG, "best-practice"] : WCAG;
const result = { base, when: new Date().toISOString(), pages: {} };

async function lh(url, form) {
  const chrome = await launchChrome({ chromePath: chromium.executablePath(),
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  try {
    const flags = { port: chrome.port, output: "json", logLevel: "error", formFactor: form,
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      screenEmulation: form === "mobile" ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }
        : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false } };
    const config = form === "desktop"
      ? { extends: "lighthouse:default", settings: { throttlingMethod: "simulate", throttling: { rttMs: 40, throughputKbps: 10 * 1024, cpuSlowdownMultiplier: 1 } } }
      : undefined;
    const r = (await lighthouse(url, flags, config)).lhr;
    const fails = Object.values(r.audits).filter((a) => a.score !== null && a.score < 1 && !["informative", "notApplicable", "manual"].includes(a.scoreDisplayMode))
      .map((a) => ({ id: a.id, score: a.score, title: a.title, display: a.displayValue ?? "",
        items: (a.details?.items ?? []).slice(0, 6).map((i) => i.node?.snippet ?? i.url ?? i.source?.url ?? i.label ?? JSON.stringify(i).slice(0, 160)) }));
    const m = r.audits;
    return { scores: Object.fromEntries(Object.entries(r.categories).map(([k, v]) => [k, Math.round(v.score * 100)])),
      metrics: { fcp: m["first-contentful-paint"].numericValue, lcp: m["largest-contentful-paint"].numericValue, tbt: m["total-blocking-time"].numericValue,
        cls: m["cumulative-layout-shift"].numericValue ?? 0, si: m["speed-index"].numericValue, bytes: m["total-byte-weight"].numericValue },
      lcpEl: m["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? "", fails };
  } finally { await chrome.kill(); }
}

const browser = await chromium.launch();
try {
  for (const [name, path] of PAGES) {
    const e = (result.pages[name] = { path, lh: {}, axe: {} });
    if (doLh) for (const form of ["mobile", "desktop"]) {
      const rs = [];
      for (let i = 0, tries = 0; i < runs && tries < runs + 3; tries++) {
        try {
          const r = await lh(base + path, form);
          if (r.scores.performance === null) throw new Error("incomplete run");
          rs.push(r);
          i++;
        } catch (err) {
          console.log(name, form, "run failed, retrying:", String(err).slice(0, 120));
        }
      }
      rs.sort((a, b) => a.scores.performance - b.scores.performance);
      const mid = rs[Math.floor(rs.length / 2)];
      e.lh[form] = { ...mid, perfRuns: rs.map((r) => r.scores.performance) };
      console.log(name, form, JSON.stringify(mid.scores), "perf runs", e.lh[form].perfRuns.join("/"), "LCP", Math.round(mid.metrics.lcp), "CLS", mid.metrics.cls.toFixed(3));
    }
    if (doAxe) for (const scheme of ["light", "dark"]) for (const [vp, w, h] of [["mobile", 390, 844], ["desktop", 1440, 900]]) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: w, height: h }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(base + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page }).withTags(tags).analyze();
      e.axe[`${scheme}-${vp}`] = { count: r.violations.length, nodes: r.violations.reduce((n, v) => n + v.nodes.length, 0),
        violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 160), why: (n.any[0]?.message ?? n.failureSummary ?? "").slice(0, 220) })) })) };
      console.log(name, scheme, vp, "axe", r.violations.length, r.violations.map((v) => v.id).join(","));
      await ctx.close();
    }
    writeFileSync(outFile, JSON.stringify(result, null, 2));
  }
} finally { await browser.close(); stop(); }
writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log("wrote", outFile);
