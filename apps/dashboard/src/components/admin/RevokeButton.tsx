"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { revokeSessionAction } from "@/server/audit/actions";

/** Revoke a session. In dev this ends nothing: it records the request in the audit log and says so. */
export function RevokeButton({ sessionId, person }: { sessionId: string; person: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  return (
    <button
      type="button"
      className="btn sm danger"
      disabled={busy}
      aria-label={`Revoke the session of ${person}`}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await revokeSessionAction({ sessionId });
          toast(
            res.ok
              ? `Dev: no session was ended. The request to sign ${res.person} out is recorded in the audit log.`
              : res.error,
          );
          if (res.ok) router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      Revoke
    </button>
  );
}
