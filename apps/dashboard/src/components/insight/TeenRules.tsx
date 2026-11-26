import { Card } from "@/components/ui";

/** The teen rules in plain words, on the page itself. They are enforced in code; this is the short version. */
export function TeenRules() {
  return (
    <Card title="The teen rules">
      <ul className="rules">
        <li>
          <b>Groups of 20 or more.</b> Every figure on this page covers at least 20 teens. A smaller group prints as
          &quot;&lt;20&quot;, for every role, the Owner included.
        </li>
        <li>
          <b>No teen profile.</b> A teen&apos;s profile is never opened, by anyone. There is nothing to open.
        </li>
        <li>
          <b>No ad targeting of teens.</b> These figures describe the audience for reporting. They are not a list of
          teens to target.
        </li>
        <li>
          <b>Nothing sensitive.</b> Alcohol, vape, gambling, pharmacy and health, and every other sensitive category
          are never reported for teens.
        </li>
      </ul>
    </Card>
  );
}
