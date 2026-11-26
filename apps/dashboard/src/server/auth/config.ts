import { existsSync } from "node:fs";
import { devAuthState } from "../dev-auth";

/**
 * Sign in with YourTal: configuration. Read from the environment only here. With dev sign-in off, a missing or
 * bad value stops the server at start (src/instrumentation.ts), exactly as the dev guard does. Problems name the
 * variable, never its value.
 *
 *   YOURTAL_ISSUER       https://yourtal.gaiada.com/oidc (the discovery document's issuer, exactly)
 *   GOD_OIDC_CLIENT_ID   god-dashboard
 *   GOD_OIDC_KEY_FILE    SECRET: path to the private JWK (RS256, with a kid) for private_key_jwt
 *   GOD_PUBLIC_URL       https://dashboard.god.gaiada.com (origin only; the redirect is <origin>/auth/callback)
 *   GOD_SESSION_SECRET   SECRET: 32 bytes or more; keys the sign-in cookie's encryption and the audit sub hash
 */
export interface AuthConfig {
  issuer: string;
  clientId: string;
  keyFile: string;
  /** Origin, no trailing slash. */
  publicUrl: string;
  redirectUri: string;
  sessionSecret: string;
  /** Plain http allowed for the issuer and the public URL (GOD_DEPLOYMENT=dev only). */
  insecure: boolean;
}

type Env = Record<string, string | undefined>;

export const AUTH_ENV = [
  "YOURTAL_ISSUER",
  "GOD_OIDC_CLIENT_ID",
  "GOD_OIDC_KEY_FILE",
  "GOD_PUBLIC_URL",
  "GOD_SESSION_SECRET",
] as const;

export const MIN_SECRET_BYTES = 32;

function httpUrl(v: string | undefined, insecure: boolean): URL | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || (insecure && u.protocol === "http:")) return u;
  } catch {
    /* not a URL */
  }
  return null;
}

/** Everything wrong with the sign-in settings, by variable name. Empty when they are usable. */
export function authConfigProblems(
  env: Env = process.env,
  fileExists: (p: string) => boolean = existsSync,
): string[] {
  const insecure = env.GOD_DEPLOYMENT === "dev";
  const problems: string[] = [];
  const issuer = httpUrl(env.YOURTAL_ISSUER, insecure);
  if (!issuer || issuer.search || issuer.hash)
    problems.push("YOURTAL_ISSUER must be the YourTal issuer URL (https)");
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(env.GOD_OIDC_CLIENT_ID ?? ""))
    problems.push("GOD_OIDC_CLIENT_ID is missing or malformed");
  if (!env.GOD_OIDC_KEY_FILE) problems.push("GOD_OIDC_KEY_FILE is not set");
  else if (!fileExists(env.GOD_OIDC_KEY_FILE))
    problems.push("GOD_OIDC_KEY_FILE does not point at a file");
  const pub = httpUrl(env.GOD_PUBLIC_URL, insecure);
  if (!pub || (pub.pathname !== "/" && pub.pathname !== "") || pub.search || pub.hash) {
    problems.push("GOD_PUBLIC_URL must be the dashboard's https origin, with no path");
  }
  if (Buffer.byteLength(env.GOD_SESSION_SECRET ?? "", "utf8") < MIN_SECRET_BYTES) {
    problems.push(`GOD_SESSION_SECRET must be at least ${MIN_SECRET_BYTES} bytes`);
  }
  return problems;
}

/** The settings, or null when they are not usable. Never throws. */
export function readAuthConfig(env: Env = process.env): AuthConfig | null {
  if (authConfigProblems(env, () => true).length) return null;
  const publicUrl = new URL(env.GOD_PUBLIC_URL as string).origin;
  return {
    issuer: env.YOURTAL_ISSUER as string,
    clientId: env.GOD_OIDC_CLIENT_ID as string,
    keyFile: env.GOD_OIDC_KEY_FILE as string,
    publicUrl,
    redirectUri: `${publicUrl}/auth/callback`,
    sessionSecret: env.GOD_SESSION_SECRET as string,
    insecure: env.GOD_DEPLOYMENT === "dev",
  };
}

/**
 * STAGING-ONLY SWITCH (founder, 2026-11-27): GOD_ALLOW_PASSWORD_SIGNIN=1 also accepts a YourTal sign-in made with a
 * password (amr "pwd", or "mfa" for password plus an authenticator code), for the Owners who have no passkey yet.
 * A passkey is always accepted. The switch must be OFF before any real person's data reaches the dashboard
 * (TASKS 9.11); /healthz reports it so nobody can miss it.
 */
export function passwordSignInAllowed(env: Env = process.env): boolean {
  return env.GOD_ALLOW_PASSWORD_SIGNIN === "1";
}

/** Whether real sign-in runs: dev sign-in off and the settings usable. Never both. */
export function isRealSignInOn(env: Env = process.env): boolean {
  return devAuthState(env) === "off" && readAuthConfig(env) !== null;
}

export class AuthConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(`Refusing to start: Sign in with YourTal is not configured. ${problems.join("; ")}.`);
    this.name = "AuthConfigError";
  }
}

/** Throws when dev sign-in is off and the real sign-in settings are missing or bad. */
export function assertAuthConfig(
  env: Env = process.env,
  fileExists: (p: string) => boolean = existsSync,
): void {
  if (devAuthState(env) !== "off") return;
  const problems = authConfigProblems(env, fileExists);
  if (problems.length) throw new AuthConfigError(problems);
}
