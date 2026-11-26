import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { homePathFor } from "@/server/access";
import { ROLE_LABELS, BRAND_LABELS } from "@/server/types";
import { getViewer } from "@/server/viewer";

/** The refusal shown (with a real 403) when a role may not open a page. */
export default async function Forbidden() {
  const viewer = await getViewer();
  const role = viewer
    ? viewer.role === "brand_lead" && viewer.brand
      ? `${ROLE_LABELS.brand_lead} (${BRAND_LABELS[viewer.brand]})`
      : ROLE_LABELS[viewer.role]
    : "your role";
  const home = viewer ? homePathFor(viewer) : "/signin";
  return (
    <Card>
      <EmptyState
        title="Your role can't open this"
        action={
          <Link className="btn primary" href={home}>
            {viewer?.role === "brand_lead" ? `Go to ${BRAND_LABELS[viewer.brand ?? "yourtal"]}` : "Go to Group overview"}
          </Link>
        }
      >
        This page is not part of the {role} view. Ask the Owner for access.
      </EmptyState>
    </Card>
  );
}
