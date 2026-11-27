# Speed and accessibility audit of the public site

Task 9.3.f, run on 2026-11-27 on server-f. Staging (https://god.gaiada.com, built from `frontend` at `e00419b`) is the
"before". The "after" is the `fe/site-audit` build served from `dist` on the same box. Nothing was installed in the repo
or on the laptop.

## How it was run

| Tool                                                | Version | Where                                                              |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| Lighthouse                                          | 13.6.0  | `/opt/god-build/tmp/site-audit-tools` on server-f, never in the repo |
| @axe-core/playwright (axe-core 4.14.1)              | 4.14.1  | same folder                                                        |
| Chromium, from `mcr.microsoft.com/playwright:v1.65.1-noble` | 1.65.1  | throwaway `docker run --rm`                                |

- Pages: all 12 (`/`, `/brands/`, the three brand pages, `/for-brands/`, `/how-it-works/`, `/privacy/`,
  `/privacy-notice/`, `/about/`, `/contact/`, `/404.html`).
- Lighthouse: Performance, Accessibility, Best Practices, SEO. Mobile (Lighthouse's default profile: 4x CPU, slow 4G)
  and desktop (10 Mbit/s, no CPU throttle). Three runs per page and form factor. The first table shows the median run;
  the second shows all three performance runs, because one run on a shared box can swing by 10 points.
- axe: WCAG 2.0, 2.1 and 2.2 level A and AA rules, plus axe's best-practice rules (heading order, landmarks, region), in
  light and dark (`prefers-color-scheme`), at 390 and 1440 px. The count is the sum of those four runs.
- SEO is 69 (66 on the 404, which also returns HTTP 404) only because of `noindex` and `X-Robots-Tag` on staging. That is
  intended, and it is the only SEO item that fails.
- The "after" build uses the staging switches (`PUBLIC_NOINDEX=1`, the live contact endpoint) so the numbers compare.
  The local server sends gzip, the long cache on `/_astro/` and the same CSP header as nginx, but over HTTP/1.1 rather
  than nginx's HTTP/2, so absolute performance is not identical to staging. The fair like-for-like for performance is
  the second table: the old code built and served the same way as the branch.

Scores are Performance / Accessibility / Best Practices / SEO.

## Results

| Page             | Mobile before         | Mobile after          | Desktop before        | Desktop after         | axe before | axe after | CLS mobile before | CLS mobile after |
| ---------------- | --------------------- | --------------------- | --------------------- | --------------------- | ---------- | --------- | ----------------- | ---------------- |
| home             | 98 / 100 / 100 / 69   | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 0          | 0         | 0.000             | 0.000            |
| brands           | 99 / 100 / 100 / 69   | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 0          | 0         | 0.027             | 0.000            |
| yourtal          | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 0          | 0         | 0.000             | 0.000            |
| snapapp          | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 0          | 0         | 0.001             | 0.000            |
| free-tax-returns | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 0          | 0         | 0.000             | 0.000            |
| for-brands       | 100 / 100 / 100 / 69  | 98 / 100 / 100 / 69   | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 0          | 0         | 0.000             | 0.000            |
| how-it-works     | 98 / 100 / 100 / 69   | 99 / 100 / 100 / 69   | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 0          | 0         | 0.000             | 0.000            |
| privacy          | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 0          | 0         | 0.000             | 0.000            |
| privacy-notice   | 94 / 100 / 100 / 69   | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 0          | 0         | 0.145             | 0.000            |
| about            | 99 / 100 / 100 / 69   | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 0          | 0         | 0.029             | 0.000            |
| contact          | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 100 / 100 / 100 / 69  | 0          | 0         | 0.000             | 0.000            |
| 404              | 100 / 100 / 100 / 66  | 100 / 100 / 100 / 66  | 100 / 100 / 100 / 66  | 100 / 100 / 100 / 66  | 0          | 0         | 0.000             | 0.000            |

"axe" is the total number of violations over light and dark at 390 and 1440 px.

Mobile performance, the three runs (lowest / middle / highest):

| Page             | Staging (before) | Old code, built and served like the branch | This branch |
| ---------------- | ---------------- | ------------------------------------------ | ----------- |
| home             | 93/98/99         | 100/100/100                                | 100/100/100 |
| brands           | 88/99/100        | 100/100/100                                | 100/100/100 |
| yourtal          | 100/100/100      | 100/100/100                                | 100/100/100 |
| snapapp          | 100/100/100      | 100/100/100                                | 100/100/100 |
| free-tax-returns | 100/100/100      | 91/100/100                                 | 100/100/100 |
| for-brands       | 98/100/100       | 98/99/99                                   | 91/98/98    |
| how-it-works     | 93/98/99         | 95/99/99                                   | 99/99/99    |
| privacy          | 100/100/100      | 100/100/100                                | 100/100/100 |
| privacy-notice   | 94/94/94         | 94/94/94                                   | 100/100/100 |
| about            | 98/99/100        | 100/100/100                                | 100/100/100 |
| contact          | 100/100/100      | 100/100/100                                | 100/100/100 |
| 404              | 100/100/100      | 100/100/100                                | 100/100/100 |

Staging runs are noisier because the box also serves everything else. The `privacy-notice` 94 is real and repeats on
every run: it comes from layout shift (below). The one 91 on `for-brands` is a single slow run. Two follow-up checks
found no regression there: five runs with and without the new `fetchpriority` gave the same 98, and the old and new
builds run back to back gave the same LCP (about 2.2 s, a below-the-text hero photo on a slow-4G phone profile).

Home page on mobile: 98 on staging (93 to 99 over three runs, Total Blocking Time 154 ms) and 100 on the branch in all
three runs (TBT 61 ms).

## Checks axe and Lighthouse do not make

`scripts/audit-extras.mjs` ran on the branch build with no findings:

- no horizontal scroll at 320 px (WCAG 1.4.10);
- nothing clipped with the WCAG 1.4.12 text-spacing overrides;
- every focus stop has a visible indicator and none is hidden behind the sticky header (WCAG 2.4.11);
- the skip link is the first stop and lands on `#main`;
- one `h1` and one `main` per page, an `alt` attribute on every image, unique titles, and no two links with the same text
  but different destinations.

axe could not decide the colour contrast of text in the "night" bands (the background is a gradient on a pseudo
element, which axe lists under "needs review"). Checked by hand against the token colours: the lowest ratio is
`--night-ink-3` on `#0e1350`, 6.84:1 (AA needs 4.5:1). Body text there is 10.3:1 and headings 15.5:1, in both themes.

## What was fixed

1. **Layout shift from the font swap** (the one real finding). Newsreader, Inter and IBM Plex Mono arrive after first
   paint and the page rewrapped: CLS 0.145 on `/privacy-notice/` (mobile 94), about 0.03 on `/about/` and `/brands/`.
   `fonts.css` now has metric-matched fallback faces (`Newsreader Fallback`, `Inter Fallback` in three weight ranges,
   `IBM Plex Mono Fallback`) built from `local()` fonts with `size-adjust`, `ascent-override` and `descent-override`.
   The scales were measured in Chromium against the built fonts, then tuned by sweeping the scale and counting headings
   and button rows whose line count differs between the two fonts. CLS is 0.000 on all 12 pages in Lighthouse.
2. **`ch` limits on headings.** `max-width` on the hero headings was in `ch`, and one `ch` is 14% wider in Newsreader than
   in its fallback, so a headline broke over three lines and then two. Replaced with the equal `em` value (0.57em per
   `ch`), so the settled layout is the same (`global.css`, `index.astro`, `404.astro`).
3. **LCP image priority.** The hero image on the brand pages and `/for-brands/` is the LCP element and Lighthouse said
   `fetchpriority=high` was missing. `Phone`, `Browser` and the `/for-brands/` hero now set it when they are `eager`.
4. **Images.** `Picture` fallbacks are WebP instead of 0.5 to 1 MB PNG and JPEG files that no current browser downloads:
   `dist` goes from 32 MB to 12 MB. The browser mock gets a 768w step so a phone does not fetch the 960w file. The logo
   is WebP q80 (Lighthouse "image delivery" saving of 13 to 19 KiB per page).
5. **Tooling kept in the repo:** `scripts/audit.mjs`, `scripts/audit-server-f.sh`, `scripts/audit-extras.mjs`.

No colour, alt text, heading, landmark, label or focus change was needed. The baseline already had zero axe violations
in both themes, and Lighthouse Accessibility 100 and Best Practices 100 on every page.

## What is left

- **Font-swap shift is not zero in every case.** Under a harsher test than Lighthouse (slow network and 4x CPU), two
  pages still move once: CLS 0.084 on `/privacy/` and `/for-brands/` at 412 px wide, under the 0.1 "good" limit. The two
  hero buttons sit within 3 px of the wrap point, so the 2% difference between the fallback font and Inter flips them
  from one row to two. One fixed fallback cannot match every string. Stacking the buttons on phones would remove it, but
  that is a design change, so it is left for the owner.
- **Render-blocking CSS.** Five small CSS files block first paint (about 20 KB gzipped). Inlining them would break
  `style-src 'self'`, so they stay as files. They load in parallel and cost nothing measurable here.
- **Home page main-thread work.** Total Blocking Time is 0 to 61 ms on the branch. What remains is style and layout for
  the dotted map's SVG, which is part of the approved hero.
- **Run-to-run noise.** Lighthouse on a shared box varies by up to 10 points. After the owner deploys, re-run against
  staging: `bash apps/site/scripts/audit-server-f.sh https://god.gaiada.com after-deploy --runs 3 --bp`.
- **CSP.** Unchanged. The inline theme bootstrap was not touched, so no hash changed.

## Re-run

```
bash apps/site/scripts/audit-server-f.sh https://god.gaiada.com <name> --runs 3 --bp
bash apps/site/scripts/audit-server-f.sh /opt/god-build/src/<tree>/apps/site/dist <name> --runs 3 --bp
```

The JSON lands in the current folder. Lighthouse and axe install into `/opt/god-build/tmp/site-audit-tools` on first use.
`audit-extras.mjs` runs in the same container (`node audit-extras.mjs <dist-dir|url>`).
