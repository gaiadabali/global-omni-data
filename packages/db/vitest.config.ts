import { defineConfig } from "vitest/config";

// The integration tests need a real Postgres (scripts/server-f/db-test.sh); they skip themselves without one.
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 60_000, fileParallelism: false },
});
