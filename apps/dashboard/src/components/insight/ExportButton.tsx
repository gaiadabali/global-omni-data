"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { exportReportAction } from "@/server/audit/actions";
import { PasskeyModal } from "@/components/pages/PasskeyModal";

/**
 * "Export PDF report". Opens the passkey step; on continue the server records the export in the audit log and
 * the page switches to its print view, where the browser's print dialog gives a branded, watermarked PDF.
 */
export function ExportButton({
  kind,
  entity,
  reportName,
}: {
  kind: "insight" | "teens";
  entity: string;
  reportName: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>
        Export PDF report
      </button>
      <PasskeyModal
        open={open}
        title="Export PDF report"
        confirmLabel="Check my passkey and export"
        intro={
          <p>
            {reportName}. The report prints every count as a brand would see it: groups under 10
            print as &quot;&lt;10&quot; (under 20 for teens and sensitive categories), for every
            role.
          </p>
        }
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          const res = await exportReportAction({ kind, entity });
          if (!res.ok)
            return {
              ok: false,
              error: res.error,
              ...(res.freshUrl ? { freshUrl: res.freshUrl } : {}),
            };
          router.push(res.printPath);
          return { ok: true };
        }}
      />
    </>
  );
}
