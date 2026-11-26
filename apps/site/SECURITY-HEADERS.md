# Security headers for god.gaiada.com

What nginx should send for the public site (`apps/site`, static files). Checked against the built output
on server-f on 2026-11-26 (Astro 7.4.13). Nothing here needs a third-party host.

## Content-Security-Policy

Send as one header (shown on several lines for reading):

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'sha256-4yqhSqf81ppW8/WsfavaexVCHZqxjBRJWiLRdsj8inY=';
  style-src 'self';
  img-src 'self';
  font-src 'self';
  connect-src 'self' <contact endpoint origin>;
  manifest-src 'self';
  base-uri 'self';
  form-action 'self';
  object-src 'none';
  frame-ancestors 'none'
```

- `script-src`: the only inline script is the theme bootstrap in `<head>` (it applies a saved light or dark
  theme before first paint). Its hash is above. It is computed from the exact text in
  `src/lib/theme-bootstrap.ts`, and `src/lib/security-headers.test.ts` fails if this file and that script
  drift apart. Every other script is an external module under `/_astro/`, covered by `'self'`.
- `style-src 'self'`: the build never inlines CSS (`build.inlineStylesheets: "never"`) and the pages use no
  `style=""` attributes, so no `'unsafe-inline'` and no style hashes are needed.
- `img-src 'self'` and `font-src 'self'`: images and the two self-hosted fonts are files; the build never
  turns them into `data:` URIs (`vite.build.assetsInlineLimit: 0`).
- `connect-src`: replace `<contact endpoint origin>` with the origin (scheme and host, no path) of
  `PUBLIC_CONTACT_ENDPOINT` once it is decided, for example `https://forms.example.com`. Until the
  variable is set the form sends nothing, so use plain `connect-src 'self'`.
- `frame-ancestors 'none'` only works as a header (browsers ignore it in a `<meta>` tag).
- There is no `unsafe-inline`, `unsafe-eval`, nonce or wildcard anywhere.

### Astro's built-in CSP

Astro 7 has built-in CSP support (`security.csp`, since Astro 6), and it is switched on in
`astro.config.mjs`. The build writes a `<meta http-equiv="content-security-policy">` into every page with the
directives listed in the config, `script-src 'self'` plus Astro's own hashes for the scripts it bundles, and
`style-src 'self'`. Astro does not hash an `is:inline` script, so the config adds the theme bootstrap's hash
itself (`scriptDirective.hashes`), computed from the same string the page inlines. nginx sends the policy as
a header as well, so that `frame-ancestors` applies and an injected tag cannot loosen it. The header and the
meta tag are both enforced and a page must satisfy both, so the header above is the one that sets the limit.

## Other headers

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
X-Frame-Options: DENY
```

- Add `preload` to HSTS only after the owner has decided on HSTS preloading for `gaiada.com`.
- `X-Frame-Options` repeats `frame-ancestors 'none'` for old browsers.
- Use `add_header ... always;`. In nginx, an `add_header` inside a `location` replaces every inherited
  `add_header`, so repeat the whole set in any location that adds its own (for example the cache headers
  below).

## Caching and file types

- `/_astro/*`: file names carry a content hash. `Cache-Control: public, max-age=31536000, immutable`.
- HTML, `/robots.txt`, `/sitemap-*.xml`: `Cache-Control: no-cache`, so a deploy shows at once.
- `/icon-*.png`, `/og-image.png`, `/site.webmanifest`: `Cache-Control: public, max-age=86400`.
- Serve `.webmanifest` as `application/manifest+json`.
- Serve `404.html` for unknown paths (`error_page 404 /404.html;`).
- Pages live at `/about/`, `/brands/` and so on (directory style). Redirect the no-slash form to the slash
  form; nginx's `try_files $uri $uri/ =404;` does that.

## Build-time switches

| Variable                  | Effect                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `PUBLIC_CONTACT_ENDPOINT` | The form POSTs its JSON here. Unset: the form says it is not switched on. Build warns.     |
| `PUBLIC_NOINDEX=1`        | `noindex, nofollow` on every page, `robots.txt` disallows everything, no sitemap. Staging. |

Both are read when the site is built, so changing one means a rebuild.
