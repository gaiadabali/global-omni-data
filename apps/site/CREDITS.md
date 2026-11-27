# Image credits

Every photograph on god.gaiada.com, where it came from and under what licence. Checked 2026-11-27.

All six photos are under the [Unsplash License](https://unsplash.com/license): free to use for commercial and
non-commercial purposes, no permission needed and no attribution required (we credit the photographers here
anyway). The licence does not allow selling the photos unaltered or compiling them into a competing service, and we
do neither. None of them is an Unsplash+ (paid) photo. They were downloaded on server-f from the Unsplash image CDN
at 2000 px wide and are served through Astro's image pipeline (AVIF and WebP, responsive sizes).

| File (`src/assets/photos/`)         | Photo page                                                                                             | Photographer                           | Location (from the page)                        | Used on                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------- | --------------------------- |
| `cafe-espresso-melbourne.jpg`       | https://unsplash.com/photos/a-espresso-machine-making-a-cup-of-coffee-t_c-1QokeJE                      | Alex Duong (@alexd_228)                | Melbourne VIC, Australia                        | Home, For brands (cafés)    |
| `fuel-longreach-dusk.jpg`           | https://unsplash.com/photos/gray-and-white-gasoline-station-during-golden-hour-2Fli_d8TnVc             | Cameron McPhee (@camthaman)            | Longreach QLD, Australia                        | Home, For brands (fuel)     |
| `produce-queen-victoria-market.jpg` | https://unsplash.com/photos/6DsMsaoFmqY                                                                | Somi Jaiswal (@somijaiswal_fotografia) | Queen Victoria Market, Melbourne VIC, Australia | Home, For brands (grocery)  |
| `receipt-terminal.jpg`              | https://unsplash.com/photos/a-person-holding-a-cell-phone-and-a-receipt-KnDM23QuRMI                    | Nathana Rebouças (@nathanareboucas)    | not stated                                      | How it works, SnapApps      |
| `suburb-sydney-aerial.jpg`          | https://unsplash.com/photos/aerial-view-of-a-suburban-neighborhood-with-houses-and-streets-MXR6DAo8NCo | Shanjir H, Photo4life AU (@shanjir)    | Sydney NSW, Australia                           | For brands, Trust & privacy |
| `desk-calculator.jpg`               | https://unsplash.com/photos/a-calculator-sitting-on-top-of-a-table-next-to-a-laptop-8wLZi9OhsWU        | Jakub Żerdzicki (@jakubzerdzicki)      | not stated                                      | Free Tax Returns            |

## Product screens

`src/assets/screens/` holds screenshots of the GOD brands' own public pages, captured with Playwright 1.65.1 (Chromium
159.0.8154.6) on server-f on 2026-11-27 with `scripts/capture-screens.mjs`, encoded as WebP at quality 82. Phone shots are
390 px wide at 3x, desktop shots 1440 px at 2x. They are GOD's own products, so no third-party licence applies.

**The eight SnapApps and Free Tax Returns screens were re-taken at 13:53 (UTC+8) on 2026-11-27, after both sites went live
with their new logos and the SnapApps name.** Each was opened and checked after capture. The three YourTal screens
(`yourtal-home.webp`, `yourtal-rewards.webp`, `yourtal-business.webp`) are the earlier captures and still show YourTal's old
branding: its rebrand is not live (`/brand/yourtal-mark.svg` and `/brand/yourtal-lockup.svg` returned 404 on 2026-11-27), so
a fresh capture would show a broken logo. Re-take them with `ONLY=yourtal-home,yourtal-rewards,yourtal-business` once
YourTal ships its new logo. (`yourtal-home` also has a hero video poster with a face-like image; the script hides it for that
shot.)

| File                                                                | Captured from                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `yourtal-home.webp`                                                 | https://yourtal.gaiada.com/ (390 px, dark; staging site on demo data, staging banner cropped) |
| `yourtal-rewards.webp`                                              | https://yourtal.gaiada.com/au/rewards (390 px, dark; demo merchants)                          |
| `yourtal-business.webp`                                             | https://yourtal.gaiada.com/au/for-business (390 px, light)                                    |
| `snapapp-home-desktop.webp`                                         | https://snapapp.gaiada.com/ (1440 px)                                                         |
| `snapapp-how.webp`, `snapapp-features.webp`, `snapapp-pricing.webp` | https://snapapp.gaiada.com/how-it-works, /features, /pricing (390 px)                         |
| `ftr-car-desktop.webp`, `ftr-lodge-desktop.webp`                    | https://freetaxreturns.com.au/claim-your-car, /free-lodgement (1440 px)                       |
| `ftr-car.webp`, `ftr-worksheet.webp`                                | https://freetaxreturns.com.au/claim-your-car, /worksheet (390 px, empty form)                 |

No screen shows a real person's data: they are public marketing pages, an empty form and YourTal's seeded demo world.
SnapApps' own fictional demo user ("Kate Marsh") and its cartoon mascot appear in a few SnapApps shots; no photo of a person
is in any shot. The Spambank page uses no screenshot: its Mail screens are drawn in HTML with made-up sample mail. The
Spambank page uses no screenshot: its Mail screens are drawn in HTML with made-up sample mail.

