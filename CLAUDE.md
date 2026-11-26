# Working rules — global-omni-data

GOD (Global Omni Data) is the holding company of YourTal, SnapApp and Free Tax Returns. This repo holds its public
site and its group dashboard. Read this file before changing anything.

## Branches

- The front end is built on the **`frontend`** branch and merged into `main` at the end.
- Each piece of work happens in its own worktree under `.claude/worktrees/<name>`, on its own branch cut from
  `frontend`. The lead session reviews every diff and merges it. Coding agents commit on their own branch and
  never push, merge or rebase `frontend`.

## Non-negotiable

1. **Synthetic data only.** Never commit real personal data, exports, database dumps, `.env` files or secrets.
   Development, tests and screenshots use the seeded generator in `packages/synthetic`.
2. **Build on server-f, never on the laptop.** Do not run `pnpm install`, `npm install`, a build, a test runner or a
   dev server on the laptop. No GitHub Actions. Use:
   `bash scripts/server-f/remote-build.sh <tree> <site|dashboard|all|shots-site|shots-dashboard> <name>`
   (`<name>` is unique per worktree). When it rewrites `pnpm-lock.yaml`, commit the lockfile with the
   `package.json` change.
3. **Stop only processes you started, by PID.** Never `taskkill /IM node.exe` or kill anything by image name: other
   agents share this machine.
4. **Stay inside the paths your brief gives you.** Shared files (root config, `tools/`, `scripts/`) change only when
   the brief says so.
5. **Privacy rules live in code, not in good intentions:**
   - Every count that can reach a brand passes through one threshold function: under 10 shows as "<10", and under
     20 shows as "<20" for teen and sensitive-category figures. Exact small counts are shown only to the Owner and
     Data team roles, inside the dashboard.
   - Brand roles never receive a person, a person-level point or a person id, not even in a JSON response.
   - Teen profiles are never openable. Every teen figure covers 20 or more teens. Alcohol, vape, gambling and
     sensitive categories never appear in teen figures.
   - Every role check runs on the server. Hiding a link or a button is not a check.
6. **Dev sign-in** is on only when `GOD_DEV_AUTH=1` **and** `GOD_DEPLOYMENT=dev`. With `GOD_DEV_AUTH=1` and any
   other `GOD_DEPLOYMENT`, the dashboard refuses to start. Staging and production set neither. Real sign-in
   (Sign in with YourTal, allow-list, passkey) comes later and is not faked in the meantime.
7. **No third parties at runtime.** Fonts are self-hosted, the base map is self-hosted (PMTiles), and there are no
   analytics, tag managers or CDN scripts, so a strict CSP stays possible.

## Stack

Exact versions in every `package.json`, never ranges. Matched to YourTal where it overlaps.

| Piece | Version |
|---|---|
| Node, pnpm, TypeScript | 24, 12.6.0, 6.0.3 |
| Dashboard | Next 16.4.5 (App Router), React 19.3.0, Tailwind 4.3.x |
| Site | Astro 7.4.x, static output |
| Maps | MapLibre GL 6, deck.gl 9.4, h3-js 4, pmtiles 4 |
| Charts | d3 modules (`d3-scale`, `d3-shape`, `d3-array`) drawn as React SVG: one chart system |
| Tests | vitest 5 |

## Design

The founder approved the website and dashboard prototypes on 2026-11-26; build to them. Brand colour GOD indigo
`#0C158E`; Lexend for headings, Inter for text; light and dark themes; works at 390 px wide with no sideways
scroll. Copy is plain Australian English: short sentences, no jargon, no hype.

## Layout

| Path | What |
|---|---|
| `apps/site` | Public site, Astro, static |
| `apps/dashboard` | Group dashboard, Next.js |
| `packages/synthetic` | Seeded synthetic people, businesses, receipts and aggregates |
| `tools/shots` | Screenshots of a built app on server-f (`routes.<app>.json` lists the routes) |
| `scripts/server-f` | The remote build |

## Checking your work

1. `remote-build.sh <tree> <app> <name>` passes: typecheck, lint, tests and build.
2. `remote-build.sh <tree> shots-<app> <name>`, then look at every PNG in `.shots/<app>/` and read `report.json`.
   Zero console errors, zero failed requests, and nothing overflowing at 390 px.
3. Commits are small, say what changed and why, and end with the `Co-Authored-By` trailer you were given.
