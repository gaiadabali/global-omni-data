import type { NextConfig } from "next";

/**
 * Static security headers. The Content-Security-Policy is per request (it carries a nonce), so it is set in
 * src/proxy.ts, built by src/lib/csp.ts. Strict-Transport-Security is set by nginx in front of the app.
 */
const securityHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @god/synthetic ships TypeScript source.
  transpilePackages: ["@god/synthetic"],
  // forbidden() gives a real 403 for a page the viewer's role may not open.
  experimental: { authInterrupts: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
