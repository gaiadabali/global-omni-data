"use client";

import { useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEV_ROLE_LABELS, DEV_ROLE_VALUES, isDevRoleValue, type DevRoleValue } from "@/server/dev-roles";
import { setDevRole } from "@/server/dev-actions";
import { useToast } from "@/components/ui/Toast";

/**
 * "Prototype: signed in as". Shown only when dev sign-in is on (the shell decides). Choosing a role calls a
 * server action, which checks the dev guard itself and sets the cookie; then the page re-renders on the server.
 */
export function RoleSwitch({ value }: { value: DevRoleValue }) {
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();

  return (
    <div className="rolebox">
      <label htmlFor={id}>Prototype: signed in as</label>
      <select
        id={id}
        key={value}
        defaultValue={value}
        disabled={pending}
        onChange={(e) => {
          const role = e.target.value;
          if (!isDevRoleValue(role)) return;
          start(async () => {
            const res = await setDevRole(role);
            if (res.ok) {
              toast(`Now viewing as ${DEV_ROLE_LABELS[role]}. The pages you can open changed.`);
              router.refresh();
            }
          });
        }}
      >
        {DEV_ROLE_VALUES.map((v) => (
          <option key={v} value={v}>
            {DEV_ROLE_LABELS[v]}
          </option>
        ))}
      </select>
    </div>
  );
}
