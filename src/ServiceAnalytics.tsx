import { useState } from "react";
import { today, replacementIntervals, type State } from "./domain";
const money = (n: number) =>
  new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(n) +
  " Kč";
export function ServiceAnalytics({
  state: s,
  vehicleId,
  search,
}: {
  state: State;
  vehicleId: string;
  search: string;
}) {
  const [from, setFrom] = useState(today().slice(0, 4) + "-01-01"),
    [to, setTo] = useState(today());
  const rows = s.vehicles
    .filter(
      (v) =>
        (vehicleId === "all" || v.id === vehicleId) &&
        `${v.brand} ${v.model} ${v.plate}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .map((v) => {
      const records = s.services.filter(
        (r) => r.vehicleId === v.id && r.date >= from && r.date <= to,
      );
      const costs = records.map(
        (r) =>
          r.total ??
          (r.items.every((i) => i.price !== null)
            ? r.items.reduce((n, i) => n + i.price!, 0)
            : null),
      );
      return {
        v,
        records,
        cost: costs.reduce<number>((n, c) => n + (c ?? 0), 0),
        incomplete: costs.some((c) => c === null),
      };
    });
  const count = rows.reduce((n, r) => n + r.records.length, 0),
    incomplete = rows.some((r) => r.incomplete);
  return (
    <>
      <div className="period-filter">
        <label>
          Od
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Do
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      {from > to && (
        <div className="error-banner">
          Začátek období musí být před jeho koncem.
        </div>
      )}
      <section className="panel service-summary">
        <div>
          <small>Servisní záznamy v období</small>
          <strong>{count}</strong>
        </div>
        <div>
          <small>
            Evidované servisní náklady {incomplete ? "(neúplné)" : ""}
          </small>
          <strong>
            {count
              ? money(rows.reduce((n, r) => n + r.cost, 0))
              : "Bez záznamů"}
          </strong>
        </div>
        {incomplete && (
          <p>Některé ceny chybí; započteny jsou jen známé částky.</p>
        )}
      </section>
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vozidlo</th>
                <th>Počet servisů</th>
                <th>Náklady v období</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.v.id}>
                  <td>
                    <strong>
                      {r.v.brand} {r.v.model}
                    </strong>
                    <small>{r.v.plate}</small>
                  </td>
                  <td>{r.records.length}</td>
                  <td>
                    {r.records.length ? money(r.cost) : "Bez záznamů"}
                    {r.incomplete && (
                      <small className="danger-text">Neúplné ceny</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="record-note">
        Počty a intervaly potvrzených výměn podle vozidla najdete v části Díly a
        úkony. Historické zásahy bez potvrzené výměny se do intervalu
        neodhadují.
      </p>
    </>
  );
}
