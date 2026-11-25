// Read only: select odometer values and dates, never collect pupils, prices or service data.
import path from "node:path";
import { pathToFileURL } from "node:url";
export async function collectCurrentKm({
  vehicles,
  source = "both",
  dashboard = "../Dashboard",
  profile,
  lookbackDays = 180,
}) {
  const root = path.resolve(dashboard),
    { chromium } = await import(
      pathToFileURL(
        path.join(root, "scraper/node_modules/playwright/index.mjs"),
      ).href
    );
  const context = await chromium.launchPersistentContext(
    profile ?? path.join(root, "scraper/.session-import-20261001b"),
    { channel: "chrome", headless: true },
  );
  const origin = "https://bubu.moje-autoskola.cz";
  await context.route("**/*", (route) => {
    const r = route.request(),
      u = new URL(r.url());
    return u.origin === origin &&
      ["GET", "HEAD"].includes(r.method()) &&
      ![...u.searchParams.keys()].some((k) =>
        /delete|remove|logout|save|uloz|confirm|action|akce|smaz|edit_id/i.test(
          k,
        ),
      ) &&
      (["/admin_ev_jizdy.php", "/admin_tankovani.php", "/admin.php"].includes(
        u.pathname,
      ) ||
        /\.(css|js|png|jpe?g|gif|svg|woff2?)$/i.test(u.pathname))
      ? route.continue()
      : route.abort();
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const localDate = (d) =>
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(d);
    const end = localDate(new Date()),
      start = localDate(new Date(Date.now() - lookbackDays * 86400000)),
      cs = (d) => d.split("-").reverse().join(".");
    const observations = [];
    for (const kind of source === "both" ? ["fuel", "trip"] : [source]) {
      const url = new URL(
        kind === "fuel" ? "/admin_tankovani.php" : "/admin_ev_jizdy.php",
        origin,
      );
      const prefix = kind === "fuel" ? "tank" : "jizda";
      url.searchParams.set(prefix + "_datum_od", cs(start));
      url.searchParams.set(prefix + "_datum_do", cs(end));
      if (kind === "fuel") {
        url.searchParams.set("tank_styl", "tankovani");
        url.searchParams.set("filtr_typ", "-1");
      }
      const visited = new Set(),
        pending = [url.href];
      while (pending.length) {
        const next = pending.shift();
        if (visited.has(next)) continue;
        visited.add(next);
        if (visited.size > 100)
          throw Error("Zdroj je příliš rozsáhlý; import zastaven bez zápisu.");
        const target = new URL(next);
        if (target.origin !== origin || target.pathname !== url.pathname)
          throw Error("Neplatná stránka zdroje.");
        await page.goto(target.href, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        const result = await page.evaluate(
          ({ kind, vehicles }) => {
            if (document.querySelector('input[type="password"]'))
              throw Error(
                "LOGIN_REQUIRED: obnovte místní přihlášení do Moje Autoškola.",
              );
            const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim(),
              key = (s) =>
                clean(s)
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .toLowerCase();
            const needed = kind === "fuel" ? "tachometr" : "tacho konec";
            const table = [...document.querySelectorAll("table")].find((t) =>
              [...t.querySelectorAll("th")].some(
                (h) => key(h.textContent) === needed,
              ),
            );
            if (!table)
              throw Error(
                "LOGIN_REQUIRED nebo změněná tabulka kilometrů ve zdroji.",
              );
            const headers = [...table.rows[0].cells].map((c) =>
                key(c.textContent),
              ),
              kmIndex = headers.indexOf(needed),
              vehicleIndex = headers.indexOf("vozidlo"),
              dateIndex = 0,
              statusIndex = headers.indexOf("stav");
            if (kmIndex < 0 || vehicleIndex < 0)
              throw Error("Zdroj neobsahuje ověřené sloupce tachometru.");
            const options = [
              ...document.querySelectorAll(
                `select[name="${kind === "fuel" ? "tank" : "jizda"}_vozidlo"] option`,
              ),
            ].map((o) => ({ id: o.value, label: clean(o.textContent) }));
            const out = [];
            for (const row of table.rows) {
              if (row.cells[0]?.tagName !== "TD" || row.cells.length <= kmIndex)
                continue;
              const value = clean(row.cells[kmIndex].textContent)
                .replace(/\s/g, "")
                .replace(",", ".");
              if (
                !/^\d+(\.\d+)?$/.test(value) ||
                !Number.isInteger(Number(value))
              )
                continue;
              const label = clean(row.cells[vehicleIndex].textContent),
                option = options.find(
                  (o) => o.label === label && /^\d+$/.test(o.id),
                );
              const known =
                vehicles.find((v) => v.sourceId === option?.id) ||
                vehicles.find(
                  (v) =>
                    v.plate &&
                    label
                      .replace(/\s/g, "")
                      .toUpperCase()
                      .includes(v.plate.replace(/\s/g, "").toUpperCase()),
                );
              const vehicleSourceId = option?.id ?? known?.sourceId;
              if (!known || !vehicleSourceId) continue;
              const rawDate = clean(row.cells[dateIndex].textContent),
                m = rawDate.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
              if (!m) continue;
              const date = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
              const status =
                statusIndex >= 0
                  ? key(row.cells[statusIndex]?.textContent)
                  : "";
              if (/zrus|storno|neprobeh/.test(status)) continue;
              const expected =
                kind === "fuel" ? "/admin_tankovani.php" : "/admin_jizda.php";
              const link = [...row.querySelectorAll("a[href]")]
                .map((a) => new URL(a.href, location.href))
                .find(
                  (u) =>
                    u.pathname === expected && u.searchParams.has("edit_id"),
                );
              const sourceId = link?.searchParams.get("edit_id");
              if (!/^\d+$/.test(sourceId ?? ""))
                throw Error("U odpočtu chybí zdrojové ID; import zastaven.");
              const time = rawDate.match(/(\d{1,2}):(\d{2})/);
              out.push({
                vehicleSourceId,
                plate: known.plate,
                sourceType: kind,
                sourceId,
                date,
                km: Number(value),
                ...(time
                  ? { sourceTime: time[1].padStart(2, "0") + ":" + time[2] }
                  : {}),
              });
            }
            return {
              readings: out,
              pages: [
                ...document.querySelectorAll(
                  ".pagination a[href],a.strankovani[href]",
                ),
              ].map((a) => a.href),
            };
          },
          { kind, vehicles },
        );
        observations.push(...result.readings);
        for (const href of result.pages) {
          const u = new URL(href);
          if (
            u.origin === origin &&
            u.pathname === url.pathname &&
            !visited.has(u.href)
          )
            pending.push(u.href);
        }
      }
    }
    // Keep only the newest dated day per vehicle/source. A known time orders trips;
    // without a time retain differing observations for the server's conflict review.
    const selected = [];
    for (const v of vehicles)
      for (const kind of ["fuel", "trip"]) {
        const rows = observations
          .filter(
            (r) =>
              (r.vehicleSourceId === v.sourceId ||
                r.plate?.replace(/\s/g, "").toUpperCase() ===
                  v.plate?.replace(/\s/g, "").toUpperCase()) &&
              r.sourceType === kind &&
              r.date <= end,
          )
          .sort((a, b) => b.date.localeCompare(a.date));
        if (!rows.length) continue;
        let latest = rows.filter((r) => r.date === rows[0].date);
        if (latest.every((r) => r.sourceTime)) {
          const last = [...latest].sort((a, b) =>
            b.sourceTime.localeCompare(a.sourceTime),
          )[0].sourceTime;
          latest = latest.filter((r) => r.sourceTime === last);
        }
        const seen = new Set();
        for (const row of latest) {
          const key = row.sourceId + ":" + row.km;
          if (!seen.has(key)) {
            seen.add(key);
            selected.push(row);
          }
        }
      }
    return {
      source: "Moje Autoškola",
      capturedAt: new Date().toISOString(),
      readings: selected,
    };
  } finally {
    await context.close();
  }
}
