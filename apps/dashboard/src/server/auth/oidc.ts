import { readFile } from "node:fs/promises";
import * as oidc from "openid-client";
import type { AuthConfig } from "./config";

/**
 * The protocol half of Sign in with YourTal, all in openid-client 6 (OpenID Certified), as SnapApp does it.
 * Nothing here is hand-written protocol: discovery, the authorization URL, PKCE (S256), the `iss` response
 * parameter (RFC 9207), private_key_jwt, and the ID token checks (iss, aud, azp, nonce, exp, iat) are the library's.
 *
 * THE SIGNATURE. openid-client does not check an ID token's signature by default when it comes straight from the
 * token endpoint (OIDC Core 3.1.3.7 allows relying on TLS). We turn on enableNonRepudiationChecks, so every ID
 * token is also verified against YourTal's published JWKS.
 *
 * YourTal's tokens never leave this module except as the verified claims: nothing is stored, logged or sent to
 * the browser.
 */

/** `account` carries region and age_band, and YourTal requires it (docs/26 §1.4). */
export const SCOPES = "openid email profile account";

const DISCOVERY_TTL_MS = 60 * 60_000;
const HTTP_TIMEOUT_S = 10;

export class RedeemError extends Error {
  constructor(readonly kind: "unavailable" | "failed") {
    super(
      kind === "unavailable"
        ? "YourTal could not be reached"
        : "The sign-in could not be completed",
    );
    this.name = "RedeemError";
  }
}

/** The private JWK in GOD_OIDC_KEY_FILE, a single key or a one-key set. It must carry a kid. */
export async function loadClientKey(file: string): Promise<{ key: CryptoKey; kid: string }> {
  const parsed = JSON.parse(await readFile(file, "utf8")) as { keys?: unknown[] } & Record<
    string,
    unknown
  >;
  const jwk = (Array.isArray(parsed.keys) ? parsed.keys[0] : parsed) as JsonWebKey & {
    kid?: string;
  };
  if (!jwk || jwk.kty !== "RSA" || !jwk.d || typeof jwk.kid !== "string" || !jwk.kid) {
    throw new Error("GOD_OIDC_KEY_FILE must hold a private RSA JWK with a kid");
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      d: jwk.d,
      p: jwk.p,
      q: jwk.q,
      dp: jwk.dp,
      dq: jwk.dq,
      qi: jwk.qi,
    },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return { key, kid: jwk.kid };
}

type Cached = { key: string; at: number; config: Promise<oidc.Configuration> };
type Holder = { __godOidc?: Cached | null };

/** The discovered configuration, cached for an hour. A failed discovery is not cached. */
export function getConfiguration(cfg: AuthConfig): Promise<oidc.Configuration> {
  const g = globalThis as Holder;
  const key = `${cfg.issuer} ${cfg.clientId} ${cfg.keyFile}`;
  const hit = g.__godOidc;
  if (hit && hit.key === key && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.config;
  const made = (async () => {
    const { key: signingKey, kid } = await loadClientKey(cfg.keyFile);
    const issuer = new URL(cfg.issuer);
    return oidc.discovery(
      issuer,
      cfg.clientId,
      {
        redirect_uris: [cfg.redirectUri],
        response_types: ["code"],
        id_token_signed_response_alg: "RS256",
      },
      oidc.PrivateKeyJwt({ key: signingKey, kid }),
      {
        timeout: HTTP_TIMEOUT_S,
        // The insecure flag first, so the signature check's JWKS fetch is allowed on a developer's http issuer.
        execute: [
          ...(cfg.insecure && issuer.protocol === "http:" ? [oidc.allowInsecureRequests] : []),
          oidc.enableNonRepudiationChecks,
        ],
      },
    );
  })();
  g.__godOidc = { key, at: Date.now(), config: made };
  made.catch(() => {
    if (g.__godOidc?.config === made) g.__godOidc = null;
  });
  return made;
}

export interface Started {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** The authorization URL, and the secrets the callback must match. A fresh check sends max_age=0, which YourTal
 *  treats as prompt=login: the person signs in again before anything is issued. */
export async function buildStart(
  config: oidc.Configuration,
  redirectUri: string,
  fresh: boolean,
): Promise<Started> {
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const params: Record<string, string> = {
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_type: "code",
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state,
    nonce,
    ui_locales: "en-AU",
  };
  if (fresh) params.max_age = "0";
  return { url: oidc.buildAuthorizationUrl(config, params).href, state, nonce, codeVerifier };
}

/**
 * Redeem the code and return the ID token's verified claims. The caller has already matched `state` against the
 * transaction. `iss` is compared exactly with the discovered issuer (a mix-up defence), then openid-client checks
 * everything again with PKCE, client authentication and the ID token (signature included).
 */
export async function redeem(
  config: oidc.Configuration,
  redirectUri: string,
  query: URLSearchParams,
  expected: { state: string; nonce: string; codeVerifier: string },
): Promise<Record<string, unknown>> {
  const code = query.get("code");
  const iss = query.get("iss");
  const state = query.get("state");
  if (!code || !state || iss !== config.serverMetadata().issuer) throw new RedeemError("failed");
  const current = new URL(redirectUri);
  current.searchParams.set("code", code);
  current.searchParams.set("state", state);
  current.searchParams.set("iss", iss);
  let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
  try {
    tokens = await oidc.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: expected.codeVerifier,
      expectedState: expected.state,
      expectedNonce: expected.nonce,
      idTokenExpected: true,
    });
  } catch (e) {
    // Never pass the library's message on: it can quote the response.
    const name = (e as { name?: string } | null)?.name;
    if (e instanceof TypeError || name === "TimeoutError" || name === "AbortError")
      throw new RedeemError("unavailable");
    throw new RedeemError("failed");
  }
  const claims = tokens.claims();
  if (!claims) throw new RedeemError("failed");
  return { ...claims } as Record<string, unknown>;
}
