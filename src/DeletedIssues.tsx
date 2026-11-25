import type { State } from "./domain";
import { IssueUpdates } from "./IssueUpdates";
export function DeletedIssues({
  state: s,
  vehicleId,
  search,
  onRestore,
}: {
  state: State;
  vehicleId: string;
  search: string;
  onRestore: (id: string) => Promise<void>;
}) {
  const rows = (s.deletedIssues ?? []).filter((x) => {
    const v = s.vehicles.find((v) => v.id === x.issue.vehicleId);
    return (
      v &&
      (vehicleId === "all" || v.id === vehicleId) &&
      `${v.brand} ${v.model} ${v.plate}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  });
  if (!rows.length) return null;
  return (
    <details className="panel deleted-issues">
      <summary>Smazané vyřešené závady ({rows.length})</summary>
      {rows.map((x) => {
        const v = s.vehicles.find((v) => v.id === x.issue.vehicleId)!;
        return (
          <details className="archived-issue" key={x.issue.id}>
            <summary>
              {v.brand} {v.model} · {v.plate} · {x.issue.date}
            </summary>
            <p>{x.issue.description}</p>
            <p>
              Smazáno {new Date(x.deletedAt).toLocaleString("cs-CZ")} ·{" "}
              {x.reason}
            </p>
            {x.issue.insuranceCase && (
              <p>
                Pojistné plnění:{" "}
                {x.issue.insurancePayout == null
                  ? "Neuvedeno"
                  : x.issue.insurancePayout.toLocaleString("cs-CZ") + " Kč"}
              </p>
            )}
            <IssueUpdates issue={x.issue} state={s} />
            <button
              className="button secondary"
              onClick={() => onRestore(x.issue.id)}
            >
              Obnovit závadu
            </button>
          </details>
        );
      })}
    </details>
  );
}
