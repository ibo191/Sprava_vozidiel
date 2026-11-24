// Read-only collector reusing Dashboard's existing scraper installation and profile.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const arg = (name, fallback) =>
  process.argv.find((x) => x.startsWith(name + "="))?.slice(name.length + 1) ||
  fallback;
const dashboard = path.resolve(arg("--dashboard", "../Dashboard"));
const config = JSON.parse(
  await fs.readFile(path.join(dashboard, "scraper/config.json"), "utf8"),
);
const origin = new URL(config.pages.find((p) => p.key === "tankovani").url)
  .origin;
if (origin !== "https://bubu.moje-autoskola.cz")
  throw new Error("Unexpected source host.");
const from = arg("--from", "1.1.2000"),
  to = arg(
    "--to",
    new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague" })
      .format(new Date())
      .replaceAll(" ", ""),
  );
const profile = arg(
  "--profile",
  path.join(dashboard, "scraper/.session-import-20261001b"),
);
const { chromium } = await import(
  pathToFileURL(
    path.join(dashboard, "scraper/node_modules/playwright/index.mjs"),
  ).href
);
const context = await chromium.launchPersistentContext(profile, {
  channel: "chrome",
  headless: true,
  viewport: { width: 1440, height: 1000 },
});
await context.route("**/*", (route) => {
  const req = route.request(),
    u = new URL(req.url());
  return u.origin === origin && ["GET", "HEAD"].includes(req.method())
    ? route.continue()
    : route.abort();
});
const page = context.pages()[0] || (await context.newPage());
await fs.mkdir("data/imports", { recursive: true });
const captureTable = () =>
  page.evaluate(() => {
    const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
    const table = [...document.querySelectorAll("table")].find((t) =>
      t.querySelector("th")?.textContent.includes("Datum tankování"),
    );
    if (!table)
      throw new Error(
        "Tankování: chybí tabulka; přihlášení nebo struktura se změnily.",
      );
    return {
      headers: [...table.querySelector("tr").children].map((c) =>
        clean(c.textContent),
      ),
      rows: [...table.querySelectorAll("tr")]
        .slice(1)
        .filter((r) => r.querySelector("td"))
        .map((r) => ({
          cells: [...r.children].map((c) => clean(c.textContent)),
          sourceId: new URL(
            r.querySelector('a[href*="edit_id="]')?.getAttribute("href") || "?",
            location.href,
          ).searchParams.get("edit_id"),
        })),
      pagination: [...document.querySelectorAll(".pagination a")].map((a) =>
        a.getAttribute("href"),
      ),
    };
  });
