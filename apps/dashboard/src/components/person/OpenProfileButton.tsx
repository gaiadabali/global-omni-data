"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { FRESH_STEP_TEXT, goToFreshCheck } from "@/lib/fresh-step";
import { openProfileAction } from "@/server/audit/actions";
import { OPEN_REASONS, buildReason } from "@/server/audit/reasons";

/**
 * Opens a profile only after a reason: a required category plus a line of free text. The server writes the audit
 * event (with this person's id, the time and the reason) before the profile can be shown. `autoOpen` opens the
 * modal straight away (a profile link without a reason lands here); cancelling then goes back to the search.
 */
export function OpenProfileButton({
  id,
  label = "Open",
  autoOpen = false,
  primary = false,
}: {
  id: string;
  label?: string;
  autoOpen?: boolean;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [reasonId, setReasonId] = useState<string>(OPEN_REASONS[0].id);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const uid = useId();

  function close() {
    setOpen(false);
    setError(null);
    if (autoOpen) router.push("/person");
  }

  async function submit() {
    const check = buildReason(reasonId, note);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await openProfileAction({ id, reasonId, note });
      if (!res.ok) {
        if (res.freshUrl) {
          setError(FRESH_STEP_TEXT);
          goToFreshCheck(res.freshUrl);
          return;
        }
        setError(res.error);
        return;
      }
      setOpen(false);
      setNote("");
      router.push(`/person?id=${encodeURIComponent(id)}`);
      router.refresh();
    } catch {
      setError("Something went wrong, and the profile was not opened. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`btn sm${primary ? " primary" : ""}`}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <Modal
        open={open}
        title="Open this profile?"
        onClose={() => {
          if (!busy) close();
        }}
        actions={
          <>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn primary" onClick={submit} disabled={busy}>
              Open profile
            </button>
          </>
        }
      >
        <p>
          You are about to open <span className="mono">{id}</span>. This is recorded in the audit
          log with your name, the time and your reason.
        </p>
        <p className="small muted">
          Opening a profile needs your passkey in the last 5 minutes. If it is older, YourTal asks
          for it and brings you back here; then open the profile again.
        </p>
        <div className="field">
          <label htmlFor={`${uid}-reason`}>Reason</label>
          <select
            id={`${uid}-reason`}
            value={reasonId}
            onChange={(e) => setReasonId(e.target.value)}
          >
            {OPEN_REASONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-note`}>Details</label>
          <textarea
            id={`${uid}-note`}
            rows={3}
            value={note}
            placeholder="What are you checking, and why this person?"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="small err" role="alert">
          {error}
        </div>
      </Modal>
    </>
  );
}
