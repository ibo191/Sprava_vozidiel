import type { Issue, State } from "./domain";
export function IssueUpdates({
  issue: i,
  state: s,
}: {
  issue: Issue;
  state: State;
}) {
  if (!i.updates?.length) return null;
  return (
    <div className="issue-updates">
      <h4>Průběh řešení</h4>
      <ol>
        {[...i.updates].reverse().map((u) => (
          <li key={u.id}>
            <small>
              {u.at
                ? new Date(u.at).toLocaleString("cs-CZ", {
                    timeZone: "Europe/Prague",
                  })
                : "Předchozí odpověď · datum neevidováno"}{" "}
              ·{" "}
              {u.actor
                ? (s.users.find((x) => x.id === u.actor)?.name ?? "Správce")
                : "Autor neevidován"}
            </small>
            <p>{u.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
