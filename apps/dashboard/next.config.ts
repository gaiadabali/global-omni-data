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
  // @god/synthetic and @god/geo ship TypeScript source.
  transpilePackages: ["@god/synthetic", "@god/geo"],
  // forbidden() gives a real 403 for a page the viewer's role may not open.
  experimental: { authInterrupts: true },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The boundary files carry the data version in their URL (?v=...), so they can be cached for good.
        source: "/geo/:level(state|sa4|sa3|sa2).json",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
