import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const origin = "https://bubu-sprava-vozidiel.vercel.app";
const session = JSON.parse(
  readFileSync("data/deploy/admin-session.json", "utf8"),
);
const jwt = JSON.parse(
  Buffer.from(session.access_token.split(".")[1], "base64url").toString(),
);
const user = await (
  await fetch("https://mpknrjfyoivikudvcqut.supabase.co/auth/v1/user", {
    headers: {
      apikey: "sb_publishable_OsSNVIvGIBhcxinzC9rrHA_LvCu2kDX",
      Authorization: "Bearer " + session.access_token,
    },
  })
).json();
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await ctx.newPage();
  const failures = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await page.goto(origin);
  await page.getByRole("heading", { name: "Vítejte zpátky." }).waitFor();
  assert.equal(
    await page.getByText("Výchozí heslo:", { exact: false }).count(),
    0,
  );
  await page.evaluate(
    (session) =>
      localStorage.setItem(
        "sb-mpknrjfyoivikudvcqut-auth-token",
        JSON.stringify(session),
      ),
    {
      ...session,
      user,
      expires_at: jwt.exp,
      expires_in: 3600,
      token_type: "bearer",
    },
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Odkaz pro hlášení", exact: true })
    .first()
    .waitFor();
  await page.screenshot({
    path: "data/deploy/live-manager.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Odkaz pro hlášení", exact: true })
    .first()
    .click();
  const link = await page
    .getByLabel("Odkaz pro hlášení", { exact: true })
    .inputValue();
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const report = await mobile.newPage();
  report.on("pageerror", (e) => failures.push(e.message));
  await report.goto(link);
  await report.getByLabel("Vozidlo", { exact: true }).waitFor();
  assert.ok((await report.locator("select option").count()) > 1);
  assert.equal(await report.locator('input[capture="environment"]').count(), 1);
  assert.equal(
    await report
      .getByRole("button", { name: "Přihlásit se", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await report.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await report.screenshot({
    path: "data/deploy/live-mobile-report.png",
    fullPage: true,
  });
  assert.deepEqual(failures, []);
  console.log(
    "Live browser verified: Supabase manager session, accountless mobile form, camera input, no demo credentials, no overflow or JS errors.",
  );
} finally {
  await browser.close();
}
