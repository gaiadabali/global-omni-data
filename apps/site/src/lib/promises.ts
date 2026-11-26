/**
 * The six rules GOD keeps, in plain words. Sources: PLAN.md §3, §4, §6 and CLAUDE.md rule 5
 * (see REDESIGN.md §6). The "⁠" word joiner keeps "<10" from breaking across lines.
 */
export const PROMISES = [
  {
    h: "Brands get aggregates only",
    p: "Totals and shares for groups of people. Never a name, an email, a phone number or a list.",
  },
  {
    h: "Small groups stay hidden",
    p: "Any group under 10 people shows as “⁠<10”. Sensitive categories use a higher threshold.",
  },
  {
    h: "Teens only in groups of 20 or more",
    p: "No profile of a single teen and no ad targeting. Alcohol, vape, gambling and sensitive categories never appear in teen figures.",
  },
  {
    h: "Tax and bank details stay in Free Tax Returns",
    p: "Tax file numbers, bank details, identity documents and the lines of a return never leave FTR.",
  },
  {
    h: "Staff access is narrow and recorded",
    p: "Invitation only, signed in with a passkey, and every look at a record is logged.",
  },
  {
    h: "Maps stop at the suburb",
    p: "The finest view is a suburb-sized area, never a street. A shop's location comes from its receipt, never from a phone.",
  },
] as const;
