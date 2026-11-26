import { describe, expect, it } from "vitest";
import { mapMeta, parseActivityQuery } from "./map-api";

describe("mapMeta", () => {
  const meta = mapMeta();

  it("lists 24 months ending at the current month", () => {
    expect(meta.months).toHaveLength(24);
    expect(meta.months.at(-1)).toBe(meta.currentMonth);
  });

  it("names the teen band 13–17 and flags pharmacy as sensitive", () => {
    expect(meta.ageBands[meta.teenBand]).toBe("13–17");
    expect(meta.categories.filter((c) => c.sensitive).map((c) => c.id)).toEqual(["pharm"]);
  });

  it("agrees with the activity query validation: a sensitive category with teens is refused", () => {
    const sensitive = meta.categories.find((c) => c.sensitive)!;
    const q = parseActivityQuery(new URLSearchParams(`ageBand=13-17&category=${sensitive.id}`));
    expect(q.ok).toBe(false);
  });
});
