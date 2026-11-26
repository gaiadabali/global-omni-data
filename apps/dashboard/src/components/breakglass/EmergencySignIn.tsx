"use client";

import { useState, useSyncExternalStore } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

const subscribeToNothing = () => () => undefined;

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, data };
}

/**
 * The one button on /auth/emergency. It asks this dashboard for a challenge, lets the browser talk to the
 * emergency key (with its PIN, fingerprint or face), and sends the answer back. YourTal is not involved.
 */
export function EmergencySignIn({ available }: { available: boolean }) {
  const supported = useSyncExternalStore(subscribeToNothing, browserSupportsWebAuthn, () => true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const start = await post("/auth/emergency/options", {});
      if (start.status !== 200) {
        setError(typeof start.data.error === "string" ? start.data.error : "Something went wrong. Try again.");
        return;
      }
      let response;
      try {
        response = await startAuthentication({
          optionsJSON: start.data.options as PublicKeyCredentialRequestOptionsJSON,
        });
      } catch {
        setError("The key did not answer, or the request was cancelled. Try again.");
        return;
      }
      const done = await post("/auth/emergency/verify", { ceremonyId: start.data.ceremonyId, response });
      if (done.status === 200 && typeof done.data.next === "string") {
        window.location.assign(done.data.next);
        return;
      }
      setError(typeof done.data.error === "string" ? done.data.error : "That key was not accepted.");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const usable = available && supported;
  return (
    <div className="stack">
      <button
        type="button"
        className="btn primary wide"
        disabled={!usable || busy}
        aria-describedby="emergency-note"
        onClick={go}
      >
        Use the emergency key
      </button>
      <div className="small muted" aria-live="polite">
        {busy ? (
          <>
            <span className="dots" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <i key={i} />
              ))}
            </span>{" "}
            Waiting for your key
          </>
        ) : null}
      </div>
      {!supported ? (
        <p className="small err" role="alert">
          This browser cannot use a security key or passkey. Try another browser.
        </p>
      ) : null}
      {error ? (
        <p className="small err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
