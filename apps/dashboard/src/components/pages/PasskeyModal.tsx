"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { FRESH_STEP_TEXT, goToFreshCheck } from "@/lib/fresh-step";

export type ConfirmResult = { ok: true } | { ok: false; error: string; freshUrl?: string };

/**
 * "Confirm with your passkey." Exports and allow-list changes need a passkey sign-in in the last 5 minutes. The
 * server decides: when the last check is older, the action answers with `freshUrl`, and this modal sends the
 * browser to YourTal (max_age=0) and back to this page, where the person presses the button again.
 */
export function PasskeyModal({
  open,
  title,
  intro,
  confirmLabel = "Continue",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  /** One or two plain lines about what is about to happen. */
  intro?: ReactNode;
  confirmLabel?: string;
  onClose: () => void;
  /** Runs when the person continues. Return { ok: false, error } to keep the modal open with a message. */
  onConfirm: () => Promise<ConfirmResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    onClose();
  }

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await onConfirm();
      if (r.ok) close();
      else if (r.freshUrl) {
        setError(FRESH_STEP_TEXT);
        goToFreshCheck(r.freshUrl);
        return;
      } else setError(r.error);
    } catch {
      setError("Something went wrong, and nothing was recorded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={() => {
        if (!busy) close();
      }}
      actions={
        <>
          <button type="button" className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={go} disabled={busy}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {intro ? <div>{intro}</div> : null}
      <div className="callout" role="note">
        <div>
          <b>Confirm with your passkey.</b> If you have not used your passkey in the last 5 minutes, YourTal asks
          for it first and brings you back here. What you do next is written to the audit log.
        </div>
      </div>
      <div className="small muted" aria-live="polite">
        {busy ? (
          <>
            <span className="dots" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <i key={i} />
              ))}
            </span>{" "}
            Waiting for your passkey
          </>
        ) : null}
      </div>
      {error ? (
        <div className="small err" role="alert">
          {error}
        </div>
      ) : null}
    </Modal>
  );
}
