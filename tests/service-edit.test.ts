import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../server/store.ts";
import { applyCommand } from "../server/commands.ts";
import { planStatus, today, type Service } from "../src/domain.ts";
const hooks = { password: () => {} };
function fixture() {
  const s = seed(),
    u = s.users.find((u) => u.role === "manager")!,
    r = s.services[0];
  r.source = {
    system: "moje-autoskola",
    id: "500",
    capturedAt: new Date().toISOString(),
  };
  return { s, u, r };
}
function edit(r: Service, overrides: Record<string, unknown> = {}) {
  return {
    ...structuredClone(r),
    expectedRevision: r.revision ?? 0,
    ...overrides,
  };
}
test("oprava importovaného servisu zachová zdroj a ID, změní cenu a uloží původní hodnoty do auditu", () => {
  const { s, u, r } = fixture(),
    before = structuredClone(r),
    count = s.services.length;
  s.vehicles.find((v) => v.id === r.vehicleId)!.active = false;
  const result = applyCommand(
    s,
    u,
    "service.update",
    edit(r, {
      total: 4500,
      workshop: "",
      note: "Oprava částky podle dokladu",
      source: { id: "spoof" },
    }),
    hooks,
  ) as Service;
  assert.equal(s.services.length, count);
  assert.equal(result.id, before.id);
  assert.deepEqual(result.source, before.source);
  assert.equal(result.total, 4500);
  assert.equal(result.revision, 1);
  assert.equal(result.editedBy, u.id);
  assert.deepEqual(s.audit.at(-1)!.before, before);
  assert.equal((s.audit.at(-1)!.after as Service).total, 4500);
});
test("oprava km nahradí starý odečet, rozpor se označí; neznámé km odstraní pouze odečet tohoto servisu", () => {
  const { s, u, r } = fixture();
  s.readings.push({
    id: "service-reading",
    source: "service:" + r.id,
    vehicleId: r.vehicleId,
    date: r.date,
    km: r.km!,
    owner: u.id,
    status: "accepted",
  });
  const unrelated = s.readings.filter((x) => x.source !== "service:" + r.id);
  applyCommand(
    s,
    u,
    "service.update",
    edit(r, { date: today(), km: 10 }),
    hooks,
  );
  const readings = s.readings.filter((x) => x.source === "service:" + r.id);
  assert.equal(readings.length, 1);
  assert.equal(readings[0].id, "service-reading");
  assert.equal(readings[0].status, "conflict");
  applyCommand(s, u, "service.update", edit(r, { km: null }), hooks);
  assert.equal(
    s.readings.some((x) => x.source === "service:" + r.id),
    false,
  );
  assert.deepEqual(s.readings, unrelated);
});
test("oprava podkladu potvrzeného plánu vyžádá kontrolu, cenu lze opravit bez znovupotvrzení plánu", () => {
  const { s, u, r } = fixture(),
    p = s.plans[0];
  p.lastServiceId = r.id;
  p.lastDate = r.date;
  p.lastKm = r.km;
  const previous = structuredClone(p);
  applyCommand(s, u, "service.update", edit(r, { total: 1234 }), hooks);
  assert.equal(p.reviewServiceId, undefined);
  assert.equal(r.pendingPlanIds.length, 0);
  applyCommand(
    s,
    u,
    "service.update",
    edit(r, { date: today(), km: null }),
    hooks,
  );
  assert.equal(p.lastDate, previous.lastDate);
  assert.equal(p.lastKm, previous.lastKm);
  assert.equal(p.reviewServiceId, r.id);
  assert.equal(planStatus(p, undefined).incomplete, true);
  assert.ok(r.pendingPlanIds.includes(p.id));
  applyCommand(s, u, "plan.save", { ...p }, hooks);
  assert.equal(p.reviewServiceId, undefined);
});
test("zastaralá editace, neexistující servis a učitelská role jsou odmítnuty", () => {
  const { s, u, r } = fixture(),
    stale = edit(r);
  applyCommand(s, u, "service.update", edit(r, { total: 999 }), hooks);
  assert.throws(
    () => applyCommand(s, u, "service.update", stale, hooks),
    /mezitím upravil/,
  );
  assert.throws(
    () =>
      applyCommand(s, u, "service.update", edit(r, { id: "missing" }), hooks),
    /neexistuje/,
  );
  assert.throws(
    () =>
      applyCommand(
        s,
        s.users.find((u) => u.role === "teacher")!,
        "service.update",
        edit(r),
        hooks,
      ),
    /správce/,
  );
});
test("propojený servis nelze přesunout k jinému vozidlu bez zrušení vazby", () => {
  const { s, u, r } = fixture();
  s.issues[0].serviceId = r.id;
  s.issues[0].vehicleId = r.vehicleId;
  assert.throws(
    () =>
      applyCommand(s, u, "service.update", edit(r, { vehicleId: "v2" }), hooks),
    /propojen/,
  );
});
