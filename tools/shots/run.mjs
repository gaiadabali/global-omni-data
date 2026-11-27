// node tools/shots/run.mjs <site|dashboard>
//
// Runs inside the Playwright image on server-f (scripts/server-f/remote-build.sh shots-<app>), after the build.
// Starts the built app on 127.0.0.1, opens every route in tools/shots/routes.<app>.json, and writes
// .shots/<app>/<name>-<width>-<theme>.png plus report.json (console errors, page errors, failed requests).
//
// Route entry: { "name": "home", "path": "/", "widths": [1440, 390], "themes": ["light", "dark"],
//                "role": "owner", "waitFor": "css selector", "delayMs": 300, "fullPage": true }
// Defaults: widths [1440, 390], themes ["light"], fullPage true, delayMs 300.
// "role" (dashboard only) sets the dev sign-in cookie god_dev_role=<role>; the dashboard is started with
// GOD_DEV_AUTH=1 and GOD_DEPLOYMENT=dev, which is the only combination that turns dev sign-in on.
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";

const app = process.argv[2];
if (app !== "site" && app !== "dashboard") throw new Error("usage: run.mjs <site|dashboard>");
const root = resolve(import.meta.dirname, "../..");
const routes = JSON.parse(readFileSync(join(root, `tools/shots/routes.${app}.json`), "utf8"));
const out = join(root, ".shots", app);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain",
  ".xml": "application/xml", ".pmtiles": "application/octet-stream",
};

// A static server for Astro's dist/: /about -> /about/index.html or /about.html, 404 -> /404.html.
function serveStatic(dir, port) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const safe = normalize(join(dir, url));
    if (!safe.startsWith(dir + sep) && safe !== dir) { res.writeHead(400).end(); return; }
    const tries = [safe, join(safe, "index.html"), `${safe}.html`];
    const file = tries.find((p) => existsSync(p) && statSync(p).isFile());
    if (!file) {
      const nf = join(dir, "404.html");
      res.writeHead(404, { "content-type": TYPES[".html"] });
      if (existsSync(nf)) createReadStream(nf).pipe(res); else res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(() => server.close())));
}

async function waitForHttp(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not answer within ${ms} ms`);
}

async function start() {
  if (app === "site") {
    const dir = join(root, "apps/site/dist");
    if (!existsSync(dir)) throw new Error("apps/site/dist is missing: did the build run?");
    const stop = await serveStatic(dir, 4321);
    return { base: "http://127.0.0.1:4321", stop };
  }
  const cwd = join(root, "apps/dashboard");
  const next = join(cwd, "node_modules/next/dist/bin/next");
  const child = spawn(process.execPath, [next, "start", "-p", "3000", "-H", "127.0.0.1"], {
    cwd, stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, GOD_DEV_AUTH: "1", GOD_DEPLOYMENT: "dev" },
  });
  await waitForHttp("http://127.0.0.1:3000/", 60_000);
  return { base: "http://127.0.0.1:3000", stop: () => child.kill("SIGTERM") };
}

const { base, stop } = await start();
const browser = await chromium.launch({
  // Software WebGL, so MapLibre and deck.gl render in a GPU-less container.
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const report = [];
let failures = 0;
try {
  for (const r of routes) {
    for (const theme of r.themes ?? ["light"]) {
      for (const width of r.widths ?? [1440, 390]) {
        const ctx = await browser.newContext({
          viewport: { width, height: width < 600 ? 844 : 900 },
          deviceScaleFactor: 1, colorScheme: theme, reducedMotion: "reduce",
        });
        if (r.role) await ctx.addCookies([{ name: "god_dev_role", value: r.role, url: base }]);
        const page = await ctx.newPage();
        const entry = { name: r.name, path: r.path, width, theme, status: 0, console: [], pageErrors: [], failed: [] };
        page.on("console", (m) => { if (m.type() === "error") entry.console.push(m.text().slice(0, 300)); });
        page.on("pageerror", (e) => entry.pageErrors.push(String(e).slice(0, 300)));
        page.on("requestfailed", (q) => entry.failed.push(`${q.url()} ${q.failure()?.errorText ?? ""}`.slice(0, 300)));
        page.on("response", (s) => { if (s.status() >= 400) entry.failed.push(`${s.status()} ${s.url()}`.slice(0, 300)); });
        try {
          const res = await page.goto(base + r.path, { waitUntil: "networkidle", timeout: 45_000 });
          entry.status = res?.status() ?? 0;
          if (r.waitFor) await page.waitForSelector(r.waitFor, { timeout: 20_000 });
          await page.waitForTimeout(r.delayMs ?? 300);
          if (app === "site") {
            // Scroll the whole page once so lazy images load, then check that no image is empty: a device frame
            // with nothing in it must fail the run, not slip into a screenshot.
            await page.evaluate(async () => {
              for (let y = 0; y < document.body.scrollHeight; y += 500) {
                window.scrollTo(0, y);
                await new Promise((ok) => setTimeout(ok, 50));
              }
              window.scrollTo(0, 0);
            });
            await page.waitForLoadState("networkidle");
            await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
            const empty = await page.evaluate(() =>
              [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.currentSrc || i.src),
            );
            for (const src of empty) entry.failed.push(`EMPTY IMAGE ${src}`.slice(0, 300));
          }
          await page.screenshot({ path: join(out, `${r.name}-${width}-${theme}.png`), fullPage: r.fullPage ?? true });
        } catch (e) {
          entry.pageErrors.push(`SHOT FAILED: ${String(e).slice(0, 300)}`);
        }
        const bad = entry.status >= 400 || entry.console.length || entry.pageErrors.length || entry.failed.length;
        if (bad) failures++;
        console.log(`${bad ? "!!" : "ok"} ${r.name} ${width} ${theme} status=${entry.status}` +
          (bad ? ` console=${entry.console.length} pageErrors=${entry.pageErrors.length} failed=${entry.failed.length}` : ""));
        report.push(entry);
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  stop();
}
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`== ${report.length} screenshots, ${failures} with problems (details in .shots/${app}/report.json)`);
