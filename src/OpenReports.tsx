import { ChevronRight } from "lucide-react";
import type { Issue, State } from "./domain";
export function OpenReports({
  state: s,
  onOpen,
  onAll,
}: {
  state: State;
  onOpen: (i: Issue) => void;
  onAll: () => void;
}) {
  const rows = [...s.issues]
    .reverse()
    .filter((i) => i.status !== "resolved")
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="panel open-reports">
      <div className="panel-heading">
        <h2>
          Otevřená hlášení <span className="count">{rows.length}</span>
        </h2>
        <button className="text-button" onClick={onAll}>
          Všechna hlášení <ChevronRight size={15} />
        </button>
      </div>
      {!rows.length ? (
        <p className="open-reports-empty">Žádná otevřená hlášení závad.</p>
      ) : (
        rows.slice(0, 6).map((i) => {
          const v = s.vehicles.find((v) => v.id === i.vehicleId);
          return (
            <button
              className="open-report-row"
              key={i.id}
              onClick={() => onOpen(i)}
            >
              <span>
                <strong>
                  {v ? `${v.brand} ${v.model}` : "Vozidlo"} · {v?.plate}
                </strong>
                <small>{i.description}</small>
              </span>
              <span
                className={
                  "badge " + (i.severity === "serious" ? "overdue" : "soon")
                }
              >
                {i.kind === "accident"
                  ? "Nehoda"
                  : i.status === "new"
                    ? "Nové hlášení"
                    : "Závada"}
              </span>
              <ChevronRight size={17} />
            </button>
          );
        })
      )}
    </section>
  );
}
