import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../server/store.ts";
import { applyCommand } from "../server/commands.ts";
import { today, planStatus, type Service } from "../src/domain.ts";
import {
  canonicalEntry,
  catalogFor,
  catalogUsage,
  itemOperation,
} from "../src/catalog.ts";
const hooks = { password: () => {} };
const fixture = () => {
  const s = seed();
  return { s, u: s.users.find((u) => u.role === "manager")! };
};
const service = (km: number | null = 148300) => ({
  vehicleId: "v1",
  date: today(),
  km,
  items: [
    {
      kind: "action",
      name: "Olejový servis",
      reason: "Pravidelná výměna",
      price: null,
      operation: "replacement",
    },
  ],
  total: 1800,
  workshop: "",
  note: "",
  attachmentId: null,
});
const follow = (planId: string | null = "p1") => ({
  itemIndex: 0,
  planId,
  intervalKm: 15000,
  intervalMonths: null,
  nextDate: null,
  nextKm: null,
  leadKm: 1000,
  leadDays: 14,
  responsible: "Správce",
});
test("smazání odpočtu tankování zachová tankování a částku; obnovu prověří chronologie", () => {
  const { s, u } = fixture(),
    f = s.fuels[0];
  s.readings.push({
    id: "rf",
    source: f.id,
    vehicleId: f.vehicleId,
    date: f.date,
    km: f.km,
    owner: u.id,
    status: "accepted",
  });
  const before = structuredClone(f);
  applyCommand(
    s,
    u,
    "reading.delete",
    { id: "rf", reason: "Chybný odpočet" },
    hooks,
  );
  assert.equal(
    s.readings.some((r) => r.id === "rf"),
    false,
  );
  assert.equal(s.fuels.length, 4);
  assert.equal(f.amount, before.amount);
  assert.equal(f.km, before.km);
  assert.equal(f.readingExcluded, true);
  assert.equal(s.deletedReadings!.length, 1);
  applyCommand(s, u, "reading.restore", { id: "rf" }, hooks);
  assert.equal(s.readings.filter((r) => r.id === "rf").length, 1);
  assert.equal(f.readingExcluded, undefined);
  assert.equal(s.deletedReadings!.length, 0);
});
test("smazaný servisní odpočet se opravou ceny sám neobnoví; obnovit jej lze výslovně", () => {
  const { s, u } = fixture();
  const r = applyCommand(s, u, "service.save", service(), hooks) as Service;
  const reading = s.readings.find((x) => x.source === "service:" + r.id)!;
  applyCommand(
    s,
    u,
    "reading.delete",
    { id: reading.id, reason: "Chybný podklad" },
    hooks,
  );
  applyCommand(
    s,
    u,
    "service.update",
    { ...r, expectedRevision: r.revision ?? 0, total: 1234 },
    hooks,
  );
  assert.equal(r.readingExcluded, true);
  assert.equal(
    s.readings.some((x) => x.source === "service:" + r.id),
    false,
  );
  applyCommand(
    s,
    u,
    "service.update",
    { ...r, expectedRevision: r.revision ?? 0, restoreReading: true },
    hooks,
  );
  assert.equal(r.readingExcluded, undefined);
  assert.equal(
    s.readings.filter((x) => x.source === "service:" + r.id).length,
    1,
  );
});
test("smazání plánu odstraní upozornění i návrhy a obnovení zachová historii", () => {
  const { s, u } = fixture(),
    p = s.plans[0];
  s.services[0].pendingPlanIds = [p.id];
  const count = s.services.length;
  applyCommand(
    s,
    u,
    "plan.delete",
    { id: p.id, reason: "Zkušební plán" },
    hooks,
  );
  assert.equal(
    s.plans.some((x) => x.id === p.id),
    false,
  );
  assert.equal(s.services.length, count);
  assert.equal(s.services[0].pendingPlanIds.length, 0);
  assert.throws(
    () => applyCommand(s, u, "plan.save", { ...p }, hooks),
    /smazán/,
  );
  applyCommand(s, u, "plan.restore", { id: p.id }, hooks);
  assert.ok(s.plans.some((x) => x.id === p.id));
  assert.deepEqual(s.services[0].pendingPlanIds, [p.id]);
});
test("vytvoření servisu rovnou aktualizuje olejový plán na 15 000 km a nastaví předstih", () => {
  const { s, u } = fixture();
  const r = applyCommand(
    s,
    u,
    "service.save",
    { ...service(), followUps: [follow()] },
    hooks,
  ) as Service;
  const p = s.plans.find((x) => x.id === "p1")!;
  assert.equal(p.intervalKm, 15000);
  assert.equal(p.lastKm, 148300);
  assert.equal(p.lastServiceId, r.id);
  assert.equal(r.pendingPlanIds.length, 0);
  assert.equal(
    planStatus(p, {
      id: "x",
      vehicleId: "v1",
      source: "x",
      owner: u.id,
      status: "accepted",
      date: today(),
      km: 162500,
    }).status,
    "soon",
  );
  assert.equal(
    planStatus(p, {
      id: "x",
      vehicleId: "v1",
      source: "x",
      owner: u.id,
      status: "accepted",
      date: today(),
      km: 163300,
    }).status,
    "overdue",
  );
});
test("interval dalšího servisu je měnitelný a oba limity fungují současně", () => {
  const { s, u } = fixture();
  s.plans = [];
  applyCommand(
    s,
    u,
    "service.save",
    {
      ...service(),
      followUps: [{ ...follow(null), intervalKm: 12000, intervalMonths: 12 }],
    },
    hooks,
  );
  assert.equal(s.plans.length, 1);
  assert.equal(s.plans[0].intervalKm, 12000);
  assert.equal(s.plans[0].intervalMonths, 12);
  assert.throws(
    () =>
      applyCommand(
        s,
        u,
        "service.save",
        { ...service(), followUps: [follow(null)] },
        hooks,
      ),
    /existuje plán/,
  );
});
test("neznámé nebo rozporné km nevymyslí základ a neodsunou známý starý termín", () => {
  for (const km of [null, 10]) {
    const { s, u } = fixture(),
      old = structuredClone(s.plans[0]);
    const r = applyCommand(
      s,
      u,
      "service.save",
      { ...service(km), followUps: [follow()] },
      hooks,
    ) as Service;
    assert.equal(s.plans[0].lastKm, old.lastKm);
    assert.equal(s.plans[0].lastDate, old.lastDate);
    assert.equal(s.plans[0].reviewServiceId, r.id);
    assert.ok(r.pendingPlanIds.includes(old.id));
  }
});
test("katalog sjednotí překlepy a výrobce spojkových sad, nespojí různé díly ani opravu s výměnou", () => {
  const { s } = fixture();
  assert.equal(
    canonicalEntry(s, "part", "Čerpadlo odstřikovače").id,
    canonicalEntry(s, "part", "Čerpadlo ostřikovače").id,
  );
  assert.equal(
    canonicalEntry(s, "part", "3 DÍLNÁ SPOJKOVÁ SADA Sachs").id,
    canonicalEntry(s, "part", "3 DÍLNÁ SPOJKOVÁ SADA LUK").id,
  );
  assert.notEqual(
    canonicalEntry(s, "part", "Čep řízení").id,
    canonicalEntry(s, "part", "Čep ramene").id,
  );
  assert.equal(canonicalEntry(s, "part", "Geometrie").kind, "action");
  assert.equal(
    itemOperation({
      kind: "part",
      name: "Oprava převodovky",
      reason: "",
      price: null,
    }),
    "repair",
  );
});
test("standardizace při uložení zachová původní název i variantu; počítá jednou servis, ne duplicitní položky", () => {
  const { s, u } = fixture();
  const item = {
    kind: "part",
    name: "3 DÍLNÁ SPOJKOVÁ SADA LUK",
    reason: "Výměna opotřebení",
    price: 1000,
    operation: "replacement",
  };
  const r = applyCommand(
    s,
    u,
    "service.save",
    { ...service(), items: [item, item] },
    hooks,
  ) as Service;
  assert.equal(r.items[0].name, "Spojková sada (3dílná)");
  assert.equal(r.items[0].originalName, item.name);
  assert.equal(
    catalogUsage(s, canonicalEntry(s, "part", item.name).id, "v1").length,
    1,
  );
  applyCommand(
    s,
    u,
    "service.update",
    { ...r, expectedRevision: 0, total: 2100 },
    hooks,
  );
  assert.equal(r.items[0].originalName, item.name);
  assert.equal(
    catalogFor(s).filter((x) => x.name === "Spojková sada (3dílná)").length,
    1,
  );
});
test("mazání a plánování vyžadují správce; smazání bez důvodu se odmítne", () => {
  const { s, u } = fixture();
  assert.throws(
    () =>
      applyCommand(
        s,
        s.users.find((u) => u.role === "teacher")!,
        "reading.delete",
        { id: s.readings[0].id, reason: "Chybný" },
        hooks,
      ),
    /správce/,
  );
  assert.throws(() =>
    applyCommand(
      s,
      u,
      "reading.delete",
      { id: s.readings[0].id, reason: "" },
      hooks,
    ),
  );
});
