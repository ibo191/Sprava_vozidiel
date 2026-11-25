import { canonicalEntry, operationLabels, itemOperation } from "./catalog";
import {
  inspectionStatus,
  type Vehicle,
  type State,
  type Service,
} from "./domain";
import { cloud, openPrivate } from "./cloud";
const date = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("cs-CZ");
export function VehicleHistory({
  vehicle: v,
  state: s,
  onEdit,
  onInspection,
  onClose,
}: {
  vehicle: Vehicle;
  state: State;
  onEdit: (r: Service) => void;
  onInspection: (v: Vehicle) => void;
  onClose: () => void;
}) {
  const rows = s.services
    .filter((r) => r.vehicleId === v.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const stk = inspectionStatus(v);
  return (
    <section
      className="panel vehicle-history"
      aria-label="Servisní historie vozidla"
    >
      <div className="panel-heading">
        <div>
          <h2>
            {v.brand} {v.model} · {v.plate}
          </h2>
          <p>Servisní historie vozidla · co a kdy bylo provedeno</p>
        </div>
        <button className="text-button" onClick={onClose}>
          Zavřít detail
        </button>
      </div>
      <div className={"vehicle-inspection " + stk.status}>
        <div>
          <strong>
            Platnost STK: {stk.validUntil ? date(stk.validUntil) : "Neuvedena"}
          </strong>
          <p>
            {stk.days === null
              ? "Datum doplňte podle dokladu; neodhadujeme jej."
              : stk.days < 0
                ? `STK po platnosti ${-stk.days} dní.`
                : stk.days === 0
                  ? "Platnost končí dnes."
                  : `Zbývá ${stk.days} dní.`}{" "}
            Upozornit {v.stkLeadDays ?? 30} dní předem.
          </p>
        </div>
        <button className="button secondary" onClick={() => onInspection(v)}>
          Nastavit STK
        </button>
      </div>
      <div className="panel-heading">
        <h3>Provedené servisy ({rows.length})</h3>
      </div>
      {rows.map((r) => {
        const total =
          r.total ??
          (r.items.every((i) => i.price !== null)
            ? r.items.reduce((a, i) => a + i.price!, 0)
            : null);
        return (
          <article className="vehicle-service-entry" key={r.id}>
            <header>
              <div>
                <strong>{date(r.date)}</strong>
                <small>
                  {r.km === null
                    ? "Km neznámé"
                    : r.km.toLocaleString("cs-CZ") + " km"}
                  {r.readingExcluded ? " · odpočet vyřazen" : ""} ·{" "}
                  {r.workshop || "Servis neuveden"}
                </small>
              </div>
              <span>
                {total === null
                  ? "Cena neúplná"
                  : total.toLocaleString("cs-CZ") + " Kč"}
              </span>
            </header>
            <ul>
              {r.items.map((i, n) => (
                <li key={n}>
                  <strong>{canonicalEntry(s, i.kind, i.name).name}</strong> ·{" "}
                  {operationLabels[itemOperation(i)]}
                  {i.originalName && (
                    <small>Původní název / varianta: {i.originalName}</small>
                  )}
                </li>
              ))}
            </ul>
            {r.note && <p>{r.note}</p>}
            {r.source && (
              <small>
                Import Moje Autoškola · servis #{r.source.id}
                {r.editedAt ? " · opraveno v této aplikaci" : ""}
              </small>
            )}
            <div className="row-actions">
              <button onClick={() => onEdit(r)}>Upravit servis</button>
              {r.attachmentId && (
                <a
                  href={"/api/attachments/" + r.attachmentId}
                  onClick={
                    cloud
                      ? (e) => {
                          e.preventDefault();
                          openPrivate("/attachments/" + r.attachmentId).catch(
                            (err) => alert(err.message),
                          );
                        }
                      : undefined
                  }
                >
                  Doklad
                </a>
              )}
            </div>
          </article>
        );
      })}
      {!rows.length && (
        <p className="record-note">
          Pro toto vozidlo nejsou evidované servisní záznamy.
        </p>
      )}
    </section>
  );
}
