import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../server/store.ts";
import { applyCommand } from "../server/commands.ts";
import { planStatus, today } from "../src/domain.ts";
const hooks = { password: () => {} };
test("dodatečné objednání zachová základ, interval, vazbu servisu a překročení termínu", () => {
  const s = seed(),
    u = s.users[1],
    p = s.plans[0];
  p.lastServiceId = "s1";
  p.reviewServiceId = "s1";
  const before = structuredClone(p);
  applyCommand(
    s,
    u,
    "plan.booking",
    {
      id: p.id,
      booking: "2026-12-15",
      bookingNote: "Autoservis · potvrzeno telefonicky",
    },
    hooks,
  );
  assert.equal(p.booking, "2026-12-15");
  assert.equal(p.lastKm, before.lastKm);
  assert.equal(p.intervalKm, before.intervalKm);
  assert.equal(p.lastServiceId, "s1");
  assert.equal(p.reviewServiceId, "s1");
  assert.equal(
    planStatus(p, {
      id: "x",
      vehicleId: p.vehicleId,
      source: "x",
      owner: u.id,
      status: "accepted",
      date: today(),
      km: 180000,
    }).status,
    "overdue",
  );
  applyCommand(
    s,
    u,
    "plan.booking",
    { id: p.id, booking: null, bookingNote: "Termín zrušen" },
    hooks,
  );
  assert.equal(p.booking, null);
});
test("aktualizace závady se přidávají do historie s ověřeným autorem a datum staré odpovědi se nevymýšlí", () => {
  const s = seed(),
    u = s.users[1],
    i = s.issues[0],
    old = i.response;
  applyCommand(
    s,
    u,
    "issue.update",
    {
      id: i.id,
      text: "Objednány náhradní díly",
      status: "in_progress",
      actor: "admin",
      at: "2000-01-01",
    },
    hooks,
  );
  applyCommand(
    s,
    u,
    "issue.update",
    { id: i.id, text: "Díly dorazily, servis zítra" },
    hooks,
  );
  assert.equal(i.updates!.length, 3);
  assert.equal(i.updates![0].text, old);
  assert.equal(i.updates![0].at, null);
  assert.equal(i.updates![1].actor, u.id);
  assert.notEqual(i.updates![1].at, "2000-01-01");
  applyCommand(
    s,
    u,
    "issue.review",
    {
      id: i.id,
      status: "resolved",
      response: "Opraveno a zkontrolováno",
      serviceId: null,
    },
    hooks,
  );
  assert.equal(i.updates!.at(-1)!.text, "Opraveno a zkontrolováno");
  assert.equal(i.updates![1].text, "Objednány náhradní díly");
});
test("lze smazat jen vyřešenou závadu; plnění, průběh řešení a odstavení vozidla zůstanou zachované", () => {
  const s = seed(),
    u = s.users[1],
    i = s.issues[0];
  i.insuranceCase = true;
  i.insurancePayout = 12345;
  assert.throws(
    () =>
      applyCommand(
        s,
        u,
        "issue.delete",
        { id: i.id, reason: "Uzavřeno" },
        hooks,
      ),
    /vyřešenou/,
  );
  applyCommand(
    s,
    u,
    "issue.update",
    { id: i.id, text: "Oprava dokončena", status: "resolved" },
    hooks,
  );
  const before = structuredClone(i),
    vehicle = s.vehicles.find((v) => v.id === i.vehicleId)!;
  applyCommand(
    s,
    u,
    "issue.delete",
    { id: i.id, reason: "Vyřešeno, skrýt ze seznamu" },
    hooks,
  );
  assert.equal(s.issues.length, 0);
  assert.deepEqual(s.deletedIssues![0].issue, before);
  assert.equal(vehicle.unavailable, true);
  assert.throws(
    () =>
      applyCommand(
        s,
        u,
        "issue.update",
        { id: i.id, text: "Zastaralý formulář" },
        hooks,
      ),
    /smazána/,
  );
  applyCommand(s, u, "issue.restore", { id: i.id }, hooks);
  assert.deepEqual(s.issues[0], before);
  assert.equal(s.deletedIssues!.length, 0);
});
test("objednání, aktualizace a mazání závad vyžadují správce", () => {
  const s = seed(),
    u = s.users[2];
  for (const action of [
    "plan.booking",
    "issue.update",
    "issue.delete",
    "issue.restore",
  ])
    assert.throws(() => applyCommand(s, u, action, {}, hooks), /správce/);
});
