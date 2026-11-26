import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

/**
 * THE WEBAUTHN SEAM. Everything break-glass needs from @simplewebauthn/server, behind one small interface, so the
 * handlers can be tested with a fake (every refusal path) and with the real library against a software
 * authenticator (webauthn.test.ts). User verification is required every time (a PIN, a fingerprint or a face, not
 * just a touch), and attestation is not asked for.
 *
 * A verify method never throws: anything malformed, forged, replayed or from the wrong origin is null.
 */
export const CEREMONY_TIMEOUT_MS = 120_000;

export interface VerifiedRegistration {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
}

export interface WebAuthn {
  registrationOptions(input: {
    rpId: string;
    rpName: string;
    /** Credential ids already active: the same authenticator cannot be added twice. */
    exclude: readonly string[];
  }): Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyRegistration(input: {
    response: unknown;
    challenge: string;
    origin: string;
    rpId: string;
  }): Promise<VerifiedRegistration | null>;
  authenticationOptions(input: { rpId: string }): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthentication(input: {
    response: unknown;
    challenge: string;
    origin: string;
    rpId: string;
    key: { credentialId: string; publicKey: Uint8Array; counter: number };
  }): Promise<{ newCounter: number } | null>;
}

const CREDENTIAL_ID = /^[A-Za-z0-9_-]{1,1400}$/;

/** The id a browser response names, if it looks like a credential response at all. */
export function responseCredentialId(response: unknown): string | null {
  if (typeof response !== "object" || response === null) return null;
  const r = response as { id?: unknown; rawId?: unknown; type?: unknown; response?: unknown };
  if (r.type !== "public-key" || typeof r.response !== "object" || r.response === null) return null;
  if (typeof r.id !== "string" || !CREDENTIAL_ID.test(r.id) || r.rawId !== r.id) return null;
  return r.id;
}

export const simpleWebAuthn: WebAuthn = {
  async registrationOptions({ rpId, rpName, exclude }) {
    return generateRegistrationOptions({
      rpName,
      rpID: rpId,
      // What the authenticator shows. Nothing about the person: the key is sealed in an envelope.
      userName: "emergency-owner",
      userDisplayName: "GOD emergency Owner access",
      attestationType: "none",
      timeout: CEREMONY_TIMEOUT_MS,
      excludeCredentials: exclude.map((id) => ({ id })),
      // Discoverable, so the sign-in page can ask without naming any key to an anonymous visitor.
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
  },

  async verifyRegistration({ response, challenge, origin, rpId }) {
    if (!responseCredentialId(response)) return null;
    try {
      const v = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
      });
      if (!v.verified || !v.registrationInfo) return null;
      const c = v.registrationInfo.credential;
      return { credentialId: c.id, publicKey: new Uint8Array(c.publicKey), counter: c.counter };
    } catch {
      return null;
    }
  },

  async authenticationOptions({ rpId }) {
    return generateAuthenticationOptions({
      rpID: rpId,
      userVerification: "required",
      timeout: CEREMONY_TIMEOUT_MS,
      allowCredentials: [],
    });
  },

  async verifyAuthentication({ response, challenge, origin, rpId, key }) {
    if (responseCredentialId(response) !== key.credentialId) return null;
    try {
      const v = await verifyAuthenticationResponse({
        response: response as AuthenticationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: {
          id: key.credentialId,
          publicKey: new Uint8Array(key.publicKey),
          counter: key.counter,
        },
      });
      return v.verified ? { newCounter: v.authenticationInfo.newCounter } : null;
    } catch {
      return null;
    }
  },
};
