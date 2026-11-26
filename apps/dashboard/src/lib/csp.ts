/**
 * Content-Security-Policy, built per request in src/proxy.ts.
 *
 * script-src: nonce + 'strict-dynamic'. No 'unsafe-inline', and no 'unsafe-eval' outside `next dev`.
 * style-src: 'self' + the nonce, no 'unsafe-inline' in production. Next serves its CSS as files (covered by
 *   'self') and puts the nonce on any inline <style> it emits. The dashboard never renders a style="" attribute
 *   in HTML (CSP would block it): colours come from classes and SVG presentation attributes, and the few dynamic
 *   values (a tooltip position) are set through the CSSOM, which CSP allows.
 * In `next dev` only, style-src gets 'unsafe-inline' (dev tooling injects style tags) and script-src 'unsafe-eval'.
 */
export interface CspOptions {
  nonce: string;
  /** `next dev`: adds 'unsafe-eval' and 'unsafe-inline'. Never true in a production build. */
  dev: boolean;
  /** Staging and production sit behind https, so mixed content is upgraded. Off for plain-http local runs. */
  upgradeInsecure: boolean;
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function buildCsp({ nonce, dev, upgradeInsecure }: CspOptions): string {
  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgradeInsecure) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
