import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const origin = "https://bubu-sprava-vozidiel.vercel.app";
const api =
  "https://mpknrjfyoivikudvcqut.supabase.co/functions/v1/fleet-api/api";
const session = JSON.parse(
  readFileSync(
    process.env.BUBU_VERIFY_SESSION_FILE ?? "data/deploy/admin-session.json",
    "utf8",
  ),
);
async function call(path, { body, auth = false, token } = {}) {
  return fetch(api + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(auth ? { Authorization: "Bearer " + session.access_token } : {}),
      ...(token ? { "X-Report-Token": token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
assert.equal((await fetch(origin)).status, 200);
assert.equal((await call("/state")).status, 401);
const profile = await call("/me", { auth: true });
assert.equal(profile.status, 200);
assert.equal((await profile.json()).role, "admin");
const state = await (await call("/state", { auth: true })).json();
assert.ok(state.dataset);
assert.deepEqual(state.attachments, []);
const link = await (await call("/report-link", { auth: true })).json();
const token = link.path.split("#")[1];
const opts = await (await call("/reporting/vehicles", { token })).json();
assert.equal(
  opts.vehicles.length,
  state.vehicles.filter((v) => v.active).length,
);
assert.equal(
  (await call("/reporting/vehicles", { token: "invalid" })).status,
  403,
);
assert.equal(
  (
    await call("/command", {
      auth: true,
      body: { action: "fuel.save", payload: {} },
    })
  ).status,
  403,
);
const csv = await call("/export/services", { auth: true });
assert.equal(csv.status, 200);
assert.ok((await csv.text()).includes("Cena Kč"));
if (process.argv.includes("--write-test")) {
  mkdirSync("data/deploy", { recursive: true });
  const file = "data/deploy/live-test-report.json";
  const body = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {
        requestKey: crypto.randomUUID(),
        vehicleId: opts.vehicles[0].id,
        kind: "fault",
        severity: "minor",
        immobilize: false,
        description:
          "[TEST NASAZENÍ] Ověření formuláře a soukromé fotografie. Nejde o skutečnou závadu vozidla.",
        reporterName: "Technická kontrola nasazení",
        photo: {
          name: "test-bubu-logo.png",
          mime: "image/png",
          data: readFileSync("public/brand/bubu-logo.png").toString("base64"),
        },
      };
  writeFileSync(file, JSON.stringify(body));
  const sent = await call("/reporting/submit", { body, token });
  assert.equal(sent.status, 201);
  const receipt = await sent.json();
  const again = await call("/reporting/submit", { body, token });
  assert.deepEqual(await again.json(), receipt);
  assert.equal(
    (
      await call("/reporting/submit", {
        body: { ...body, description: body.description + " změna" },
        token,
      })
    ).status,
    409,
  );
  const saved = await (await call("/state", { auth: true })).json();
  const issue = saved.issues.find(
    (i) => i.id.toUpperCase() === receipt.receipt.slice(2),
  );
  assert.ok(issue);
  assert.equal(issue.owner, null);
  assert.equal((await call("/attachments/" + issue.attachmentId)).status, 401);
  const photo = await call("/attachments/" + issue.attachmentId, {
    auth: true,
  });
  assert.equal(photo.status, 200);
  assert.equal(
    Buffer.from(await photo.arrayBuffer()).compare(
      readFileSync("public/brand/bubu-logo.png"),
    ),
    0,
  );
  const closed = await call("/command", {
    auth: true,
    body: {
      action: "issue.review",
      payload: {
        id: issue.id,
        status: "resolved",
        response:
          "Ověření nasazení úspěšné: hlášení, fotografie, duplicita i oprávnění. Toto je pouze technický test, nikoliv skutečná závada.",
        serviceId: null,
      },
    },
  });
  assert.equal(closed.status, 200);
  console.log(
    "Live report, private photo download, idempotent retry, changed-body rejection and closure verified.",
  );
}
console.log(
  JSON.stringify({
    frontend: 200,
    admin: "verified",
    vehicles: state.vehicles.length,
    fuels: state.fuels.length,
    services: state.services.length,
    manualFuel: 403,
    privateState: 401,
    export: 200,
  }),
);
