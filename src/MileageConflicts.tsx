import { TriangleAlert } from "lucide-react";
import { mileageConflictGroups, type Reading, type State } from "./domain";
const fmt = (n: number) => new Intl.NumberFormat("cs-CZ").format(n);
const date = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("cs-CZ");
export function readingLabel(s: State, r: Reading) {
  const f = s.fuels.find((f) => f.id === r.source);
  if (f) return "Tankování " + f.code;
  const service = s.services.find((v) => "service:" + v.id === r.source);
  if (service)
    return (
      "Servis " +
      (service.source ? "MA-" + service.source.id : date(service.date))
    );
  if (r.source.startsWith("ma-odometer:"))
    return "Odečet Moje Autoškola #" + r.source.slice("ma-odometer:".length);
  return r.source.startsWith("initial") ? "Počáteční odečet" : "Ruční odečet";
}
export function MileageConflicts({
  state: s,
  vehicleId,
  search,
  onResolve,
}: {
  state: State;
  vehicleId: string;
  search: string;
  onResolve: (r: Reading, context: string) => void;
}) {
  const groups = mileageConflictGroups(s.readings).filter((g) => {
    const v = s.vehicles.find((v) => v.id === g.vehicleId);
    return (
      v &&
      (vehicleId === "all" || vehicleId === g.vehicleId) &&
      `${v.brand} ${v.model} ${v.plate}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );
  });
  if (!groups.length) return null;
  return (
    <section className="panel mileage-conflicts" aria-label="Rozpory kilometrů">
      <div className="panel-heading">
        <div>
          <h2>
            Rozpory a nejasnosti kilometrů{" "}
            <span className="count">{groups.length}</span>
          </h2>
          <p>
            Porovnání konkrétních záznamů. Neověřené odečty nemění platný stav
            vozidla.
          </p>
        </div>
        <TriangleAlert size={21} />
      </div>
      {groups.map((g) => {
        const v = s.vehicles.find((v) => v.id === g.vehicleId)!;
        const explanations = g.problems.map((p) =>
          p.kind === "same_day"
            ? `Dne ${date(p.left.date)} jsou zapsány hodnoty ${fmt(p.left.km)} km a ${fmt(p.right.km)} km. Rozdíl je ${fmt(p.difference)} km. Chybí čas odečtu, takže jejich pořadí nelze ověřit.`
            : `Starší záznam ze dne ${date(p.left.date)} uvádí ${fmt(p.left.km)} km, ale novější z ${date(p.right.date)} jen ${fmt(p.right.km)} km. Tachometr by klesl o ${fmt(p.difference)} km.`,
        );
        const context =
          explanations.join(" ") ||
          "Původní rozpor již aktuální hodnoty nevysvětlují. Záznam stále čeká na kontrolu správce.";
        return (
          <article className="mileage-case" key={g.id}>
            <header>
              <div>
                <h3>
                  {v.brand} {v.model}
                </h3>
                <small>{v.plate}</small>
              </div>
              <span className="badge soon">
                {!g.problems.length
                  ? "Čeká na potvrzení"
                  : g.problems.some((p) => p.kind === "decrease")
                    ? "Pokles kilometrů"
                    : "Neověřené pořadí odečtů"}
              </span>
            </header>
            <div className="mileage-explanation">
              {explanations.length ? (
                explanations.map((e, i) => <p key={i}>{e}</p>)
              ) : (
                <p>{context}</p>
              )}
              <small>
                {!g.problems.length
                  ? "Ověřte podklady. Záznam čeká na potvrzení správce, přestože aktuální hodnoty již rozpor nevysvětlují."
                  : g.problems.some((p) => p.kind === "decrease")
                    ? "Ověřte datum, stav tachometru nebo případnou doloženou výměnu tachometru. Aplikace sama nerozhoduje, který záznam je chybný."
                    : "Dva různé stavy v jednom dni mohou být správné. Bez časů je neumíme chronologicky potvrdit; nejde samo o sobě o důkaz chybného tankování."}
              </small>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Zdroj záznamu</th>
                    <th>Datum</th>
                    <th>Stav km</th>
                    <th>Ověření</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {g.readings.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{readingLabel(s, r)}</strong>
                      </td>
                      <td>{date(r.date)}</td>
                      <td>
                        <strong>{fmt(r.km)} km</strong>
                      </td>
                      <td>
                        {r.status === "accepted"
                          ? "Přijatý odečet"
                          : "Čeká na kontrolu"}
                      </td>
                      <td>
                        {r.status === "conflict" && (
                          <button
                            className="button secondary"
                            onClick={() => onResolve(r, context)}
                          >
                            Prověřit záznam
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        );
      })}
    </section>
  );
}
