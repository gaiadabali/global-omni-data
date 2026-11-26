import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { chooseDevRole } from "@/server/dev-actions";
import { isDevAuthEnabled } from "@/server/dev-auth";
import { DEV_ROLE_LABELS, DEV_ROLE_VALUES } from "@/server/dev-roles";

export const metadata: Metadata = { title: "Dev role switch" };

/**
 * Dev only: pick a role to sign in as. There is no page at all (404) unless GOD_DEV_AUTH=1 and
 * GOD_DEPLOYMENT=dev, and the action behind the buttons checks the same guard itself.
 */
export default function DevRolePage() {
  if (!isDevAuthEnabled()) notFound();
  return (
    <main>
      <h1>Prototype: signed in as</h1>
      <p className="muted">
        Dev sign-in is on. Pick a role. This is replaced by Sign in with YourTal and a passkey.
      </p>
      <Card title="Roles">
        <form action={chooseDevRole} className="row">
          {DEV_ROLE_VALUES.map((v) => (
            <button key={v} type="submit" name="role" value={v} className="btn">
              {DEV_ROLE_LABELS[v]}
            </button>
          ))}
        </form>
      </Card>
      <p>
        <Link href="/signin">Back to the sign-in screen</Link>
      </p>
    </main>
  );
}
