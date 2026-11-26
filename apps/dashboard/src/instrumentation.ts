/**
 * Runs once when the server starts.
 * 1. A misconfigured dev sign-in stops the server here, before it serves anything.
 * 2. The synthetic sample is built in the background so the first map request is not slow.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { assertDevAuthSafe } = await import("./server/dev-auth");
  assertDevAuthSafe();

  if (process.env.NEXT_PHASE !== "phase-production-build") {
    void import("./server/data/warm").then((m) => m.warm()).catch(() => undefined);
  }
}
