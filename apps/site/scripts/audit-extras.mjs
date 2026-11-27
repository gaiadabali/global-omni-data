// Run on server-f in the Playwright image (see audit-server-f.sh for the tools folder):
//   node audit-extras.mjs <dist-dir|url>
// Checks axe cannot do: reflow at 320px, text spacing, keyboard focus visibility, focus hidden by the sticky header, skip link, duplicate link text with different targets, unique titles, image alts.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2" };
function serve(dir) {
  dir = resolve(dir);
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const safe = normalize(join(dir, url));
    const file = [safe, join(safe, "index.html"), `${safe}.html`].find((p) => existsSync(p) && statSync(p).isFile());
    const f = file ?? join(dir, "404.html");
    res.writeHead(file ? 200 : 404, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" });
    createReadStream(f).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ base: `http://127.0.0.1:${server.address().port}`, stop: () => server.close() })));
}
let base = process.argv[2];
let stop = () => {};
if (!/^https?:/.test(base)) ({ base, stop } = await serve(base));
const PAGES = ["/", "/brands/", "/brands/yourtal/", "/brands/snapapp/", "/brands/free-tax-returns/", "/brands/spambank/", "/for-brands/", "/how-it-works/", "/privacy/", "/privacy-notice/", "/about/", "/responsibility/", "/contact/", "/404.html"];
const b = await chromium.launch();
const titles = new Map();
const problems = [];
const note = (p, m) => { problems.push(`${p}  ${m}`); };

for (const path of PAGES) {
  for (const scheme of ["light", "dark"]) {
    // 1. Reflow at 320 css px (WCAG 1.4.10) and text spacing (1.4.12).
    for (const [label, w, spacing] of [["320px", 320, false], ["320px+spacing", 320, true], ["1440+spacing", 1440, true]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 700 }, colorScheme: scheme, bypassCSP: true, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(base + path, { waitUntil: "networkidle" });
      if (spacing) await page.addStyleTag({ content: "*{line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important} p{margin-bottom:2em !important}" });
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => {
        const de = document.documentElement;
        const over = [];
        for (const el of document.querySelectorAll("body *")) {
          const rc = el.getBoundingClientRect();
          if (rc.width && rc.right > de.clientWidth + 1 && getComputedStyle(el).position !== "fixed" && !el.closest("svg")) over.push(el.tagName + "." + String(el.className).slice(0, 30) + " right=" + Math.round(rc.right));
        }
        // text clipped by overflow:hidden containers
        const clipped = [];
        for (const el of document.querySelectorAll("a,button,li,p,h1,h2,h3,span,label")) {
          if (el.closest(".visually-hidden")) continue;
          const cs = getComputedStyle(el);
          if ((cs.overflow === "hidden" || cs.overflowX === "hidden") && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.textOverflow !== "ellipsis") clipped.push(el.tagName + "." + String(el.className).slice(0, 30) + " " + el.scrollWidth + ">" + el.clientWidth);
          if ((cs.overflowY === "hidden") && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0 && cs.display !== "inline") clipped.push("Y " + el.tagName + "." + String(el.className).slice(0, 30) + " " + el.scrollHeight + ">" + el.clientHeight);
        }
        return { sw: de.scrollWidth, cw: de.clientWidth, over: over.slice(0, 4), clipped: clipped.slice(0, 4) };
      });
      if (r.sw > r.cw + 1) note(path, `${scheme} ${label}: horizontal scroll ${r.sw}>${r.cw}  ${r.over.join(" | ")}`);
      if (r.clipped.length) note(path, `${scheme} ${label}: clipped text ${r.clipped.join(" | ")}`);
      await ctx.close();
    }
    if (scheme === "dark") continue;
    // 2. Keyboard: tab through, check focus indicator and that the sticky header does not cover the focused element.
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(base + path, { waitUntil: "networkidle" });
    const info = await page.evaluate(() => ({ title: document.title, h1: document.querySelectorAll("h1").length, lang: document.documentElement.lang, noAlt: [...document.images].filter((i) => !i.hasAttribute("alt")).length, main: document.querySelectorAll("main").length }));
    titles.set(path, info.title);
    if (info.h1 !== 1) note(path, `h1 count ${info.h1}`);
    if (info.noAlt) note(path, `${info.noAlt} images without alt attribute`);
    if (info.main !== 1) note(path, `main landmarks ${info.main}`);
    const links = await page.evaluate(() => {
      const m = new Map();
      for (const a of document.querySelectorAll("a[href]")) {
        const t = (a.getAttribute("aria-label") || a.textContent).replace(/\s+/g, " ").trim().toLowerCase();
        const h = new URL(a.getAttribute("href"), location.href).href;
        (m.get(t) ?? m.set(t, new Set()).get(t)).add(h);
      }
      return [...m].filter(([, s]) => s.size > 1).map(([t, s]) => `"${t}" -> ${[...s].join(", ")}`);
    });
    for (const l of links) note(path, `same link text, different targets: ${l}`);
    // Skip link.
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => ({ t: document.activeElement?.textContent?.trim(), href: document.activeElement?.getAttribute("href") }));
    if (first.href !== "#main") note(path, `first tab stop is not the skip link: ${JSON.stringify(first)}`);
    await page.keyboard.press("Enter");
    const afterSkip = await page.evaluate(() => document.activeElement?.id);
    if (afterSkip !== "main") note(path, `skip link leaves focus on #${afterSkip}`);
    await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
    await page.mouse.move(0, 0);
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      const f = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const rc = el.getBoundingClientRect();
        const hdr = document.querySelector("header.hdr")?.getBoundingClientRect();
        const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
        const shadow = cs.boxShadow !== "none";
        return { id: el.tagName + (el.id ? "#" + el.id : "") + "." + String(el.className).slice(0, 24) + ":" + (el.textContent || "").trim().slice(0, 24), outline, shadow, top: rc.top, bottom: rc.bottom, w: rc.width, h: rc.height, hdrBottom: hdr ? hdr.bottom : 0, hdrSticky: hdr ? getComputedStyle(document.querySelector("header.hdr")).position : "", vis: cs.visibility, vh: window.innerHeight, hidden: el.closest("[hidden],[aria-hidden=true]") ? "aria-hidden ancestor" : "" };
      });
      if (!f) break;
      if (seen.has(f.id)) break;
      seen.add(f.id);
      if (!f.outline && !f.shadow) note(path, `no visible focus indicator on ${f.id}`);
      if (f.hdrSticky === "sticky" || f.hdrSticky === "fixed") if (f.top < f.hdrBottom - 1 && f.top > -1 && f.bottom > 0) note(path, `focused element under the sticky header: ${f.id} top=${Math.round(f.top)} header=${Math.round(f.hdrBottom)}`);
      if (f.bottom <= 0 || f.top >= f.vh) note(path, `focused element off screen: ${f.id}`);
      if (f.hidden) note(path, `focus inside aria-hidden: ${f.id}`);
    }
    await ctx.close();
  }
}
const seenT = new Map();
for (const [p, t] of titles) { if (seenT.has(t)) note(p, `title duplicates ${seenT.get(t)}: ${t}`); seenT.set(t, p); }
await b.close();
stop();
console.log(problems.length ? problems.join("\n") : "no problems found");
console.log(`(${problems.length} findings)`);
