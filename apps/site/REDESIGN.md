# god.gaiada.com, version 2: the redesign

Written 2026-11-27 before any code, on branch `fe/site-v2`. The founder's brief: the site felt short and bland; it
needs more real content from the GOD brands, elegant but sparing motion, proper images and copy that shows the
company's quality. This file is the spec the build follows. Facts are sourced at the end; anything not checked is
marked `[UNVERIFIED]`.

## 1. Direction

- **Product.** GOD is the Australian holding company behind YourTal, SnapApps and Free Tax Returns. It turns what
  people do in those apps, with their consent, into aggregate insight for brands. The site's job: make a brand
  manager trust GOD enough to ask a question, and make anyone else understand exactly what GOD does with data.
- **Character.** Exact, accountable, quietly warm. It counts carefully and says plainly what it will not do.
- **World.** The paper trail of everyday Australian life: the docket from the servo, the café receipt, the
  postcode on a form, a census table, a map of suburbs seen from above. Deep indigo ink on cool paper.
- **Moments.** (1) The dotted Australia in the hero, on a deep indigo band, whose dots settle into place. (2) The
  "docket to report" sequence: a real-looking receipt (fictional), a field of dots and a report, drawn in code.
  (3) Real screens of the three apps in hand-built device frames. (4) A small set of licensed photographs of
  everyday Australia.
- **Signature.** The dot and the ring. GOD's logo is a sphere of dots; on this site a filled dot is a counted group
  and a hollow ring is a group too small to show ("<10"). The ring appears wherever a threshold applies (charts,
  the trust promises, the report sample) and nowhere else.

### Type

| Role                               | Face                                | Why                                                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display (h1, h2, large statements) | **Newsreader** variable, 400 to 500 | A text serif with optical sizes. It gives the holding company an editorial, accountable voice (annual-report, not start-up) and contrasts cleanly with the geometric logo. Used large and sparingly. |
| Interface and body                 | **Inter** variable (kept)           | Neutral, very legible at small sizes, already self-hosted.                                                                                                                                           |
| Figures, dockets, data labels      | **IBM Plex Mono** 400 and 500       | The receipt and ledger voice. Tabular, printed character. Used for numbers, sample data and meta only.                                                                                               |

Lexend is dropped. It is a fine readability face but it made every heading look like an app onboarding screen.
All three faces are self-hosted from `@fontsource` (latin and latin-ext subsets only), so the CSP stays `'self'`.

### Colour tokens

| Token            | Light                  | Dark                           | Use                                                                        |
| ---------------- | ---------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `--paper` page   | `#F5F6FA`              | `#0A0C17`                      | Page background, a cool paper with a trace of indigo                       |
| `--card`         | `#FFFFFF`              | `#11142A`                      | Cards, frames                                                              |
| `--raised`       | `#ECEEF6`              | `#191D38`                      | Inputs, hover rows, chips                                                  |
| `--ink` text 1   | `#0F1230`              | `#EEF0F8`                      | Headings and body                                                          |
| `--ink-2` text 2 | `#454B6B`              | `#AEB3CF`                      | Ledes, secondary                                                           |
| `--ink-3` text 3 | `#5E6485`              | `#8C92B3`                      | Captions, meta (AA on paper)                                               |
| `--line`         | ink at 10%             | ink at 12%                     | Hairlines                                                                  |
| `--indigo`       | `#0C158E`              | `#A9B0FF` (as text and accent) | The brand. Primary buttons, links, the one figure that matters             |
| `--night`        | `#070A33`              | `#060820`                      | The deep indigo bands (hero, closing call to action)                       |
| `--ochre`        | `#B8792A` (fills only) | `#E0A14A`                      | Data highlight inside moments only: a city on the map, the highlighted bar |

Each brand has its own colour set, defined once in `src/styles/brands.css` (see section 7). It appears only inside
that brand's page or card; GOD's chrome (header, footer, closing bands, every other page) stays indigo. The old
placeholder colours (gold `#FFC53D`, blue `#1878D8`, navy `#0F172A` and emerald `#10B981`) are retired.

### Layout

