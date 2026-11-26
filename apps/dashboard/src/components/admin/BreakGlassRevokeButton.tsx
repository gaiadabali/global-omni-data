"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PasskeyModal } from "@/components/pages/PasskeyModal";
import { useToast } from "@/components/ui/Toast";
import { revokeKeyAction } from "@/server/breakglass/actions";

/** Revoke an emergency key. Final. Needs a fresh passkey check, and ends that Owner's emergency sessions. */
export function BreakGlassRevokeButton({
  credentialId,
  label,
  owner,
}: {
  credentialId: string;
  label: string;
  owner: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  return (
    <>
      <button
        type="button"
        className="btn sm danger"
        aria-label={`Revoke the emergency key of ${owner}`}
        onClick={() => setOpen(true)}
      >
        Revoke
      </button>
      <PasskeyModal
        open={open}
        title="Revoke this emergency key?"
        confirmLabel="Check my passkey and revoke"
        intro={
          <p>
            {owner}&apos;s emergency key ({label}) stops working at once, and any emergency session it opened
            ends. This cannot be undone: a new key needs a new code from the lead.
          </p>
        }
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          const res = await revokeKeyAction({ credentialId });
          if (!res.ok)
            return { ok: false, error: res.error, ...(res.freshUrl ? { freshUrl: res.freshUrl } : {}) };
          toast(
            res.sessionsEnded
              ? `Key revoked. ${res.sessionsEnded} emergency ${res.sessionsEnded === 1 ? "session" : "sessions"} ended.`
              : "Key revoked.",
          );
          router.refresh();
          return { ok: true };
        }}
      />
    </>
  );
}
