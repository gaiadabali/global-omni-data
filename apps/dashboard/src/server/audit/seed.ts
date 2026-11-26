import { allProfiles, featuredProfiles } from "@god/synthetic";
import type { SeedEvent } from "./memory";

/**
 * Synthetic audit history for the dev log. Fictional people and events, dated around the approved design's
 * "today" (26 Nov 2026). Two events are dated relative to the real clock ("a few minutes ago"): the Owner and the
 * Data team each opened the featured profile just now, so a fresh dev server has an opened profile to look at.
 */
export function seedAuditEvents(nowMs: number): SeedEvent[] {
  const { adult, teen } = featuredProfiles();
  const adults = allProfiles()
    .filter((p) => !p.teen)
    .map((p) => p.id);
  const other = (i: number) => adults[i] ?? adult.id;
  const minutesAgo = (m: number) => new Date(nowMs - m * 60_000).toISOString();

  return [
    { when: "2026-11-18T10:05:00+11:00", who: "dev-owner", action: "allowlist.change", target: "@sam.ortega", reason: "Added as brand lead for YourTal" },
    { when: "2026-11-19T16:30:00+11:00", who: "dev-owner", action: "session.revoke", target: "Chen Wei", reason: "Left a shared laptop signed in" },
    { when: "2026-11-20T14:05:00+11:00", who: "dev-data", action: "person.open", target: other(1), reason: "Check a sync or merge problem: two accounts joined by email" },
    { when: "2026-11-21T09:55:00+11:00", who: "dev-owner", action: "export.pdf", target: "map:all", reason: "Influence map snapshot, All GOD (PDF)" },
    { when: "2026-11-22T19:48:00+11:00", who: "@jay.r", action: "signin.refused", target: "dashboard", reason: "This account cannot be used (details not stored)", outcome: "refused" },
    { when: "2026-11-23T10:30:00+11:00", who: "dev-owner", action: "allowlist.invite", target: "@chen.w", reason: "Data team, paper agreement signed 16 Nov 2026" },
    { when: "2026-11-24T15:11:00+11:00", who: "@mia.t", action: "signin.refused", target: "dashboard", reason: "Signed in with a password, passkey required", outcome: "refused" },
    { when: "2026-11-24T16:20:00+11:00", who: "dev-data", action: "person.open", target: teen, reason: "Refused: teen profiles cannot be opened", outcome: "refused" },
    { when: "2026-11-25T13:20:00+11:00", who: "@devon.k", action: "signin.refused", target: "dashboard", reason: "Not on the allow-list", outcome: "refused" },
    { when: "2026-11-25T17:02:00+11:00", who: "dev-executive", action: "export.pdf", target: "insight:harbour", reason: "Brand insight report: Harbour & Bean (PDF)" },
    { when: "2026-11-26T08:44:00+11:00", who: "dev-data", action: "person.open", target: other(2), reason: "Confirm a geocoding result: home placed at postcode level" },
    { when: minutesAgo(6), who: "dev-owner", action: "person.open", target: adult.id, reason: "Check a sync or merge problem: three accounts joined, confirming the links" },
    { when: minutesAgo(3), who: "dev-data", action: "person.open", target: adult.id, reason: "Confirm a geocoding result: home area looks too wide" },
  ];
}