12-column grid, max content width 1200 px, 24 px gutters (16 px at phone width). Sections breathe: 128 px apart on
desktop, 80 on phone. Long headlines align left. Asymmetric splits (text 5 columns, visual 7). No centred-stack
heroes, no bento grids, no equal three-card rows unless the three things truly are peers (the three brands are).

## 2. Sitemap

| Path                        | Page                                                      | In the main nav     |
| --------------------------- | --------------------------------------------------------- | ------------------- |
| `/`                         | Home                                                      | logo                |
| `/brands/`                  | Our brands (overview of the four)                         | "Our brands"        |
| `/brands/yourtal/`          | YourTal                                                   | via Our brands      |
| `/brands/snapapp/`          | SnapApps                                                  | via Our brands      |
| `/brands/free-tax-returns/` | Free Tax Returns                                          | via Our brands      |
| `/brands/spambank/`         | Spambank (added 2026-11-27, section 8)                    | via Our brands      |
| `/for-brands/`              | Insight for brands                                        | "For brands"        |
| `/how-it-works/`            | How it works: the data journey and the safeguards         | "How it works"      |
| `/privacy/`                 | Trust & privacy: principles, the teen standard, security  | "Trust"             |
| `/privacy-notice/`          | Group Privacy Notice v1.0 (adult text and #teens section) | footer              |
| `/about/`                   | About GOD                                                 | "About"             |
| `/contact/`                 | Contact                                                   | button "Talk to us" |
| `/404.html`                 | Not found                                                 | none                |

The old footer linked `/privacy/#notice`, so the notice gets its own placeholder page. `/brands/` keeps its URL.

## 3. Pages and draft copy

Copy below is the draft the build uses. Australian English, sentence case, no trailing full stops on headings or
buttons.

### 3.1 Home `/`

1. **Hero** (night band, split: text left, dotted Australia right)
   - h1: **Know your market by what Australians actually do**
   - lede: GOD is the group behind YourTal, SnapApps and Free Tax Returns. People use each app for its own reasons.
     With their consent, we count what they do by suburb, age and occupation, so a brand can understand its market
     without ever seeing a person in it.
   - actions: **See what brands get** (primary) · **How it works**
   - map caption: Each dot is a patch of land, not a person. Density follows where Australians live.
2. **Standards strip** (four real facts, the numbers count up once)
   - **3** apps, one group privacy notice
   - **<10** is how any group under ten people appears
   - **20** teens is the smallest teen group ever counted
   - **Suburb** is as close as a map gets. Never a street.
3. **The group** (h2: **Three everyday apps. One careful company.**)
   - Intro: Each GOD brand does one useful job for the people who use it. GOD sits behind all three. It keeps one
     privacy standard across them and turns what they learn, together, into insight no single app could give.
   - Three brand rows, alternating, each with the brand mark, its own tagline in quotes, two sentences, two facts, a
     status line, a screen in a device frame and a link to the brand page.
     - YourTal, "Watch, learn, earn — and spend it where you live." Short videos from local businesses. Viewers
       answer a question or two, earn points and spend them on vouchers at the businesses they watched. Facts:
       teens join from 13 with a guardian's approval; businesses only ever see grouped results. Status: in staging
       review.
     - SnapApps, "The receipt app that reads every line." Photograph a docket and SnapApps reads each line, splits
       GST-free from taxable, checks it is a valid tax invoice and keeps a true copy for five years. Facts: 10 free
       scans, then 10 cents a scan; work expenses can go straight to Free Tax Returns. Status: Android beta, iPhone
       in development.
     - Free Tax Returns, "Your biggest refund starts here." A free deduction worksheet for Australian workers. Pick
       your occupation, itemise what you spent and copy the exact totals into your own return on myGov. Facts: no
       fees and no sign-up to start; it never lodges or sends anything to the ATO. Status: live at
       freetaxreturns.com.au.
4. **From a docket to a decision** (h2), three steps beside one drawn sequence (receipt → dots → report)
   - **People say yes.** Every GOD app shows the same group privacy notice at sign-up. Nothing reaches GOD until a
     person accepts it.
   - **We count. We never list.** What a person does across the apps joins into one profile, then gets counted by
     suburb, age band, occupation and income bracket. Any group under 10 shows as "<10".
   - **You see the pattern.** Brands get reports about their market: where customers live and shop, who they are
     and what else they buy. Never a name, an address or a list.
5. **Questions brands can answer** (h2: **Questions you can finally answer**), a ledger of six questions, each
   with the insight that answers it, beside a sample report card (labelled sample data).
6. **Built on everyday life** (h2: **Every docket tells a small story. Thousands tell you a market.**) Three
   photographs: café counter, country servo at dusk, market produce, each captioned with the question a brand in
   that industry asks.
7. **The rules come first** (h2), six promises with the ring signature, link to Trust & privacy.
8. **Closing call to action** (night band): **Ask a question about your market.** Tell us who you sell to and what
   you want to know. We reply within two business days with what a report would cover, what it would cost and how
   long it would take. Actions: **Start a conversation** · **See a sample report**.

### 3.2 Our brands `/brands/`

1. Page head: **Three apps people choose for their own reasons** / Each one solves a real problem: rewards from
   local businesses, receipts that file themselves, a tax refund nobody missed. GOD connects them with one sign-in,
   one privacy notice and one standard.
2. Three large brand panels (mark, tagline, who it is for, status, device frame, link to the page and the live site).
3. **How the three connect** (h2): one sign-in ("Sign in with YourTal"), one notice, one profile; what each app adds
   to the picture (YourTal: interests and area; SnapApps: where and what people buy; FTR: occupation and income
   bracket).
4. What stays inside each app (the TFN, bank details, identity documents and return lines never leave FTR; receipt
   images are never copied to GOD).
5. Call to action.

### 3.3 YourTal `/brands/yourtal/`

1. Hero: mark, **YourTal**, h1 **Rewards for paying attention, spent where you live**. Lede: YourTal is a video app
   for local businesses and the people who live near them. Viewers watch, answer a question or two and earn points
   they spend on real vouchers. Businesses pay only for videos that were actually watched. Status line and link to
   yourtal.gaiada.com. Phone frame: the YourTal home screen.
2. **How it works** (the product's own three steps): Watch · Answer honestly · Earn and spend.
3. **For viewers**: terms shown before you press play never change; points don't expire; missing a day never costs
   points; gift a voucher; give one to charity through a three-day auction; no public profiles, comments or follower
   counts. Phone frame: the rewards catalogue.
4. **For businesses**: upload a video, write the questions, set the reward and budget; every campaign is reviewed
   before it goes live; target by interests and districts; reports show completion, accuracy, recall and
   redemptions, always grouped; team roles. Phone frame: the business page.
5. **Teens on YourTal**: from 13 with a guardian's approval by email; half the daily limit, quiet hours 9pm to 7am,
   no streaks, no area setting, no interest profiling; businesses never see a group under 20.
6. **What YourTal adds to GOD**: declared interests, area (postcode only), age band, watching and completions.
   What it never shares: anything for ad targeting of teens.
7. Screens note: screens are from YourTal's staging app, which runs on demo data.

### 3.4 SnapApps `/brands/snapapp/`

1. Hero: h1 **The receipt app that reads every line** (SnapApps' own line). Lede: Photograph a docket. SnapApps reads
   each line, splits GST-free from taxable, checks it is a valid tax invoice and keeps a true copy for five years.
   Then it shows you where the money went. Browser frame: snapapp.gaiada.com.
2. **Snap. Read. Sorted.** (the product's three steps).
3. **What it checks** on every tax invoice: marked as a tax invoice; ABN checksum; GST is one eleventh of the
   taxable lines; lines add up to the total; above $1,000 the buyer is named. "A confident wrong number is worse
   than a blank one."
4. **Everything after the snap**: categories, search, budgets ("safe to spend today"), savings goals, subscriptions
   found in receipts, household sharing, CSV export, works offline.
5. **Pricing in one line**: 10 free scans, then 10 cents a scan (packs of $5, $10, $25), GST included, credits never
   expire, no subscription.
6. **Deductions to Free Tax Returns**: tick a work line, send the file through YourTal sign-in; the file carries no
   merchant names and no images; you review each line in FTR.
7. **What SnapApps adds to GOD**: where people shop (the merchant's suburb and postcode printed on the receipt),
   what they buy by category, spending in bands. It never uses your phone's location; photo GPS is stripped.
8. Status: Android beta, iPhone in development.

### 3.5 Free Tax Returns `/brands/free-tax-returns/`

1. Hero: h1 **A free worksheet for every deduction you're owed**. Lede: Free Tax Returns helps Australian workers
   find every legal deduction for their occupation, then copy the exact totals into their own return on myGov. No
   fees, no sign-up to start, and nothing is ever sent to the ATO. Browser frame: the car-expenses guide.
2. **Three steps. One bigger refund.** (the product's own): complete the questionnaire; pick your occupation and
   itemise; copy the totals and lodge.
3. **What you get**: occupation worksheets, a live cheat sheet by ATO label, PDF export, guides (car, home, overtime
   meals), past years through an amendment, sign-in by one-time code.
4. **You stay in charge**: you lodge your own return; it is not the ATO or myGov and gives general information, not
   advice.
5. **What FTR adds to GOD**: occupation, income bracket, return status. **What never leaves FTR**: tax file
   numbers, bank details, identity documents and the lines of a return.
6. Phone frame: the profile questionnaire.

### 3.6 For brands `/for-brands/`

1. Hero: **See your market. Never the people in it.** Lede: GOD reports what Australians do in the real world:
   where they live, where they shop, what else they buy and who they are. Every figure is an aggregate.
2. **What you can ask for** (six insight areas): catchments (home and activity areas); audience (age band,
   occupation, income bracket); segments with an affinity index; also-shops-at and loyalty; visit frequency and
   spend bands; teen market reports (groups of 20 or more).
3. **A sample catchment report**, full width, for a fictional café group (Harbour & Bean), labelled sample data:
   suburb hex map, where customers live, age mix, occupation mix, also shops at, a "<10" row.
4. **By industry** (four cases with the question each asks and the views that answer it): fuel, grocery, cafés,
   kids' and youth brands.
5. **How to engage**: tell us your question → we scope it (what the report covers, cost and timing) → you get the
   report as aggregates → ask the next question.
6. **What every brand agrees to**: aggregates only, "<10", no person-level data, no lists.
7. Call to action.

### 3.7 How it works `/how-it-works/`

1. Hero: **How a receipt becomes a report** / What happens to data on its way through GOD, step by step, and what
   stops at each step.
2. **The journey** (five stages, sticky diagram on desktop): use an app → accept the group notice → join into one
   profile (Sign in with YourTal, or an exact match on a verified email; no guessing) → count (thresholds, suburb
   level, teens in groups of 20 or more) → report.
3. **What stops at the source**: GOD copies only the fields it needs, at the source. Passwords, tax file numbers,
   bank details, identity documents and receipt images are never copied.
4. **Deleting flows through**: delete your account in any of the three apps and GOD removes you within 1 hour (`NOTICE.deletionWindow`).
5. **The public site holds nothing**: god.gaiada.com is a static site with no access to data.
6. Call to action.

### 3.8 Trust & privacy `/privacy/`

1. Hero: **Trust is a rule, not a promise** / People choose to take part. Brands get totals. Staff access is narrow
   and recorded. The rules are written into the software, not left to good intentions.
2. **Our principles** (the promises, expanded).
3. **The teen standard** (its own band): guardians accept for teens; teens are only counted in groups of 20 or more;
   no profile is kept for a single teen and a teen profile can never be opened; no alcohol, vape, gambling or
   sensitive categories in teen figures; nobody uses GOD data to choose the ads a teen sees.
4. **Security**: invitation-only staff access, passkeys, every look logged, pseudonymous by default, exports print
   "<10".
5. **Your choices**: delete in any app; download your data from each app; the group notice.
6. Link to the notice placeholder.

### 3.9 About `/about/`

1. Hero: **The company behind three useful apps** / Global Omni Data holds and joins up what YourTal, SnapApps and
   Free Tax Returns learn, so each app can stay simple for the people who use it.
2. **What GOD does and doesn't do** (two columns).
3. **Why a holding company**: one sign-in, one standard, one place for the rules.
4. **How we work** (five habits).
5. **Made in Australia, for Australia**: Australian postcodes, occupations and tax.
6. Call to action.

### 3.10 Contact, Privacy notice, 404

- Contact keeps the form and its behaviour exactly (`src/lib/contact.ts`, `src/scripts/contact.ts`), restyled, with
  a "what happens next" panel.
- Privacy notice: a clear placeholder that says the full notice is being finalised and what it will cover.
- 404: **This page isn't on the map** with links to the main pages; one ring motif.

## 4. Motion plan

- One easing curve, `cubic-bezier(0.22, 1, 0.36, 1)`. Durations 160 ms (hover), 600 ms (entrances).
- **Reveals**: sections fade in and rise 12 px once, triggered by a small IntersectionObserver module
  (`src/scripts/reveal.ts`, about 40 lines). Staggers of 60 ms, six items at most. Without JS, or with reduced
  motion, everything is visible and still.
- **Map settling**: the hero map's dot groups fade in from the coast inwards over about 1.2 s; city rings expand once.
  No loop.
- **Counting**: the four standard figures count up once (3, 10, 20) when they come into view; "Suburb" types in.
- **Docket to report**: on desktop the sequence lights each stage as the matching step scrolls into view (CSS
  scroll-driven `view()` timeline where supported, an IntersectionObserver class switch elsewhere).
- **Device frames**: a 4 px lift on hover for linked frames; nothing moves on its own.
- **Everything** collapses to no motion under `prefers-reduced-motion: reduce`. No scroll-jacking, no parallax, no
  loops, no layout shift (all images have sizes; reveals use transform and opacity only).

## 5. Image plan

- **Product screens** (main imagery), captured on server-f with Playwright 1.65.1 on 2026-11-27 from the public
  marketing pages only. YourTal's are from its staging site, which runs on demo data; the staging banner is cropped
  and the captions say so. Stored as WebP in `src/assets/screens/`, served through `astro:assets` as AVIF and WebP
  at responsive widths. Frames are CSS (phone and browser), never mock-up images.
- **Photographs**: six Unsplash photos under the Unsplash License (free for commercial use, no attribution
  required), recorded in `CREDITS.md`. Downloaded on server-f, stored in `src/assets/photos/`, served through
  `astro:assets`.
- **Brand logos**: the founder-approved SVGs from `god/brand-assets/svg/`, optimised (section 7, `CREDITS.md`).
- **Data visuals**: the dotted Australia (build-time SVG), the docket, dot fields, the sample report and the hex
  catchment map, all static SVG or CSS. No chart library at runtime.
- **og-image.png**: regenerated with sharp on server-f: indigo field, the logo in white, the dotted map.

## 7. Brand identity on the site (added 2026-11-27)

Founder request, 2026-11-27: "the god website need to use the new brands logos and its brand color. and each brands
should have its own page and link it to its own website." The three brand pages already existed; this section records
how the new logos and colours are applied. Logos and sources: `CREDITS.md`. Colours: `src/styles/brands.css`, the only
place a brand colour is written, with light and dark values, checked by `src/lib/brands.test.ts`.

### Rules

- **GOD stays the frame.** Indigo `#0C158E`, Newsreader, Inter and Plex Mono are unchanged. No brand font was added: the
  logo files carry each brand's own type, so the build ships no new web font.
- **Scope.** A brand colour applies inside a `[data-brand="..."]` element: the `<main>` of a brand page (`Base` takes a
  `brand` prop) or one brand card. In that scope the indigo accent (links, kickers, step numbers, focus ring, primary
  button) becomes the brand's. Header, footer, the night bands and the other pages are untouched.
- **A logo sits on the ground it was drawn for.** YourTal (yellow line art): always Charcoal `#363636`. Free Tax Returns:
  the reversed logo on navy `#101529`. SnapApps: white in light mode, Ink `#0F172A` in dark mode. The small marks use the
  same logic: a Charcoal tile for YourTal, a light tile for the Free Tax Returns arrow, and none for SnapApps' rounded
  square.
- **Brand page hero.** Logo plate above the h1; a "stage" plate in the brand colour behind the device frame (orange for
  SnapApps with Ink captions, Charcoal for YourTal, navy for Free Tax Returns, each with a short accent rule inside); a
  primary "Visit <host>" button in the brand fill. Brand cards (home, /brands/) use the quiet tint of the brand colour
  behind the device instead of the full stage.
- **Links to each brand's own site.** Every brand card, every brand hero and the footer carry a "Visit <host>" link with
  `target="_blank"`, `rel="noopener"` and a hidden note in the accessible name ("opens YourTal's own site in a new tab").
  The visible text is contained in the accessible name (WCAG 2.5.3). The addresses are written only in
  `src/lib/brands.ts`. SnapApps and YourTal are staging hosts today, so their final domains may change in that one file.
  SnapApps' page also notes its web app, `app.snapapps.gaiada.com`.

### Colour tokens (hex; contrast checked against the page papers `#F5F6FA` and `#0A0C17`)

| Brand            | Fill, text on fill                                      | Accent text on light | Accent text on dark | Notes                                                                                                             |
| ---------------- | ------------------------------------------------------- | -------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| SnapApps         | `#EA542D`, Ink `#0F172A` (4.9:1)                        | `#B2300F` (5.8:1)    | `#FF8A66`           | White on orange only for large text. Orange is never body text on light.                                          |
| YourTal          | `#FFDA00`, Ink `#0F172A` (13:1)                         | `#705700` (6.4:1)    | `#FFDA00`           | Yellow is never text on a light ground. Plate Charcoal `#363636`.                                                 |
| Free Tax Returns | navy `#101529`, white; dark mode: green `#54BE92`, navy | `#1B7352` (5.4:1)    | `#54BE92`           | Green only as a fill, or as text on navy or dark. The guide lists `#34D399`; the logo file is `#54BE92` and wins. |

`src/lib/brands.test.ts` fails if any of these pairs drops below 4.5:1 in either theme.

### Decisions to confirm

- The Free Tax Returns logo contains "Bigger refund guaranteed". The site's copy deliberately avoids guarantee claims
  (section 6, "Deliberately left out"). The logo is shown as approved, at a size where the line can be read. If the
  founder or the brand's lawyer would rather not show it on GOD's site, the fix is to supply a logo version without the
  line; nothing in the code needs to change except the file.
- YourTal's mascot, SnapApps' wordmark and poster, and the navy Free Tax Returns logo were supplied but are not used.

## 8. Spambank, the fourth brand (added 2026-11-27)

Founder, 2026-11-27: Spambank is its own brand even though it lives inside the apps. Its own site, https://spambank.gaiada.com (staging, live 2026-11-27), is listed in `src/lib/brands.ts` (`href` and `host`), so its
card, page hero and footer carry a "Visit spambank.gaiada.com" link. It is a `kind: "feature"` with `availableIn: [snapapp,
yourtal, ftr]`, so the card and page also list the three apps it lives in. `public/brands.json` points to the same site.

### Spambank identity v1, 2026-11-27, provisional, founder to approve

Drawn for this site on 2026-11-27 and adopted by the brands session for spambank.gaiada.com, so the two sites do not
diverge: the files are in `god/brand-assets/svg/spambank-*.svg`, with `spambank-palette.md`; the hex values and contrast
checks are in `src/lib/palette.ts` of `gaiadabali/spambank-website`. Nothing here is approved.

- **Mark.** A rounded tile, a white envelope with a flap line, and a small check dot at the corner: a clean inbox. It reads
  at 24 px. No padlock or shield, so it does not look like a bank or an antivirus.
- **Wordmark.** "Spambank" in Nunito ExtraBold outlines (OFL 1.1, see `CREDITS.md`): rounded, friendly, easy.
- **Colour.** A calm cerulean teal, apart from SnapApps orange, YourTal yellow, Free Tax Returns navy and green, and GOD
  indigo. Fill `#0B7285` with white text (5.6:1); accent text on light `#0A6275` (6.4:1); on dark `#67D4EA` with `#06303B` on
  the fill; plate and stage deep teal `#0A4A5A` with white text (9.8:1). Tokens are in `src/styles/brands.css` and the same
  test checks them.
- **Draft tagline: "Your real inbox, kept clean."** Written for this site. Founder to approve. It is the one line on the
  site that Spambank did not write itself.
- **Files.** `spambank-mark.svg`, `spambank-mark-reversed.svg`, `spambank-lockup.svg`, `spambank-lockup-reversed.svg` in
  `src/assets/brands/` and `god/brand-assets/svg/`.

### What the page says, and where each line comes from

Sources: `god/spambank/PLAN.md` and `BUILD.md`, and the founder's brief of 2026-11-27.

| Claim on the site                                                                                                      | Source                                           |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| One free address per person, a short generated name, shared across SnapApps, YourTal and Free Tax Returns; one mailbox | PLAN S2, BUILD (one mailbox per YourTal account) |
| Spam and bulk mail go to Junk automatically; one-tap unsubscribe; read, write and search                               | PLAN section 3, BUILD unsubscribe design         |
| Works in phone mail apps over IMAP with app passwords                                                                  | PLAN (devices), BUILD B3                         |
| Statements mailed to the address can be imported into SnapApps, opt-in                                                 | PLAN section 3, BUILD (`statementsToSnapApp`)    |
| Adults only, no mailbox on teen accounts                                                                               | PLAN D5, BUILD C1                                |
| Deleting a YourTal account erases the mailbox                                                                          | BUILD (`spambank-erase-sweep`)                   |
| GOD never reads or uses the contents of anyone's email; Spambank adds nothing to what GOD counts                       | Founder brief 2026-11-27                         |
| In staging testing, not open to the public; Android and web, iPhone later                                              | Founder brief 2026-11-27                         |

Left out on purpose: "mail is deleted after 30 days" (the only 30-day purge in the plan is for ingest bookkeeping rows, not
mail, so the claim is not supported and was dropped until the founder confirms a retention rule); the auto-reply to
brands and the sender lead list (founder decision pending); anything about a mail address on `mail.yourtal.gaiada.com`;
any claim about scanning, targeting, profiles or selling data.

### Illustrations

The Mail screens are drawn in HTML and CSS (`MailMock`, `AddressCard`, `OneMailbox`) with made-up sample mail from made-up
senders, and the caption says so. They use fixed light colours (`--sbui-*`) because they depict the app's own screen.

### Still open

- The Group Privacy Notice (`/privacy-notice/`, v1.0) names three brands and does not mention Spambank or mailboxes. It is a
  legal text; the owner and the lawyer decide how it covers Spambank. The site does not edit it for this.
- `/for-brands/`, `/privacy/` and `/how-it-works/` still describe the three apps, which is right: Spambank adds nothing to
  the counts.

## 6. Content sources

Repos: YT = `god/yourtal`, SA = `god/snap-apps`, FTR = `god/free-tax-returns/free-tax-return-preview`,
PLAN = `god/god-holding/PLAN.md`, CL = this repo's `CLAUDE.md`. Read 2026-11-27.

| Claim on the site                                                                                                                                       | Source                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GOD holds YourTal, SnapApps, FTR; one profile; brands get aggregates only                                                                               | PLAN §1; CL intro                                                                           |
| One group privacy notice, required at registration; existing users accept at next sign-in                                                               | PLAN §3                                                                                     |
| Groups under 10 show as "<10"; sensitive categories use a higher threshold                                                                              | PLAN §3, §6.2; CL rule 5                                                                    |
| Teens counted only in groups of 20+; no teen profile; teen profiles not openable; no alcohol, vape, gambling, sensitive categories; no ad targeting     | CL rule 5; PLAN §3, §5; founder brief 2026-11-27                                            |
| TFN, bank details, identity documents and return lines never leave FTR; occupation, income bracket, return status flow                                  | PLAN §3                                                                                     |
| Staff access invitation-only, passkey, logged; pseudonymous by default                                                                                  | PLAN §6.3; founder brief; existing site copy                                                |
| Maps stop at suburb level                                                                                                                               | PLAN §4.4, §6.2                                                                             |
| Deletion removes the person from GOD within 1 hour (`NOTICE.deletionWindow`)                                                                            | PLAN §3                                                                                     |
| GOD copies rows, not files (no receipt images); secrets dropped at the source                                                                           | PLAN §4.1, §4.3                                                                             |
| Sign in with YourTal across the apps; verified-email exact matching, no fuzzy matching                                                                  | PLAN §2, §4.2                                                                               |
| Public site has no data access                                                                                                                          | PLAN §4 diagram                                                                             |
| YourTal: watch, answer, earn points, vouchers; "Watch, learn, earn — and spend it where you live."                                                      | YT `apps/web/features/landing/landing-hero.tsx`; `apps/web/messages/en-AU/public.json`      |
| YourTal: never pay for a view that was not watched                                                                                                      | YT `apps/web/features/landing/landing-for-business.tsx`                                     |
| YourTal: points don't expire; missing a day never costs points; gift; charity auction; no public profiles                                               | YT `messages/en-AU/public.json` (pages.points, pages.help), `wallet.json`, `auction.json`   |
| YourTal: campaign review, targeting by interests and districts, grouped reports, team roles                                                             | YT `messages/en-AU/studio.json`                                                             |
| YourTal teens: 13+, guardian approval by email, half daily limit, quiet hours 9pm to 7am, no streaks, no area, no interest profiling, no group under 20 | YT `messages/en-AU/public.json` (pages.terms, pages.privacy)                                |
| YourTal status: building toward a staging review; demo data                                                                                             | YT `README.md`, `TASKS.md` L5-7                                                             |
| SnapApps: "The receipt app that reads every line."; GST split; tax-invoice check; five-year copy                                                        | SA `apps/web/src/app/(marketing)/_home/hero.tsx`, `page.tsx:16`                             |
| SnapApps checks: tax invoice, ABN checksum, GST one eleventh, lines add up, buyer at $1,000+                                                            | SA `(marketing)/how-it-works/journey.tsx`                                                   |
| SnapApps: budgets, goals, subscriptions, household sharing, CSV, offline                                                                                | SA `(marketing)/_home/bento.tsx`                                                            |
| SnapApps pricing: 10 free scans, 10 c a scan, packs $5/$10/$25, credits never expire                                                                    | SA `(marketing)/pricing/credit-packs.ts`                                                    |
| SnapApps to FTR: work lines, via YourTal sign-in, no merchant names or images                                                                           | SA `apps/mobile/release-notes.json` (2026-11-26), `SendToFtrCard.tsx`, `docs/DEDUCTIONS.md` |
| SnapApps: photo GPS stripped, never indexed                                                                                                             | SA `(marketing)/legal/privacy/page.tsx`                                                     |
| SnapApps status: Android beta, iPhone in development                                                                                                    | SA `(marketing)/download/page.tsx`, `_home/faq.tsx`                                         |
| FTR: free worksheet, copy totals into the ATO return, no sign-up, no fees, never sends to the ATO                                                       | FTR `src/app/page.tsx`, `README.md`, `docs/manual/10-faq-and-privacy.md`                    |
| FTR three steps                                                                                                                                         | FTR `src/app/page.tsx:259-306`                                                              |
| FTR features: occupation worksheets, cheat sheet by ATO label, PDF, guides, past years, OTP sign-in                                                     | FTR `docs/manual/05-cheat-sheet-and-pdf.md`, `src/lib/llms.ts`, guide routes                |
| FTR: not affiliated with the ATO or myGov; general information only                                                                                     | FTR `src/messages/en-AU.json` footer                                                        |

### Deliberately left out

- FTR's "40+ years' experience", "100,000 Australians", "100% audit-proof" and occupation maximums: marketing claims
  that are not independently sourced.
- SnapApps' "9 checks" (the how-it-works page says four rules) and any accuracy figure (the product forbids one).
- SnapApps' competitor comparison (legal risk on a parent site) and any "Australian-hosted" claim (it is not).
- YourTal's internal cost-per-prospect figures; any "launched" wording for YourTal.
- User counts, revenue, partners, testimonials, awards and people's names: none exist that can be published.
