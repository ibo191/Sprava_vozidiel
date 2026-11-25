import { readingLabel } from "./MileageConflicts";
import type { State, Reading } from "./domain";
export function MileageReadings({
  state: s,
  vehicleId,
  search,
  onDelete,
  onRestore,
  onDeleteUndated,
}: {
  state: State;
  vehicleId: string;
  search: string;
  onDelete: (r: Reading) => void;
  onRestore: (id: string) => Promise<void>;
  onDeleteUndated: (id: string) => void;
}) {
  const match = (r: Reading) => {
    const v = s.vehicles.find((v) => v.id === r.vehicleId);
    return (
      v &&
      (vehicleId === "all" || r.vehicleId === vehicleId) &&
      `${v.brand} ${v.model} ${v.plate}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  };
  const rows = s.readings
      .filter(match)
      .sort((a, b) => b.date.localeCompare(a.date)),
    deleted = (s.deletedReadings ?? []).filter((x) => match(x.reading));
  const [limit, setLimit] = useState(30);
  return (
    <section className="panel mileage-readings">
      <div className="panel-heading">
        <div>
          <h2>Evidence všech odpočtů km</h2>
          <p>
            Smazání vyřadí pouze odpočet. Tankování, servis a historie změn
            zůstávají zachované.
          </p>
        </div>
      </div>
      {[...(s.kmImports ?? [])]
        .reverse()
        .filter((j) => j.result?.warnings.length)
        .slice(0, 3)
        .map((j) => (
          <div className="record-note" key={j.id}>
            <strong>
              Poznámky k importu{" "}
              {new Date(j.requestedAt).toLocaleString("cs-CZ")}
            </strong>
            {j.result!.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        ))}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Vozidlo / zdroj</th>
              <th>Datum</th>
              <th>Km</th>
              <th>Stav</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const v = s.vehicles.find((v) => v.id === r.vehicleId)!;
              return (
                <tr key={r.id}>
                  <td>
                    <strong>
                      {v.brand} {v.model} · {v.plate}
                    </strong>
                    <small>{readingLabel(s, r)}</small>
                  </td>
                  <td>{r.date}</td>
                  <td>{r.km.toLocaleString("cs-CZ")}</td>
                  <td>
                    {r.status === "accepted"
                      ? "Přijatý odpočet"
                      : "Ke kontrole"}
                  </td>
                  <td>
                    <button className="text-button" onClick={() => onDelete(r)}>
                      Smazat odpočet
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button
          className="button secondary"
          onClick={() => setLimit((n) => n + 50)}
        >
          Zobrazit další
        </button>
      )}
      {!rows.length && (
        <p className="record-note">Nejsou odpovídající odpočty.</p>
      )}
      {!!deleted.length && (
        <details className="record-note">
          <summary>Smazané odpočty ({deleted.length})</summary>
          {deleted.map((x) => (
            <div className="proposal" key={x.reading.id}>
              <div>
                <strong>
                  {readingLabel(s, x.reading)} · {x.reading.date} ·{" "}
                  {x.reading.km.toLocaleString("cs-CZ")} km
                </strong>
                <p>
                  {x.reason} · smazáno{" "}
                  {new Date(x.deletedAt).toLocaleString("cs-CZ")}
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => onRestore(x.reading.id)}
              >
                Obnovit odpočet
              </button>
            </div>
          ))}
        </details>
      )}
      <details className="record-note">
        <summary>Nedatované tachometry ze zdroje</summary>
        {s.vehicles
          .filter(
            (v) =>
              v.source?.undatedKm != null &&
              (vehicleId === "all" || vehicleId === v.id) &&
              `${v.brand} ${v.model} ${v.plate}`
                .toLowerCase()
                .includes(search.toLowerCase()),
          )
          .map((v) => (
            <div className="proposal" key={v.id}>
              <div>
                <strong>
                  {v.brand} {v.model} · {v.plate}
                </strong>
                <p>
                  {v.source!.undatedKm!.toLocaleString("cs-CZ")} km · datum není
                  známé, nepočítá se do platného stavu
                </p>
              </div>
              <button
                className="text-button"
                onClick={() => onDeleteUndated(v.id)}
              >
                Smazat nedatovaný stav
              </button>
            </div>
          ))}
      </details>
    </section>
  );
}
import { useState } from "react";
