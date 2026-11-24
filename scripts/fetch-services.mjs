// Read-only extension of the Dashboard scraper; never submits source forms.
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
const endpoint = new URL(
  config.pages.find((p) => p.key === "servis_vozidel").url,
);
if (
  endpoint.origin !== "https://bubu.moje-autoskola.cz" ||
  endpoint.pathname !== "/admin_vozidla_servis.php"
)
  throw new Error("Unexpected service endpoint.");
const { chromium } = await import(
  pathToFileURL(
    path.join(dashboard, "scraper/node_modules/playwright/index.mjs"),
  ).href
);
const context = await chromium.launchPersistentContext(
  arg("--profile", path.join(dashboard, "scraper/.session-import-20261001b")),
  { channel: "chrome", headless: true },
);
await context.route("**/*", (route) =>
  new URL(route.request().url()).origin === endpoint.origin &&
  ["GET", "HEAD"].includes(route.request().method())
    ? route.continue()
    : route.abort(),
);
const page = context.pages()[0] || (await context.newPage());
try {
  for (const [k, v] of Object.entries({
    filtr_datum_od: "1.1.2000",
    filtr_datum_do: new Intl.DateTimeFormat("cs-CZ", {
      timeZone: "Europe/Prague",
    })
      .format(new Date())
      .replaceAll(" ", ""),
    filtr_vozidlo: "",
    filtr_typ_servisu: "",
    filtr_firma: "",
  }))
    endpoint.searchParams.set(k, v);
  await page.goto(endpoint.href, { waitUntil: "domcontentloaded" });
  const table = await page.evaluate(() => {
    const clean = (v) => (v || "").replace(/\s+/g, " ").trim();
    const table = [...document.querySelectorAll("table")].find((t) =>
      [...t.querySelectorAll("th")].some(
        (th) => clean(th.textContent) === "Servisní úkon",
      ),
    );
    if (!table)
      throw new Error("LOGIN_REQUIRED nebo změněná struktura servisů.");
    return {
      headers: [...table.querySelector("tr").children].map((c) =>
        clean(c.textContent),
      ),
      rows: [...table.querySelectorAll("tr")]
        .filter((r) => r.querySelector("td") && r.children.length >= 6)
        .map((r) => ({
          cells: [...r.children].map((c) => clean(c.textContent)),
          links: [...r.querySelectorAll("a[href]")].map((a) =>
            a.getAttribute("href"),
          ),
        })),
      pagination: [...document.querySelectorAll(".pagination a")].map((a) =>
        a.getAttribute("href"),
      ),
    };
  });
  await fs.mkdir("data/imports", { recursive: true });
  await fs.writeFile(
    "data/imports/services-source-table.json",
    JSON.stringify(
      { capturedAt: new Date().toISOString(), url: endpoint.href, ...table },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      headers: table.headers,
      count: table.rows.length,
      pagination: table.pagination,
      sample: table.rows.slice(0, 2),
    }),
  );
  if (table.pagination.length)
    throw new Error("Zdroj je stránkovaný. Import zastaven.");
  const services = [];
  for (const row of table.rows) {
    const link = row.links.find((h) =>
      h.startsWith("/admin_vozidla_servis_edit.php?edit_id="),
    );
    if (!link) throw new Error("Chybí identita servisního záznamu.");
    const url = new URL(link, endpoint.origin);
    if (
      url.origin !== endpoint.origin ||
      url.pathname !== "/admin_vozidla_servis_edit.php" ||
      !/^\d+$/.test(url.searchParams.get("edit_id") || "")
    )
      throw new Error("Neplatný odkaz na detail.");
    const response = await context.request.get(url.href);
    if (!response.ok() || new URL(response.url()).pathname !== url.pathname)
      throw new Error("Detail není dostupný.");
    const fields = await page.evaluate(
      (html) => {
        const d = new DOMParser().parseFromString(html, "text/html");
        const fields = {};
        for (const e of d.querySelectorAll("input,select,textarea"))
          if (
            e.name.startsWith("form_data[") &&
            !["password", "file"].includes(e.type)
          ) {
            fields[e.name.slice(10).replace(/\]$/, "")] = e.value;
          }
        return fields;
      },
      await response.text(),
    );
    services.push({
      sourceId: url.searchParams.get("edit_id"),
      fields,
      cells: row.cells,
    });
  }
  const snapshot = JSON.parse(
    await fs.readFile(
      arg("--base", "data/imports/moje-autoskola-fleet.json"),
      "utf8",
    ),
  );
  snapshot.services = services;
  snapshot.servicesCapturedAt = new Date().toISOString();
  await fs.writeFile(
    "data/imports/moje-autoskola-with-services.json",
    JSON.stringify(snapshot, null, 2),
  );
  console.log(
    JSON.stringify({
      services: services.length,
      firstFields: services[0]?.fields,
      output: "data/imports/moje-autoskola-with-services.json",
    }),
  );
} finally {
  await context.close();
}
