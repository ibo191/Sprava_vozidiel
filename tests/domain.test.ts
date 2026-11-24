import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  chronological,
  fuelAnalytics,
  latestReading,
  normalizePlate,
  planStatus,
  replacementIntervals,
  dateSchema,
} from "../src/domain.ts";
import { seed } from "../server/store.ts";
test("RZ ignoruje mezery a velikost písmen", () =>
  assert.equal(normalizePlate("1 ab 2345"), "1AB2345"));
test("datum odmítne neexistující kalendářní den", () =>
  assert.equal(dateSchema.safeParse("2026-02-30").success, false));
test("kalendářní měsíce omezí den na konec měsíce", () => {
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2024-02-29", 12), "2025-02-28");
});
test("servis je překročen podle prvního limitu i při objednání", () => {
  const s = seed(),
    p = {
      ...s.plans[0],
      nextDate: "2026-12-01",
      nextKm: 1000,
      booking: "2026-11-25",
    };
  assert.equal(
    planStatus(
      p,
      { ...s.readings[0], km: 1000, date: "2026-11-19" },
      "2026-11-19",
    ).status,
    "overdue",
  );
  p.nextKm = 200000;
  p.nextDate = "2026-11-18";
  assert.equal(planStatus(p, s.readings[0], "2026-11-19").status, "overdue");
});
test("chybějící základ a staré km nejsou odhadovány", () => {
  const s = seed(),
    p = { ...s.plans[0], lastKm: null };
  assert.equal(planStatus(p, s.readings[0]).status, "unknown");
  assert.equal(planStatus(s.plans[3], s.readings[3]).status, "unknown");
});
test("známý překročený limit nezakryjí neúplné údaje", () => {
  const s = seed(),
    p = { ...s.plans[0], lastKm: null, nextDate: "2020-01-01" };
  assert.equal(planStatus(p, undefined).status, "overdue");
});
test("předstih a přesná hranice termínu", () => {
  const s = seed(),
    p = { ...s.plans[4], nextDate: "2026-12-19" };
  assert.equal(planStatus(p, undefined, "2026-11-19").status, "soon");
  assert.equal(planStatus(p, undefined, "2026-12-19").status, "overdue");
  assert.equal(
    planStatus({ ...p, nextDate: "2027-01-01" }, undefined, "2026-11-19")
      .status,
    "ok",
  );
});
test("historické km kontrolují oba sousedy a stejný den", () => {
  const r = seed().readings[0];
  const rows = [
    { ...r, date: "2026-01-01", km: 100 },
    { ...r, id: "r2", date: "2026-03-01", km: 300 },
  ];
  assert(chronological(rows, r.vehicleId, "2026-02-01", 200));
  assert(!chronological(rows, r.vehicleId, "2026-02-01", 50));
  assert(!chronological(rows, r.vehicleId, "2026-02-01", 400));
  assert(!chronological(rows, r.vehicleId, "2026-01-01", 101));
});
test("konfliktní a starší odečet neposune poslední známý stav", () => {
  const s = seed();
  s.readings.push(
    { ...s.readings[0], id: "back", date: "2000-01-01", km: 1 },
    {
      ...s.readings[0],
      id: "bad",
      date: "2099-01-01",
      km: 999999,
      status: "conflict",
    },
  );
  assert.equal(latestReading(s, "v1")?.km, 148250);
});
test("průměr ceny je vážený součtem litrů, spotřeba zahrne mezitankování", () => {
  const f = seed().fuels.slice(0, 3);
  const a = fuelAnalytics(f);
  assert.equal(a.average, (1596 + 585 + 1424.5) / (42 + 15 + 37));
  assert.equal(a.consumption, 6.5);
  assert.equal(fuelAnalytics([f[0]]).consumption, null);
  assert.equal(
    fuelAnalytics([f[0], { ...f[1], reliable: false }, f[2]]).consumption,
    null,
  );
  assert.equal(
    fuelAnalytics([f[0], { ...f[1], checked: false }, f[2]]).consumption,
    null,
  );
});
test("interval výměny vyžaduje dva záznamy a známé km", () => {
  const s = seed().services[0];
  assert.equal(replacementIntervals([s], s.items[0].name), null);
  const intervals = replacementIntervals(
    [s, { ...s, date: "2099-01-01", km: null }],
    s.items[0].name,
  )!;
  assert.equal(intervals[0].km, null);
});
