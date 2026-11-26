"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { enquiryUpdateAction } from "@/server/audit/actions";

type Status = "new" | "read" | "archived";

const BUTTONS: Record<Status, { to: Status; label: string }[]> = {
  new: [
    { to: "read", label: "Mark as read" },
    { to: "archived", label: "Archive" },
  ],
  read: [
    { to: "new", label: "Mark as new" },
    { to: "archived", label: "Archive" },
  ],
  archived: [{ to: "read", label: "Restore" }],
};

const DONE: Record<Status, string> = {
  new: "marked as new",
  read: "marked as read",
  archived: "archived",
};

/** Mark one enquiry read, new or archived. Recorded in the audit log. No passkey check: it is reversible. */
export function EnquiryActions({ id, status, who }: { id: string; status: Status; who: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  return (
    <div className="row">
      {BUTTONS[status].map((b) => (
        <button
          key={b.to}
          type="button"
          className="btn sm"
          disabled={busy}
          aria-label={`${b.label}: enquiry from ${who}`}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await enquiryUpdateAction({ id, status: b.to });
              toast(res.ok ? `Enquiry from ${who} ${DONE[b.to]}.` : res.error);
              if (res.ok) router.refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
