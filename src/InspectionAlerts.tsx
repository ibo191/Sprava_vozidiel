import { inspectionStatus, type State, type Vehicle } from "./domain";
export function InspectionAlerts({
  state: s,
  onEdit,
}: {
  state: State;
  onEdit: (v: Vehicle) => void;
}) {
  const rows = s.vehicles
    .filter((v) => v.active)
    .map((v) => ({ v, ...inspectionStatus(v) }))
    .filter((r) => r.status !== "ok")
    .sort((a, b) => {
      const rank = { overdue: 0, soon: 1, unknown: 2 };
      return (
        rank[a.status as keyof typeof rank] -
          rank[b.status as keyof typeof rank] ||
        (a.days ?? 9999) - (b.days ?? 9999)
      );
    });
  const known = rows.filter((r) => r.status !== "unknown"),
    unknown = rows.filter((r) => r.status === "unknown");
  const render = (r: (typeof rows)[number]) => (
    <button
      className={"inspection-alert " + r.status}
      key={r.v.id}
      onClick={() => onEdit(r.v)}
    >
      <strong>
        {r.v.brand} {r.v.model} · {r.v.plate}
      </strong>
      <span>
        {r.validUntil
          ? "Platí do " +
            new Date(r.validUntil + "T12:00:00").toLocaleDateString("cs-CZ")
          : "Platnost neuvedena"}{" "}
        ·{" "}
        {r.days === null
          ? "Doplnit datum"
          : r.days < 0
            ? "Po platnosti"
            : r.days === 0
              ? "Končí dnes"
              : "Zbývá " + r.days + " dní"}
      </span>
    </button>
  );
  return (
    <section className="panel inspection-alerts">
      <div className="panel-heading">
        <div>
          <h2>Platnost STK</h2>
          <p>
            Upozornění podle zadaného data a nastavitelného předstihu. Neznámá
            platnost se neodhaduje.
          </p>
        </div>
      </div>
      <div className="inspection-list">{known.map(render)}</div>
      {!!unknown.length && (
        <details className="record-note">
          <summary>Doplnit platnost STK ({unknown.length} vozidel)</summary>
          <div className="inspection-list">{unknown.map(render)}</div>
        </details>
      )}
      {!rows.length && (
        <p className="record-note">
          U všech aktivních vozidel je STK mimo nastavený předstih upozornění.
        </p>
      )}
    </section>
  );
}
