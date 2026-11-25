import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../server/store.ts";
import { applyCommand } from "../server/commands.ts";
import { inspectionStatus, type Issue } from "../src/domain.ts";
const hooks = { password: () => {} };
test("STK: chybějící datum se neodhaduje, vlastní předstih, poslední den platnosti a překročení", () => {
  const v = seed().vehicles[0];
  assert.equal(inspectionStatus(v, "2026-11-24").status, "unknown");
  v.stkValidUntil = "2026-12-10";
  v.stkLeadDays = 10;
  assert.equal(inspectionStatus(v, "2026-11-24").status, "ok");
  assert.equal(inspectionStatus(v, "2026-11-30").status, "soon");
  assert.equal(inspectionStatus(v, "2026-12-10").status, "soon");
  assert.equal(inspectionStatus(v, "2026-12-11").status, "overdue");
  v.stkLeadDays = 0;
  assert.equal(inspectionStatus(v, "2026-12-09").status, "ok");
});
test("správce nastaví STK importovanému vozidlu bez domýšlení značky a změna je auditovaná", () => {
  const s = seed(),
    v = s.vehicles[0],
    u = s.users[1];
  v.brand = "";
  v.source = {
    system: "moje-autoskola",
    id: "1",
    capturedAt: new Date().toISOString(),
  };
  const before = structuredClone(v),
    plans = structuredClone(s.plans);
  applyCommand(
    s,
    u,
    "vehicle.stk",
    { id: v.id, stkValidUntil: "2027-04-30", stkLeadDays: 45 },
    hooks,
  );
  assert.equal(v.brand, "");
  assert.equal(v.stkValidUntil, "2027-04-30");
  assert.equal(v.stkLeadDays, 45);
  assert.deepEqual(s.plans, plans);
  assert.deepEqual(s.audit.at(-1)!.before, before);
  assert.throws(
    () =>
      applyCommand(
        s,
        s.users[2],
        "vehicle.stk",
        { id: v.id, stkValidUntil: null, stkLeadDays: 30 },
        hooks,
      ),
    /správce/,
  );
  assert.throws(() =>
    applyCommand(
      s,
      u,
      "vehicle.stk",
      { id: v.id, stkValidUntil: "2027-02-30", stkLeadDays: 30 },
      hooks,
    ),
  );
});
test("pojistné plnění rozlišuje neznámou částku a nulu, změny jsou auditované", () => {
  const s = seed(),
    u = s.users[1],
    i = s.issues[0];
  const review = (extra: Record<string, unknown>) =>
    applyCommand(
      s,
      u,
      "issue.review",
      {
        id: i.id,
        status: "in_progress",
        response: "Ověřeno správcem",
        serviceId: null,
        ...extra,
      },
      hooks,
    );
  review({ insuranceCase: true, insurancePayout: null });
  assert.equal(i.insurancePayout, null);
  review({ insurancePayout: 0 });
  assert.equal(i.insurancePayout, 0);
  review({ insurancePayout: 12500.75 });
  assert.equal(i.insurancePayout, 12500.75);
  assert.equal((s.audit.at(-1)!.before as Issue).insurancePayout, 0);
  review({ response: "Další informace" });
  assert.equal(i.insuranceCase, true);
  assert.equal(i.insurancePayout, 12500.75);
  assert.throws(() => review({ insuranceCase: false }), /pouze u pojistné/);
  review({ insuranceCase: false, insurancePayout: null });
  assert.equal(i.insuranceCase, false);
  assert.equal(i.insurancePayout, null);
});
test("plnění odmítá záporné částky, více desetinných míst a uživatele bez správcovské role", () => {
  const s = seed(),
    i = s.issues[0],
    payload = {
      id: i.id,
      status: "new",
      response: "",
      serviceId: null,
      insuranceCase: true,
    };
  for (const value of [-1, 0.001, Infinity, NaN])
    assert.throws(() =>
      applyCommand(
        s,
        s.users[1],
        "issue.review",
        { ...payload, insurancePayout: value },
        hooks,
      ),
    );
  assert.throws(
    () =>
      applyCommand(
        s,
        s.users[2],
        "issue.review",
        { ...payload, insurancePayout: 100 },
        hooks,
      ),
    /správce/,
  );
});