const listUrl = (style) => {
  const u = new URL("/admin_tankovani.php", origin);
  for (const [k, v] of Object.entries({
    filtr_typ: "-1",
    tank_datum_od: from,
    tank_datum_do: to,
    tank_ucitel: "",
    tank_vozidlo: "",
    tank_styl: style,
  }))
    u.searchParams.set(k, v);
  return u.href;
};
const getFields = async (url, prefix) => {
  const u = new URL(url);
  if (
    u.origin !== origin ||
    !["/admin_tankovani.php", "/admin_vozidlo.php"].includes(u.pathname) ||
    !u.searchParams.has("edit_id")
  )
    throw new Error("Read allowlist rejected URL.");
  const response = await context.request.get(u.href, { timeout: 30000 });
  if (!response.ok() || new URL(response.url()).pathname !== u.pathname)
    throw new Error("Zdroj odmítl detail / přihlášení vypršelo.");
  const html = await response.text();
  return page.evaluate(
    ({ html, prefix }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (doc.querySelector('input[type="password"]'))
        throw new Error("Přihlášení vypršelo.");
      const fields = {};
      for (const el of doc.querySelectorAll("input,select,textarea")) {
        if (!el.name.startsWith("form_data[" + prefix)) continue;
        const key = el.name.slice(10).replace(/\]\[\]$|\]$/g, "");
        if (el.type === "checkbox") {
          if (el.checked)
            fields[key] = fields[key]
              ? [].concat(fields[key], el.value)
              : [el.value];
          else if (!(key in fields)) fields[key] = [];
        } else fields[key] = el.value;
      }
      return fields;
    },
    { html, prefix },
  );
};
try {
  await page.goto(new URL("/admin.php", origin).href, {
    waitUntil: "domcontentloaded",
  });
  if (
    !(await page.locator("#tabulka_vozidla").count()) ||
    !page.url().includes("/admin.php")
  )
    throw new Error("LOGIN_REQUIRED: přihlaste se ručně přes původní scraper.");
  const activeIds = await page
    .locator('#tabulka_vozidla a[href*="admin_vozidlo.php?edit_id="]')
    .evaluateAll((nodes) => [
      ...new Set(nodes.map((a) => new URL(a.href).searchParams.get("edit_id"))),
    ]);
  await page.goto(new URL("/admin.php?filtr_smazane=1", origin).href, {
    waitUntil: "domcontentloaded",
  });
  const vehicles = await page.evaluate(() => {
    let group = "";
    const rows = [];
    for (const row of document.querySelectorAll("#tabulka_vozidla tr")) {
      const cells = [...row.children].map((c) =>
        (c.textContent || "").replace(/\s+/g, " ").trim(),
      );
      const link = row.querySelector('a[href*="admin_vozidlo.php?edit_id="]');
      if (!link) {
        if (cells.length === 1) group = cells[0];
        continue;
      }
      rows.push({
        sourceId: new URL(link.href).searchParams.get("edit_id"),
        label: cells[0],
        plate: cells[1],
        year: cells[2],
        listedKm: cells[3],
        group,
      });
    }
    return rows;
  });
  for (const v of vehicles) {
    v.active = activeIds.includes(v.sourceId);
    v.fields = await getFields(
      new URL("/admin_vozidlo.php?edit_id=" + v.sourceId, origin).href,
      "vozidlo_",
    );
  }
  console.log("Vozidla:", vehicles.length, "aktivních:", activeIds.length);
  await page.goto(listUrl("tankovani"), { waitUntil: "domcontentloaded" });
  const fuelTable = await captureTable();
  if (fuelTable.pagination.length)
    throw new Error("Zdroj je stránkovaný: import zastaven.");
  const fuels = [];
  for (const row of fuelTable.rows) {
    if (!row.sourceId) throw new Error("Tankování bez zdrojového ID.");
    const fields = await getFields(
      new URL("/admin_tankovani.php?edit_id=" + row.sourceId, origin).href,
      "tank_",
    );
    fuels.push({ sourceId: row.sourceId, fields, teacherName: row.cells[7] });
    if (fuels.length % 25 === 0)
      console.log("Tankování:", fuels.length, "/", fuelTable.rows.length);
  }
  await page.goto(listUrl("stavy_km"), { waitUntil: "domcontentloaded" });
  const readingTable = await captureTable();
  if (readingTable.pagination.length)
    throw new Error("Stavy km jsou stránkované: import zastaven.");
  const vehicleOptions = await page
    .locator('select[name="tank_vozidlo"] option')
    .evaluateAll((opts) =>
      opts
        .map((o) => ({ sourceId: o.value, label: o.textContent.trim() }))
        .filter((o) => o.sourceId),
    );
  const snapshot = {
    version: 1,
    source: "Moje Autoškola",
    origin,
    capturedAt: new Date().toISOString(),
    period: { from, to },
    vehicles,
    vehicleOptions,
    fuels,
    readings: { headers: readingTable.headers, rows: readingTable.rows },
  };
  const output = arg("--out", "data/imports/moje-autoskola-fleet.json");
  await fs.writeFile(output, JSON.stringify(snapshot, null, 2));
  console.log(
    JSON.stringify({
      output,
      vehicles: vehicles.length,
      fuels: fuels.length,
      readingRows: readingTable.rows.length,
      readingHeaders: readingTable.headers,
    }),
  );
} finally {
  await context.close();
}
