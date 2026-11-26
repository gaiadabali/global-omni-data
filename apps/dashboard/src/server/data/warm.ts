import { warmSynthetic } from "./synthetic";

/** Builds the synthetic sample ahead of the first request. Called from instrumentation.ts in the background. */
export function warm(): void {
  warmSynthetic();
}
