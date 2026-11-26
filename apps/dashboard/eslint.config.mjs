import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "next-env.d.ts"]),
  {
    // Pages, components and route handlers reach data only through getDashboardData(viewer), never the provider.
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/data/provider", "@/server/data/synthetic", "@god/synthetic"],
              message:
                "Use getDashboardData(viewer) from @/server/data. The provider returns exact numbers and must not reach a page.",
            },
          ],
        },
      ],
    },
  },
]);
