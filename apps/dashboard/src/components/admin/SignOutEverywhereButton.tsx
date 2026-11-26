"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { revokeAllForPersonAction } from "@/server/audit/actions";

/** Ends every session one person has. Recorded in the audit log. Not shown for yourself: sign out instead. */
export function SignOutEverywhereButton({ personId, person }: { personId: string; person: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  return (
    <button
      type="button"
      className="btn sm"
      disabled={busy}
      aria-label={`Sign ${person} out everywhere`}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await revokeAllForPersonAction({ personId });
          toast(res.ok ? `${res.person} is signed out everywhere (${res.ended} ${res.ended === 1 ? "session" : "sessions"}).` : res.error);
          if (res.ok) router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      Sign out everywhere
    </button>
  );
}
