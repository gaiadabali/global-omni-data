"use client";

import { useToast } from "@/components/ui/Toast";

/** Dev only: nothing runs. It says what would happen. The sampled run on real teens is never started from here. */
export function RunVerifyButton() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      className="btn"
      onClick={() => toast("Synthetic fixtures queued. Results appear in the run list in about 4 minutes. (Dev: nothing runs.)")}
    >
      Run synthetic fixtures now
    </button>
  );
}
