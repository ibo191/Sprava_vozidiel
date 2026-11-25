import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { seed } from "../server/store.ts";
import { applyCommand } from "../server/commands.ts";
import {
  importCurrentKm,
  claimKmJob,
  completeKmJob,
} from "../server/km-import.ts";
import { latestReading, today } from "../src/domain.ts";
const hooks = { password: () => {} };
const setup = () => {
  const s = seed();
  s.vehicles[0].source = {
    system: "moje-autoskola",
    id: "1",
    capturedAt: new Date().toISOString(),
  };
  return { s, u: s.users[1] };
};
const data = (km = 148300) => ({
  source: "Moje Autoškola",
  capturedAt: new Date().toISOString(),
  readings: [
    {
      vehicleSourceId: "1",
      sourceType: "trip",
      sourceId: "500",
      date: today(),
      km,
    },
  ],
});
test("km import přenese pouze odpočet, neopakuje zdroj a neimportuje tankování ani servis", () => {
  const { s } = setup(),
    fuels = structuredClone(s.fuels),
    services = structuredClone(s.services);
  const result = importCurrentKm(s, data(), ["v1"]);
  assert.equal(result.added, 1);
  assert.equal(latestReading(s, "v1")!.km, 148300);
  assert.deepEqual(s.fuels, fuels);
  assert.deepEqual(s.services, services);
  assert.equal(importCurrentKm(s, data(), ["v1"]).added, 0);
});
test("konfliktní km neposunou platný stav, smazaný zdroj se neobnoví a jiné vozidlo se nepřepíše", () => {
  const { s, u } = setup();
  const initial = latestReading(s, "v1")!.km;
  assert.equal(importCurrentKm(s, data(10), ["v1"]).conflicts, 1);
  assert.equal(latestReading(s, "v1")!.km, initial);
  const r = s.readings.find((r) => r.source === "ma-trip:500")!;
  applyCommand(
    s,
    u,
    "reading.delete",
    { id: r.id, reason: "Chybný zdroj" },
    hooks,
  );
  assert.equal(importCurrentKm(s, data(), ["v1"]).added, 0);
  assert.equal(
    importCurrentKm(
      s,
      { ...data(), readings: [{ ...data().readings[0], sourceId: "501" }] },
      ["v2"],
    ).unmatched,
    1,
  );
});
test("fronta má nezávislé spárování, lease a právě jedno dokončení", () => {
  const { s, u } = setup();
  const token = "test-worker-secret";
  applyCommand(
    s,
    u,
    "km.worker.pair",
    { keyHash: createHash("sha256").update(token).digest("hex") },
    hooks,
  );
  const id = crypto.randomUUID();
  applyCommand(
    s,
    u,
    "km.import.request",
    { requestKey: id, vehicleId: "v1", source: "trip" },
    hooks,
  );
  assert.equal(s.kmImports!.length, 1);
  applyCommand(
    s,
    u,
    "km.import.request",
    { requestKey: id, vehicleId: "v1", source: "trip" },
    hooks,
  );
  assert.equal(s.kmImports!.length, 1);
  const job = claimKmJob(s)!;
  assert.equal(job.id, id);
  completeKmJob(s, { id, lease: job.lease, snapshot: data() });
  assert.equal(s.kmImports![0].status, "done");
  assert.throws(
    () => completeKmJob(s, { id, lease: job.lease, snapshot: data() }),
    /dokončen/,
  );
});
test("worker nesmí dodat jiný zdroj nebo dokončit zrušený požadavek", () => {
  const { s, u } = setup();
  applyCommand(s, u, "km.worker.pair", { keyHash: "a".repeat(64) }, hooks);
  const id = crypto.randomUUID();
  applyCommand(
    s,
    u,
    "km.import.request",
    { requestKey: id, vehicleId: "v1", source: "fuel" },
    hooks,
  );
  const job = claimKmJob(s)!;
  assert.throws(
    () => completeKmJob(s, { id, lease: job.lease, snapshot: data() }),
    /zvolenému zdroji/,
  );
  applyCommand(s, u, "km.import.cancel", { id }, hooks);
  assert.throws(
    () => completeKmJob(s, { id, lease: job.lease, snapshot: data() }),
    /dokončen/,
  );
});
test("budoucí datum a nesmyslné km jsou odmítnuty", () => {
  const { s } = setup();
  for (const row of [
    { ...data().readings[0], date: "2200-01-01" },
    { ...data().readings[0], km: -1 },
  ])
    assert.throws(() =>
      importCurrentKm(s, { ...data(), readings: [row] }, ["v1"]),
    );
});