**Re-capture pending (founder, 2026-11-27):** every screen predates the rebrands, so all of them are being re-taken from the
rebranded live sites in a separate change.

## Brand logos

`src/assets/brands/`: the founder-approved logos, merged into `god/brand-assets/svg/` on 2026-11-27 (guide:
`god/brand-assets/GOD-Ecosystem-Brand-Guidelines.pdf`; where the guide and a logo file differ, the file wins). They are
the brands' own artwork, used as supplied: never recoloured, redrawn, stretched or re-set in a web font. Each was
checked before it was added (no script, event handler, `<image>`, `<use>`, `<style>`, link, `data:` URI or external
reference; only `<svg>` and `<path>`), then optimised with SVGO 3.3.2 on server-f (`multipass`, `floatPrecision: 1`,
`removeViewBox` off; the paths are traced outlines, so the output was compared with the originals in Chromium).

| File (`src/assets/brands/`) | Source in `brand-assets/svg/` | Brand repo at the time of the approval | Size (original, optimised) | Used for                               |
| --------------------------- | ----------------------------- | -------------------------------------- | -------------------------- | -------------------------------------- |
| `snapapp-lockup.svg`        | `snapapp-lockup.svg`          | snap-app@736168d                       | 78.7 KB, 23.0 KB           | Brand page hero, brand cards           |
| `snapapp-mark.svg`          | `snapapp-mark.svg`            | snap-app@736168d                       | 61.6 KB, 16.6 KB           | Small mark (diagram, About)            |
| `yourtal-lockup.svg`        | `yourtal-lockup.svg`          | yourtal@efefb214                       | 6.7 KB, 3.7 KB             | Brand page hero, brand cards           |
| `yourtal-mark.svg`          | `yourtal-mark.svg`            | yourtal@efefb214                       | 2.1 KB, 1.4 KB             | Small mark                             |
| `ftr-logo-reversed.svg`     | `ftr-logo-reversed.svg`       | free-tax-return@81344d5                | 21.8 KB, 11.4 KB           | Brand page hero, brand cards (on navy) |
| `ftr-mark.svg`              | `ftr-mark.svg`                | free-tax-return@81344d5                | 7.5 KB, 4.3 KB             | Small mark                             |

Not used on the site, on purpose: `snapapp-wordmark.svg`, `snapper-poster.webp`, `yourtal-mascot.svg` (the mascot is
YourTal's, line art for dark ground; the pages already have a hero) and `ftr-logo.svg` (navy on light; the site shows the
Free Tax Returns logo on its navy plate, so only the reversed file is needed).

Ground rules that follow from the guide and are built into `src/styles/brands.css`: the YourTal logos are yellow line art
and always sit on Charcoal `#363636`; the Free Tax Returns marks sit on navy (hero, cards) or a light tile (small mark,
whose arrow is navy); SnapApps' orange logo sits on white, or on Ink `#0F172A` in dark mode.

Names: the founder renamed the brand "SnapApps" on 2026-11-27 to match its logo, which reads "SNAP APPS". The site's text
name is "SnapApps" and is the logo's alt text. Addresses (snapapp.gaiada.com), the page path (/brands/snapapp/) and code
keys stay "snapapp".
The Free Tax Returns logo includes the line "Bigger refund guaranteed". It is part of the approved artwork, so it appears
with the logo; the site's own copy makes no such claim (see REDESIGN.md section 7).

The GOD logo is `src/assets/god-logo.png`.

### Spambank identity v1 (created 2026-11-27 for the GOD site, founder to approve)

Spambank had no logo, so a provisional one was drawn on 2026-11-27. It is not an approved brand asset until the founder
says so. The brands session shares the same files for spambank.gaiada.com: they are in `god/brand-assets/svg/spambank-*.svg`
(with `spambank-palette.md`), and the hex values and contrast checks live in `src/lib/palette.ts` of the
`gaiadabali/spambank-website` repo. The files on this site are byte-for-byte those files, except that the reversed
ones are written `#fff` instead of `#ffffff`.

| File (`src/assets/brands/`)                         | What it is                                                           | Used for                                        |
| --------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| `spambank-mark.svg`                                 | Rounded tile in `#0B7285`, white envelope, small check dot           | Small mark (diagram, About, cards)              |
| `spambank-lockup-reversed.svg`                      | Mark in `#67D4EA` and the wordmark in white, for the deep teal plate | Brand page hero, brand cards                    |
| `spambank-lockup.svg`, `spambank-mark-reversed.svg` | Light-ground lockup, and the reversed mark                           | Supplied for later use, not shipped by the site |

The wordmark "Spambank" is outlined from **Nunito ExtraBold** (Vernon Adams, Jacques Le Bailly and contributors;
SIL Open Font License 1.1, which allows the outlines in a logo). Taken from `@fontsource/nunito` 5.2.7
(`nunito-latin-800-normal.woff`, font version 3.602) and converted to paths with opentype.js 1.3.4 on server-f. No font is
loaded by the site. The paths were tidied with SVGO 3.3.2 on server-f (`convertPathData` off, because it fails on this
outline).
