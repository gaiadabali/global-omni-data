import { readAuthConfig } from "../auth/config";
import { devAuthState } from "../dev-auth";

/**
 * Break-glass settings, derived from the real sign-in settings: nothing new to configure. The WebAuthn relying
 * party is the dashboard itself (RP ID = GOD_PUBLIC_URL's host, origin = GOD_PUBLIC_URL), never YourTal, so the
 * emergency key works while YourTal is down. Off while dev sign-in is on, and off when the settings are unusable
 * (the server then refuses to start anyway).
 */
export interface BreakGlassConfig {
  /** dashboard.god.gaiada.com */
  rpId: string;
  /** https://dashboard.god.gaiada.com */
  origin: string;
  rpName: string;
}

type Env = Record<string, string | undefined>;

export function readBreakGlassConfig(env: Env = process.env): BreakGlassConfig | null {
  if (devAuthState(env) !== "off") return null;
  const cfg = readAuthConfig(env);
  if (!cfg) return null;
  return { rpId: new URL(cfg.publicUrl).hostname, origin: cfg.publicUrl, rpName: "GOD dashboard" };
}
