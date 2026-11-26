import { createHash } from "node:crypto";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { themeBootstrap } from "./src/lib/theme-bootstrap.ts";

const site = "https://god.gaiada.com";
const noindex = process.env.PUBLIC_NOINDEX === "1";
const endpoint = (process.env.PUBLIC_CONTACT_ENDPOINT ?? "").trim();

// The contact endpoint's origin is the only third-party-looking address the page may talk to.
let endpointOrigin = "";
if (endpoint) {
  try {
    endpointOrigin = new URL(endpoint).origin;
  } catch {
    throw new Error(`PUBLIC_CONTACT_ENDPOINT is not a valid URL: ${endpoint}`);
  }
}

// Astro hashes the scripts it bundles but not an is:inline one, so the theme bootstrap's hash is added here.
const themeHash = `sha256-${createHash("sha256").update(themeBootstrap).digest("base64")}`;

const warnings = {
  name: "god-site-warnings",
  hooks: {
    "astro:build:start": ({ logger }) => {
      if (!endpoint) {
        logger.warn(
          "PUBLIC_CONTACT_ENDPOINT is not set: the contact form will tell visitors it is not switched on yet.",
        );
      }
      if (noindex) {
        logger.warn(
          "PUBLIC_NOINDEX=1: every page gets noindex and robots.txt disallows everything.",
        );
      }
    },
  },
};

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "always",
  compressHTML: true,
  // No markdown on this site; Shiki's inline styles would clash with the CSP.
  markdown: { syntaxHighlight: false },
  devToolbar: { enabled: false },
  integrations: [
    ...(noindex ? [] : [sitemap({ filter: (page) => !page.includes("/404") })]),
    warnings,
  ],
  build: {
    format: "directory",
    // Keep CSS in files and never turn assets into data: URIs, so style-src and font-src stay on 'self'.
    inlineStylesheets: "never",
  },
  vite: {
    build: { assetsInlineLimit: 0 },
  },
  security: {
    // Astro writes a <meta http-equiv="content-security-policy"> per page and hashes the scripts and
    // styles it emits. nginx sends the same policy as a header (see SECURITY-HEADERS.md).
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self'",
        "font-src 'self'",
        `connect-src 'self'${endpointOrigin ? ` ${endpointOrigin}` : ""}`,
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "manifest-src 'self'",
      ],
      scriptDirective: { hashes: [themeHash] },
    },
  },
});
