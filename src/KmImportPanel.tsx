import { useState } from "react";
import { cloud, apiBase } from "./cloud";
import type { State } from "./domain";
export function KmImportPanel({
  state: s,
  vehicleId,
  command,
  onError,
}: {
  state: State;
  vehicleId: string;
  command: (action: string, payload: unknown) => Promise<any>;
  onError: (text: string) => void;
}) {
  const [source, setSource] = useState("both"),
    [busy, setBusy] = useState(false);
  const pending = s.kmImports?.find((j) =>
    ["queued", "running"].includes(j.status),
  );
  const online =
    s.kmWorker?.lastSeen &&
    Date.now() - Date.parse(s.kmWorker.lastSeen) < 120000;
  const generate = async () => {
    if (
      s.kmWorker &&
      !window.confirm(
        "Nový klíč odpojí dosavadní importér. Vygenerovat novou konfiguraci pro tento PC?",
      )
    )
      return;
    setBusy(true);
    try {
      const token = btoa(
        String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
      )
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(token),
      );
      const keyHash = Array.from(new Uint8Array(digest))
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      await command("km.worker.pair", { keyHash });
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              { api: apiBase, token, dashboard: "../Dashboard" },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "km-worker.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      onError(
        "Soukromou konfiguraci uložte jako data/km-worker.json a spusťte npm run km:worker na tomto PC.",
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel km-import-panel">
      <div className="panel-heading">
        <div>
          <h2>Aktuální km z Moje Autoškola</h2>
          <p>
            Pouze odpočty km, vozidlo a datum. Tankování, ceny, servisy ani
            údaje žáků se tímto tlačítkem nepřenášejí.
          </p>
          <p>
            {vehicleId === "all"
              ? "Rozsah: všechna aktivní auta a motorky."
              : `Rozsah: ${s.vehicles.find((v) => v.id === vehicleId)?.plate ?? "vybrané vozidlo"}.`}
          </p>
        </div>
      </div>
      <div className="km-import-controls">
        <select
          aria-label="Zdroj aktuálních km"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="both">Tankování i výpis jízd</option>
          <option value="fuel">Pouze tankování</option>
          <option value="trip">Pouze výpis jízd</option>
        </select>
        <button
          className="button primary"
          disabled={busy || !!pending || !s.kmWorker}
          onClick={async () => {
            setBusy(true);
            try {
              await command("km.import.request", {
                requestKey: crypto.randomUUID(),
                vehicleId: vehicleId === "all" ? null : vehicleId,
                source,
              });
              onError(
                "Požadavek na import km vytvořen. Zpracuje jej místní program na PC.",
              );
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Importovat aktuální km
        </button>
        {cloud && (
          <button className="text-button" disabled={busy} onClick={generate}>
            {s.kmWorker
              ? "Nová konfigurace importéru"
              : "Připojit místní importér"}
          </button>
        )}
      </div>
      {pending && (
        <button
          className="text-button"
          onClick={async () => {
            try {
              await command("km.import.cancel", { id: pending.id });
              onError("Požadavek importu zrušen.");
            } catch (e) {
              onError((e as Error).message);
            }
          }}
        >
          Zrušit požadavek importu
        </button>
      )}
      <p className="record-note">
        {s.kmWorker
          ? online
            ? "Místní importér je připojený."
            : "Místní importér je offline nebo se ještě neozval. Požadavek počká na zapnutý PC a spuštěný program."
          : "Importér zatím není připojený."}{" "}
        {pending?.status === "queued"
          ? "Import čeká na místní program."
          : pending?.status === "running"
            ? "Načítání km právě probíhá."
            : ""}
      </p>
      {[...(s.kmImports ?? [])]
        .reverse()
        .slice(0, 3)
        .map((j) => (
          <div className="km-import-result" key={j.id}>
            <strong>
              {new Date(j.requestedAt).toLocaleString("cs-CZ")} ·{" "}
              {j.status === "done"
                ? "Dokončeno"
                : j.status === "error"
                  ? "Chyba"
                  : j.status === "running"
                    ? "Probíhá"
                    : "Čeká na PC"}
            </strong>
            {j.error && <p className="danger-text">{j.error}</p>}
            {j.result && (
              <p>
                Přidáno {j.result.added} odpočtů · {j.result.skipped} již
                evidovaných / vyřazených · {j.result.unmatched} mimo výběr.
                Případné odchylky a poznámky ke zdroji najdete v Závady a
                hlášení.
              </p>
            )}
            {!!j.result?.missingVehicles && (
              <p>
                Pro {j.result.missingVehicles} vozidel zdroj nenabídl použitelný
                datovaný odpočet; jejich km nebyly odhadnuty.
              </p>
            )}
          </div>
        ))}
    </section>
  );
}
