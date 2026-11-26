"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useToast } from "@/components/ui/Toast";
import { FRESH_STEP_TEXT, goToFreshCheck } from "@/lib/fresh-step";
import { beginEnrolAction, finishEnrolAction } from "@/server/breakglass/actions";

const subscribeToNothing = () => () => undefined;

/**
 * Add an emergency key: the code from the lead, then the browser registers the key with this dashboard. The server
 * checks the Owner, the fresh passkey check and the code before it hands out a challenge (src/server/breakglass/
 * enrol.ts). When the passkey check is older than 5 minutes, YourTal asks for it and brings the Owner back here,
 * and the code is entered again (it is not used until the key is added).
 */
export function BreakGlassEnrol({ disabled = false }: { disabled?: boolean }) {
  const supported = useSyncExternalStore(subscribeToNothing, browserSupportsWebAuthn, () => true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const begun = await beginEnrolAction({ code });
      if (!begun.ok) {
        if (begun.freshUrl) {
          setError(`${FRESH_STEP_TEXT} Enter the code again when you are back.`);
          goToFreshCheck(begun.freshUrl);
          return;
        }
        setError(begun.error);
        return;
      }
      let response;
      try {
        response = await startRegistration({
          // The server's options type and the browser's are the same JSON shape from two packages.
          optionsJSON: begun.options as unknown as PublicKeyCredentialCreationOptionsJSON,
        });
      } catch {
        setError("The key did not answer, or the request was cancelled. Try again: the code still works.");
        return;
      }
      const done = await finishEnrolAction({ ceremonyId: begun.ceremonyId, response });
      if (!done.ok) {
        setError(done.error);
        return;
      }
      setCode("");
      toast("Emergency key added. Test it once, then seal it away.");
      router.refresh();
    } catch {
      setError("Something went wrong, and no key was added. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <div className="field">
        <label htmlFor="bg-code">Enrolment code from the lead</label>
        <input
          id="bg-code"
          name="code"
          className="mono"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          disabled={disabled || busy}
          required
        />
      </div>
      <div className="row">
        <button
          type="submit"
          className="btn primary"
          disabled={disabled || busy || !supported || code.trim().length < 20}
        >
          Add emergency key
        </button>
      </div>
      <div className="small muted" aria-live="polite">
        {busy ? "Waiting for the key" : null}
      </div>
      {!supported ? (
        <p className="small err" role="alert">
          This browser cannot register a security key or passkey. Try another browser.
        </p>
      ) : null}
      {error ? (
        <p className="small err" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
