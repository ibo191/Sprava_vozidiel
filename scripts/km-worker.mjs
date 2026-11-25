import { readFileSync } from "node:fs";
import { collectCurrentKm } from "./fetch-current-km.mjs";
const config = JSON.parse(
  readFileSync(
    process.argv.find((a) => a.startsWith("--config="))?.slice(9) ??
      "data/km-worker.json",
    "utf8",
  ),
);
if (
  !/^https:\/\/mpknrjfyoivikudvcqut\.supabase\.co\/functions\/v1\/fleet-api\/api$/.test(
    config.api,
  )
)
  throw Error("Neočekávaný cíl importéru.");
const post = async (path, body = {}) => {
  const r = await fetch(config.api + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Km-Worker-Token": config.token,
    },
    body: JSON.stringify(body),
  });
  const b = await r.json();
  if (!r.ok) {
    const error = Error(b.error ?? `HTTP ${r.status}`);
    error.status = r.status;
    throw error;
  }
  return b;
};
console.log(
  "Místní importér km běží. Čeká na tlačítko Importovat km v aplikaci. Ukončení Ctrl+C.",
);
while (true) {
  try {
    const { job } = await post("/km-worker/claim");
    if (job) {
      console.log(
        "Načítám pouze km:",
        job.source,
        "vozidel:",
        job.vehicles.length,
      );
      try {
        const snapshot = await collectCurrentKm({
          ...config,
          vehicles: job.vehicles,
          source: job.source,
        });
        await post("/km-worker/complete", {
          id: job.id,
          lease: job.lease,
          snapshot,
        });
        console.log(
          "Import km dokončen, zdrojových odpočtů:",
          snapshot.readings.length,
        );
      } catch (error) {
        const message = String(error.message).includes("LOGIN_REQUIRED")
          ? "LOGIN_REQUIRED: obnovte přihlášení v místním scraperu Moje Autoškola."
          : "Zdroj km se nepodařilo bezpečně načíst. Ověřte přihlášení a dostupnost profilu scraperu.";
        await post("/km-worker/complete", {
          id: job.id,
          lease: job.lease,
          error: message,
        });
        console.error(message);
      }
    }
  } catch (error) {
    console.error("Importér:", error.message);
    if (error.status === 401 || error.status === 403) break;
  }
  if (process.argv.includes("--once")) break;
  await new Promise((r) => setTimeout(r, 15000));
}
