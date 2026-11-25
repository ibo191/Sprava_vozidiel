// Full workflow in SQLite memory: never touches the active imported database.
import express from "express";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { today } from "../src/domain.ts";
const store = new Store(":memory:"),
  app = createApp(store);
const fixture = store.load();
fixture.services[0].source = {
  system: "moje-autoskola",
  id: "500",
  capturedAt: new Date().toISOString(),
};
fixture.services[0].date = today();
fixture.issues[0].date = today();
fixture.services[0].km = 148300;
fixture.readings.push({
  id: "service-fixture",
  vehicleId: "v1",
  source: "service:s1",
  date: today(),
  km: 148300,
  status: "accepted",
  owner: "admin",
});
store.save(fixture);
app.use(express.static("dist"));
app.get("/{*path}", (_req, res) =>
  res.sendFile(fileURLToPath(new URL("../dist/index.html", import.meta.url))),
);
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = "http://127.0.0.1:" + server.address().port,
  browser = await chromium.launch({ channel: "msedge", headless: true });
const route = (page) =>
  page.route(base + "/api/**", (r) =>
    r.continue({
      headers: { ...r.request().headers(), origin: "http://127.0.0.1:5173" },
    }),
  );
try {
  const admin = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    }),
    errors = [];
  admin.on("pageerror", (e) => errors.push(e.message));
  admin.setDefaultTimeout(15000);
  await route(admin);
  await admin.goto(base);
  assert.equal(
    await admin.getByRole("button", { name: "Učitel", exact: true }).count(),
    0,
  );
  await admin
    .getByRole("button", { name: "Přihlásit se", exact: true })
    .click();
  await admin.getByRole("heading", { name: "Přehled flotily" }).waitFor();
  await admin
    .locator("nav")
    .getByRole("button", { name: "Vozidla", exact: true })
    .click();
  await admin
    .locator(".vehicle-card")
    .filter({
      has: admin.getByRole("heading", { name: "Škoda Octavia", exact: true }),
    })
    .click();
  await admin
    .getByRole("region", { name: "Servisní historie vozidla", exact: true })
    .waitFor();
  assert.equal(
    await admin.evaluate(
      () =>
        document
          .querySelector(".vehicle-history")
          .compareDocumentPosition(
            document.querySelector(".vehicle-category"),
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ),
    4,
  );
  await admin
    .getByRole("button", { name: "Nastavit STK", exact: true })
    .click();
  const stkExpiry = new Date(Date.parse(today()) + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  await admin.getByLabel("STK platná do", { exact: false }).fill(stkExpiry);
  await admin.getByLabel("Upozornit předem (dny)", { exact: false }).fill("45");
  await admin.getByRole("button", { name: "Uložit", exact: true }).click();
  await admin.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(store.load().vehicles[0].stkValidUntil, stkExpiry);
  await admin.screenshot({
    path: "data/vehicle-history-stk.png",
    fullPage: false,
  });
  await admin.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await admin.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await admin.screenshot({
    path: "data/vehicle-history-stk-mobile.png",
    fullPage: false,
  });
  await admin.setViewportSize({ width: 1440, height: 1050 });
  await admin
    .getByRole("button", { name: "Zavřít detail", exact: true })
    .click();
  assert.equal(
    await admin
      .getByRole("button", { name: "Nové tankování", exact: true })
      .count(),
    0,
  );
  await admin
    .locator("nav")
    .getByRole("button", { name: "Tankování", exact: true })
    .click();
  assert.equal(await admin.locator("table tbody tr").count(), 4);
  assert.equal(await admin.locator(".row-actions").count(), 0);
  await admin
    .locator("nav")
    .getByRole("button", { name: "Servisní náklady", exact: true })
    .click();
  assert.equal(
    await admin.getByText("Průměrná cena paliva", { exact: false }).count(),
    0,
  );
  await admin
    .locator("nav")
    .getByRole("button", { name: "Servisní historie", exact: true })
    .click();
  await admin
    .getByRole("button", { name: "Upravit servis", exact: true })
    .click();
  await admin
    .getByRole("heading", { name: "Upravit servisní záznam", exact: true })
    .waitFor();
  await admin.getByLabel("Celková cena", { exact: false }).fill("4500");
  await admin.screenshot({
    path: "data/maintenance-service-editor.png",
    fullPage: false,
  });
  await admin.getByRole("button", { name: "Uložit", exact: true }).click();
  await admin.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(store.load().services.length, 1);
  assert.equal(store.load().services[0].total, 4500);
  assert.equal(store.load().services[0].source.id, "500");
  assert.ok(
    (await admin.locator(".service-record").innerText()).includes(
      "Upraveno v této aplikaci",
    ),
  );
  await admin
    .getByRole("button", { name: "Upravit servis", exact: true })
    .click();
  await admin.getByLabel(/Aktualizovat plán: Výměna motorového oleje/).check();
  await admin
    .getByLabel("Interval km pro Výměna motorového oleje", { exact: true })
    .fill("15000");
  await admin.getByRole("button", { name: "Uložit", exact: true }).click();
  await admin.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(store.load().plans.find((p) => p.id === "p1").lastKm, 148300);
  assert.equal(store.load().plans.find((p) => p.id === "p1").intervalKm, 15000);
  await admin
    .locator("nav")
    .getByRole("button", { name: /^Servisní plány/ })
    .click();
  await admin.getByRole("button", { name: /Smazat plán .*oleje/ }).click();
  await admin.getByLabel("Důvod smazání").fill("Testovací plán");
  await admin.getByRole("button", { name: "Smazat plán", exact: true }).click();
  await admin.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    store.load().plans.some((p) => p.id === "p1"),
    false,
  );
  await admin.getByText(/Smazané plány \(/).click();
  await admin
    .getByRole("button", { name: "Obnovit plán", exact: true })
    .click();
  await admin
    .locator("nav")
    .getByRole("button", { name: "Díly a úkony", exact: true })
    .click();
  assert.ok(
    (await admin.locator(".catalog-record").allTextContents()).some((x) =>
      x.includes("Výměna motorového oleje"),
    ),
  );
  await admin.screenshot({
    path: "data/maintenance-catalog-desktop.png",
    fullPage: false,
  });
  await admin.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await admin.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await admin.screenshot({
    path: "data/maintenance-catalog-mobile.png",
    fullPage: false,
  });
  await admin.setViewportSize({ width: 1440, height: 1050 });
  await admin
    .locator("nav")
    .getByRole("button", { name: "Závady a hlášení", exact: true })
    .click();
  const readingsBeforeDelete = store.load().readings.length;
  await admin
    .getByRole("button", { name: "Smazat odpočet", exact: true })
    .first()
    .click();
  await admin.getByLabel("Důvod smazání").fill("Test chybného odpočtu");
  await admin
    .getByRole("dialog")
    .getByRole("button", { name: "Smazat odpočet", exact: true })
    .click();
  await admin.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(store.load().readings.length, readingsBeforeDelete - 1);
  await admin.getByText(/Smazané odpočty \(/).click();
  await admin
    .getByRole("button", { name: "Obnovit odpočet", exact: true })
    .click();
  await admin
    .getByRole("button", { name: "Odkaz pro hlášení", exact: true })
    .click();
  const link = await admin
    .getByRole("textbox", { name: "Odkaz pro hlášení", exact: true })
    .inputValue();
  await admin.getByRole("button", { name: "Zavřít", exact: true }).click();
  const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await route(page);
  await page.goto(link);
  await page.getByLabel("Vozidlo", { exact: true }).selectOption("v1");
  assert.equal(await page.locator(".login-form").count(), 0);
  await page.getByLabel("Typ hlášení").selectOption("accident");
  await page.getByLabel("Závažnost").selectOption("serious");
  await page
    .getByLabel("Popis závady nebo nehody")
    .fill("Testovací hlášení z formuláře bez přihlášení.");
  await page.getByLabel("Vaše jméno").fill("Testovací instruktor");
  await page
    .getByLabel("Souvisí s pojistnou událostí", { exact: true })
    .check();
  await page.getByLabel("Označit vozidlo").check();
  await page
    .locator("input[capture]")
    .setInputFiles("public/brand/bubu-logo.png");
  await page.locator(".attachment-preview").waitFor();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "data/public-report-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Odeslat hlášení", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Hlášení přijato", exact: true })
    .waitFor();
  assert.equal(store.load().issues.length, 2);
  assert.equal(store.load().users.length, 3);
  assert.equal(store.load().issues.at(-1).owner, null);
  assert.equal(store.load().issues.at(-1).insuranceCase, true);
  assert.equal((await ctx.request.get(base + "/api/state")).status(), 401);
  assert.equal(
    (
      await ctx.request.get(
        base + "/api/attachments/" + store.load().issues.at(-1).attachmentId,
      )
    ).status(),
    401,
  );
  await admin.reload();
  await admin.getByRole("heading", { name: "Přehled flotily" }).waitFor();
  assert(
    (await admin.locator(".open-reports").innerText()).includes(
      "Testovací hlášení",
    ),
  );
  await admin.screenshot({
    path: "data/manager-report-overview.png",
    fullPage: false,
  });
  await admin
    .locator("nav")
    .getByRole("button", { name: "Závady a hlášení", exact: true })
    .click();
  assert(
    (await admin.locator(".issue-grid").innerText()).includes(
      "Testovací instruktor",
    ),
  );
  assert.equal(
    (await admin.evaluate(
      () =>
        document
          .querySelector(".issue-grid")
          .compareDocumentPosition(
            document.querySelector(".mileage-readings"),
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
    )) > 0,
    true,
  );
  const card = admin
    .locator(".issue-card")
    .filter({ hasText: "Testovací hlášení z formuláře bez přihlášení." });
  assert.ok(
    (await admin.locator(".issue-card").first().innerText()).includes(
      "Testovací hlášení z formuláře bez přihlášení.",
    ),
  );
  await card
    .getByRole("button", { name: "Zpracovat hlášení", exact: true })
    .click();
  await admin
    .getByLabel("Pojistné plnění od pojišťovny", { exact: false })
    .fill("12500.75");
  await admin.getByRole("button", { name: "Uložit", exact: true }).click();
  await admin.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(store.load().issues.at(-1).insurancePayout, 12500.75);
  assert.ok((await card.innerText()).includes("12 500,75"));
  await page.getByRole("button", { name: "Nahlásit další závadu" }).click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: "data/public-report-desktop.png",
    fullPage: false,
  });
  await page.goto(base + "/hlaseni#invalid");
  await page.locator(".error-banner").waitFor();
  assert.equal(await page.locator("form").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Ověřeno v izolaci: odkaz bez účtu, kamera a fotografie, příjem hlášení správcem, soukromé přílohy, žádné ruční tankování, servisní náklady, mobil i desktop.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  store.db.close();
}
