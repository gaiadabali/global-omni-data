/**
 * Runs once when the server starts.
 * 1. A misconfigured dev sign-in stops the server here, before it serves anything.
 * 2. With dev sign-in off, missing or bad Sign in with YourTal settings stop it too (not during `next build`,
 *    which runs without the server's secrets).
 * 3. The synthetic sample is built in the background so the first map request is not slow.
 *
 * "Stops" means the process exits. Checked on Helios 2026-11-27: when register() only threw, Next logged
 * "Failed to prepare server" and kept the process up, answering every request with a 500. That failed closed
 * (dev sign-in never ran), but a refusal must be impossible to miss: the container exits, restarts, and the
 * deploy's health check rolls back.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const building = process.env.NEXT_PHASE === "phase-production-build";
  try {
    const { assertDevAuthSafe } = await import("./server/dev-auth");
    assertDevAuthSafe();
    if (!building) {
      const { assertAuthConfig } = await import("./server/auth/config");
      assertAuthConfig();
    }
  } catch (e) {
    if (building) throw e;
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (!building) {
    void import("./server/data/warm").then((m) => m.warm()).catch(() => undefined);
  }
}
