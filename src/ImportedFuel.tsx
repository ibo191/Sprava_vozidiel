import type { State } from "./domain";
const fmt = (n: number) =>
  new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(n);
export function ImportedFuel({
  state: s,
  vehicleId,
  search,
}: {
  state: State;
  vehicleId: string;
  search: string;
}) {
  const rows = s.fuels
    .filter((f) => {
      const v = s.vehicles.find((v) => v.id === f.vehicleId);
      return (
        v &&
        (vehicleId === "all" || f.vehicleId === vehicleId) &&
        `${v.brand} ${v.model} ${v.plate}`
          .toLowerCase()
          .includes(search.toLowerCase())
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Tankování z Moje Autoškola</h2>
          <p>
            Evidence pouze z importu. Nezrovnalosti kilometrů najdete v Závady a
            hlášení.
          </p>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Datum / zdroj</th>
              <th>Vozidlo</th>
              <th>Km</th>
              <th>Litry</th>
              <th>Evidovaná cena</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const v = s.vehicles.find((v) => v.id === f.vehicleId)!;
              return (
                <tr key={f.id}>
                  <td>
                    <strong>
                      {new Date(f.date + "T12:00:00").toLocaleDateString(
                        "cs-CZ",
                      )}
                    </strong>
                    <small>{f.code}</small>
                  </td>
                  <td>
                    <strong>
                      {v.brand} {v.model}
                    </strong>
                    <small>{v.plate}</small>
                  </td>
                  <td>
                    {fmt(f.km)}
                    {f.readingExcluded && (
                      <small>Odpočet vyřazen z výpočtů</small>
                    )}
                  </td>
                  <td>
                    {fmt(f.liters)} l
                    <small>{f.full ? "Plná nádrž" : "Částečná nádrž"}</small>
                  </td>
                  <td>
                    {f.amount === null
                      ? "Cena neuvedena"
                      : fmt(f.amount) + " Kč"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">Ve výběru nejsou importovaná tankování.</div>
        )}
      </div>
    </section>
  );
}
