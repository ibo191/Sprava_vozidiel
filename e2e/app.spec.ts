import { test, expect } from "@playwright/test";
test("správa má importované tankování bez ručního zápisu a náklady na servis", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Učitel", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Přehled flotily" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nové tankování", exact: true }),
  ).toHaveCount(0);
  if (await page.getByRole("button", { name: "Otevřít menu" }).isVisible())
    await page.getByRole("button", { name: "Otevřít menu" }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Tankování", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tankování z Moje Autoškola" }),
  ).toBeVisible();
  await expect(page.locator(".row-actions")).toHaveCount(0);
});
test("formulář z odkazu přijme závadu bez účtu", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Přihlásit se", exact: true }).click();
  await page.getByRole("heading", { name: "Přehled flotily" }).waitFor();
  const link = await (await page.request.get("/api/report-link")).json();
  await context.clearCookies();
  await page.goto(link.path);
  await expect(
    page.getByRole("heading", { name: "Nahlásit závadu", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".login-form")).toHaveCount(0);
  await page.getByLabel("Vozidlo", { exact: true }).selectOption("v1");
  await page
    .getByLabel("Popis závady nebo nehody")
    .fill("Izolované E2E hlášení " + info.project.name);
  await expect(page.locator('input[capture="environment"]')).toHaveCount(1);
  await page
    .getByRole("button", { name: "Odeslat hlášení", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hlášení přijato", exact: true }),
  ).toBeVisible();
});
