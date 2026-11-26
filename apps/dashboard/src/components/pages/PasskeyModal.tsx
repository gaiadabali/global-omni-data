"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";

export type ConfirmResult = { ok: true } | { ok: false; error: string };

/**
 * "Confirm with your passkey." Exports and invitations need a fresh passkey check. Real sign-in does not exist
 * yet, so in this phase the step says so plainly and then carries on. When real sign-in arrives, the check goes
 * inside `onConfirm`'s caller and this modal stays as it is.
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
      else setError(r.error);
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
          <b>Confirm with your passkey.</b> There is no passkey sign-in yet. A passkey check will happen here once
          real sign-in exists, and this step will not carry on without it. For now it carries on, and what you do
          next is written to the audit log.
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
