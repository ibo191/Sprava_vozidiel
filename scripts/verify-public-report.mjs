// Full workflow in SQLite memory: never touches the active imported database.
import express from "express";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { fileURLToPath } from 'node:url';
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
const store = new Store(":memory:"),
  app = createApp(store);
app.use(express.static("dist"));
app.get("/{*path}", (_req, res) =>
  res.sendFile(
    fileURLToPath(new URL("../dist/index.html", import.meta.url)),
  ),
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
    .getByRole("button", { name: "Závady a hlášení", exact: true })
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
  await page.getByLabel("Vaše jméno (nepovinné)").fill("Testovací instruktor");
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
