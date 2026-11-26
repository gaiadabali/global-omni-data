/**
 * Client side of the fresh passkey check: when an action answers with `freshUrl`, the browser goes to YourTal
 * through /auth/start?fresh=1 and comes back to this page. The server checks the return path again.
 */
export function goToFreshCheck(freshUrl: string): void {
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`${freshUrl}&return=${encodeURIComponent(here)}`);
}

export const FRESH_STEP_TEXT =
  "Taking you to YourTal to check your passkey. You come back here after, and can carry on for 5 minutes.";
