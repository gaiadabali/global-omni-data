import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import * as oidc from "openid-client";
import { beforeAll, describe, expect, it } from "vitest";
import { RedeemError, SCOPES, buildStart, redeem } from "./oidc";

/**
 * Token validation through openid-client, with YourTal mocked: provider metadata in hand, and a fake fetch that
 * answers the token endpoint and the JWKS. No network.
 */

const ISSUER = "https://yourtal.test/oidc";
const CLIENT = "god-dashboard";
const REDIRECT = "https://dashboard.test/auth/callback";
const META: oidc.ServerMetadata = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/auth`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/jwks`,
  authorization_response_iss_parameter_supported: true,
  id_token_signing_alg_values_supported: ["RS256"],
  code_challenge_methods_supported: ["S256"],
};

const provider = generateKeyPairSync("rsa", { modulusLength: 2048 });
const impostor = generateKeyPairSync("rsa", { modulusLength: 2048 });

function jwt(
  payload: Record<string, unknown>,
  key: KeyObject = provider.privateKey,
  kid = "yt-1",
): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const head = `${enc({ alg: "RS256", kid, typ: "JWT" })}.${enc(payload)}`;
  return `${head}.${createSign("RSA-SHA256").update(head).sign(key).toString("base64url")}`;
}

const nowS = () => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  aud: CLIENT,
  azp: CLIENT,
  sub: "q8mE3s0dW9xYbVvLr2H4tA",
  iat: nowS(),
  exp: nowS() + 300,
  auth_time: nowS() - 5,
  nonce: "n-1",
  amr: ["hwk"],
  email: "alex.morgan@example.com",
  email_verified: true,
  name: "Alex Morgan",
  region: "AU",
  age_band: "adult",
  ...over,
});

let clientKey: CryptoKey;
beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  clientKey = pair.privateKey;
});

/** A configuration whose every request goes to `answer` instead of the network. */
function config(
  idToken: string,
  seen: { body?: URLSearchParams } = {},
  fail = false,
): oidc.Configuration {
  const c = new oidc.Configuration(
    META,
    CLIENT,
    { id_token_signed_response_alg: "RS256" },
    oidc.PrivateKeyJwt({ key: clientKey, kid: "god-1" }),
  );
  c[oidc.customFetch] = async (url, options) => {
    if (fail) throw new TypeError("fetch failed");
    if (url === META.jwks_uri) {
      const jwk = provider.publicKey.export({ format: "jwk" });
      return Response.json({ keys: [{ ...jwk, kid: "yt-1", alg: "RS256", use: "sig" }] });
    }
    if (url === META.token_endpoint) {
      seen.body = new URLSearchParams(String(options.body));
      return Response.json({
        access_token: "at",
        token_type: "Bearer",
        expires_in: 600,
        id_token: idToken,
      });
    }
    return new Response("not found", { status: 404 });
  };
  oidc.enableNonRepudiationChecks(c);
  return c;
}

const query = (over: Record<string, string> = {}) =>
  new URLSearchParams({ code: "c-1", state: "s-1", iss: ISSUER, ...over });
const expected = { state: "s-1", nonce: "n-1", codeVerifier: "v".repeat(43) };

describe("the authorization URL", () => {
  it("asks for the code flow with PKCE S256, state, nonce and the four scopes; a fresh check adds max_age=0", async () => {
    const c = config("x");
    const plain = new URL((await buildStart(c, REDIRECT, false)).url);
    expect(plain.origin + plain.pathname).toBe(META.authorization_endpoint);
    const p = plain.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe(CLIENT);
    expect(p.get("redirect_uri")).toBe(REDIRECT);
    expect(p.get("scope")).toBe(SCOPES);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("state")).toBeTruthy();
    expect(p.get("nonce")).toBeTruthy();
    expect(p.has("max_age")).toBe(false);
    const fresh = await buildStart(c, REDIRECT, true);
    expect(new URL(fresh.url).searchParams.get("max_age")).toBe("0");
    // The verifier never goes in the URL.
    expect(fresh.url).not.toContain(fresh.codeVerifier);
  });
});

describe("redeeming the code and validating the ID token", () => {
  it("returns the verified claims, and sends the PKCE verifier and a private_key_jwt assertion", async () => {
    const seen: { body?: URLSearchParams } = {};
    const out = await redeem(config(jwt(claims()), seen), REDIRECT, query(), expected);
    expect(out).toMatchObject({ sub: "q8mE3s0dW9xYbVvLr2H4tA", amr: ["hwk"], age_band: "adult" });
    expect(seen.body?.get("code_verifier")).toBe(expected.codeVerifier);
    expect(seen.body?.get("redirect_uri")).toBe(REDIRECT);
    expect(seen.body?.get("client_assertion_type")).toBe(
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    );
    expect(seen.body?.get("client_assertion")?.split(".")).toHaveLength(3);
  });

  const failures: [string, () => oidc.Configuration, URLSearchParams?][] = [
    ["a wrong nonce", () => config(jwt(claims({ nonce: "n-other" })))],
    ["a wrong issuer in the token", () => config(jwt(claims({ iss: "https://evil.test/oidc" })))],
    [
      "a wrong audience",
      () => config(jwt(claims({ aud: "snapapp-staging-web", azp: "snapapp-staging-web" }))),
    ],
    ["an expired token", () => config(jwt(claims({ iat: nowS() - 900, exp: nowS() - 600 })))],
    ["a token signed by another key", () => config(jwt(claims(), impostor.privateKey))],
    ["an unknown key id", () => config(jwt(claims(), provider.privateKey, "yt-unknown"))],
    [
      "a mixed-up iss response parameter",
      () => config(jwt(claims())),
      query({ iss: "https://evil.test/oidc" }),
    ],
    [
      "a missing code",
      () => config(jwt(claims())),
      new URLSearchParams({ state: "s-1", iss: ISSUER }),
    ],
  ];
  for (const [name, make, q] of failures) {
    it(`refuses ${name}`, async () => {
      await expect(redeem(make(), REDIRECT, q ?? query(), expected)).rejects.toBeInstanceOf(
        RedeemError,
      );
    });
  }

  it("refuses a state that does not match the transaction", async () => {
    await expect(
      redeem(config(jwt(claims())), REDIRECT, query({ state: "s-other" }), expected),
    ).rejects.toBeInstanceOf(RedeemError);
  });

  it("a network failure is a RedeemError too, never the library's message", async () => {
    const err = await redeem(config(jwt(claims()), {}, true), REDIRECT, query(), expected).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RedeemError);
    expect(String((err as Error).message)).not.toContain("fetch failed");
  });
});
