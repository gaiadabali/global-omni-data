import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("next.config headers", () => {
  it("keeps the versioned boundary files in the browser cache for good, and only those", async () => {
    const rules = await nextConfig.headers!();
    const geo = rules.find((r) => r.source.startsWith("/geo/"));
    expect(geo).toBeDefined();
    expect(geo!.source).toContain("state|sa4|sa3|sa2");
    expect(geo!.headers).toEqual([{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }]);
    // The security headers still apply to everything.
    const all = rules.find((r) => r.source === "/:path*")!;
    expect(all.headers.map((h) => h.key)).toContain("Cross-Origin-Resource-Policy");
  });
});
