import { useState } from "react";
import {
  catalogFor,
  canonicalEntry,
  catalogUsage,
  itemOperation,
  operationLabels,
} from "./catalog";
import type { State } from "./domain";
const date = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("cs-CZ");
export function ServiceCatalog({
  state: s,
  vehicleId,
  search,
}: {
  state: State;
  vehicleId: string;
  search: string;
}) {
  const [kind, setKind] = useState("all");
  const [unused, setUnused] = useState(false);
  const entries = catalogFor(s).filter(
    (e) =>
      (kind === "all" || e.kind === kind) &&
      [e.name, ...e.aliases]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (unused ||
        catalogUsage(s, e.id, vehicleId === "all" ? undefined : vehicleId)
          .length > 0),
  );
  return (
    <section className="panel">
      <div className="panel-heading catalog-heading">
        <div>
          <h2>Katalog dílů a úkonů</h2>
          <p>
            Sjednocené názvy pro výběr při servisu. Původní označení a varianty
            zůstávají v historii.
          </p>
        </div>
        <select
          aria-label="Typ katalogu"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">Díly i úkony</option>
          <option value="part">Díly / materiál</option>
          <option value="action">Úkony</option>
        </select>
      </div>
      <label className="catalog-unused">
        <input
          type="checkbox"
          checked={unused}
          onChange={(e) => setUnused(e.target.checked)}
        />{" "}
        Zobrazit i nepoužité položky katalogu
      </label>
      <p className="record-note">
        Počet výměn znamená počet různých servisů s potvrzenou výměnou, nikoliv
        počet kusů. Podle potvrzení správce jsou historické fyzické díly
        evidovány jako výměny. Opravy, kontroly a doplnění kapalin se odlišují.
        Neurčený zásah doplníte přes Upravit servis.
      </p>
      {entries.map((entry) => {
        const usage = catalogUsage(
          s,
          entry.id,
          vehicleId === "all" ? undefined : vehicleId,
        );
        const replacements = usage.filter((x) =>
          x.items.some((i) => itemOperation(i) === "replacement"),
        );
        const unknown = usage.filter((x) =>
          x.items.some((i) => itemOperation(i) === "unspecified"),
        );
        const byVehicle = [...new Set(usage.map((x) => x.service.vehicleId))];
        return (
          <details key={entry.id} className="catalog-record">
            <summary>
              <strong>{entry.name}</strong>
              <span>
                {entry.kind === "part" ? "Díl / materiál" : "Úkon"} ·{" "}
                {usage.length} servisů · {replacements.length} potvrzených výměn
                {unknown.length ? ` · ${unknown.length} neurčených` : ""}
              </span>
            </summary>
            {!!entry.aliases.length && (
              <p>Stejná položka: {entry.aliases.join(" · ")}</p>
            )}
            {byVehicle.map((vid) => {
              const v = s.vehicles.find((x) => x.id === vid)!;
              const events = usage
                .filter((x) => x.service.vehicleId === vid)
                .sort((a, b) => a.service.date.localeCompare(b.service.date));
              const changed = events.filter((x) =>
                x.items.some((i) => itemOperation(i) === "replacement"),
              );
              return (
                <div key={vid} className="catalog-vehicle">
                  <h3>
                    {v.brand} {v.model} · {v.plate}
                  </h3>
                  <p>
                    {changed.length} potvrzených výměn / {events.length}{" "}
                    servisních výskytů
                  </p>
                  {changed.length >= 2 ? (
                    <p>
                      Intervaly výměn:{" "}
                      {changed
                        .slice(1)
                        .map((x, i) => {
                          const prev = changed[i].service,
                            cur = x.service;
                          const days = Math.round(
                            (Date.parse(cur.date) - Date.parse(prev.date)) /
                              86400000,
                          );
                          const km =
                            cur.km !== null &&
                            prev.km !== null &&
                            !cur.readingExcluded &&
                            !prev.readingExcluded &&
                            cur.km >= prev.km
                              ? cur.km - prev.km
                              : null;
                          return `${date(prev.date)} → ${date(cur.date)}: ${days} dní / ${km === null ? "km neznámé" : km.toLocaleString("cs-CZ") + " km"}`;
                        })
                        .join("; ")}
                    </p>
                  ) : (
                    <p className="muted">
                      Pro interval výměn chybí alespoň dvě potvrzené výměny.
                    </p>
                  )}
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th>Km servisu</th>
                          <th>Zásah</th>
                          <th>Původní název / varianta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((x) => (
                          <tr key={x.service.id}>
                            <td>{date(x.service.date)}</td>
                            <td>
                              {x.service.readingExcluded
                                ? "Odpočet vyřazen"
                                : (x.service.km ?? "Neznámé")}
                            </td>
                            <td>
                              {[
                                ...new Set(
                                  x.items.map(
                                    (i) => operationLabels[itemOperation(i)],
                                  ),
                                ),
                              ].join(", ")}
                            </td>
                            <td>
                              {x.items
                                .map((i) => i.originalName ?? i.name)
                                .join(" · ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            {!usage.length && (
              <p className="muted">
                Pro vybrané vozidlo nejsou servisní záznamy.
              </p>
            )}
          </details>
        );
      })}
      {!entries.length && <p>V katalogu není odpovídající položka.</p>}
    </section>
  );
}
