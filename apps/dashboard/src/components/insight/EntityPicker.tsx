"use client";

import { useId } from "react";
import { usePathname, useRouter } from "next/navigation";

export interface EntityOption {
  id: string;
  name: string;
  group: string;
}

/** The "Merchant, chain or category" chooser. The choice lives in the URL (?entity=), so the page is shareable. */
export function EntityPicker({ entities, value }: { entities: EntityOption[]; value: string }) {
  const id = useId();
  const router = useRouter();
  const path = usePathname();
  const groups = [...new Set(entities.map((e) => e.group))];
  return (
    <div className="ctl picker">
      <label htmlFor={id}>Merchant, chain or category</label>
      <select id={id} value={value} onChange={(e) => router.push(`${path}?entity=${encodeURIComponent(e.target.value)}`)}>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {entities
              .filter((e) => e.group === g)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
