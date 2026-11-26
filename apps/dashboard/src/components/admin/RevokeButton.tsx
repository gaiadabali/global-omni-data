"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { revokeSessionAction } from "@/server/audit/actions";

/** Revoke one session. It ends at once: the next request from that browser is signed out. Recorded in the audit log. */
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
          toast(res.ok ? `${res.person} is signed out of that session.` : res.error);
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
