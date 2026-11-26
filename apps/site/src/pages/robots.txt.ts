import type { APIRoute } from "astro";
import { SITE_URL } from "../lib/site";

// PUBLIC_NOINDEX=1 (staging) turns the whole site off for crawlers. Otherwise it is open and points at the sitemap.
export const GET: APIRoute = () => {
  const closed = import.meta.env.PUBLIC_NOINDEX === "1";
  const body = closed
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap-index.xml\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
