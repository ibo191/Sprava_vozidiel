import { test } from "node:test";
import assert from "node:assert/strict";
import { mileageConflictGroups, type Reading } from "../src/domain.ts";
const reading = (
  id: string,
  date: string,
  km: number,
  status: Reading["status"] = "conflict",
  vehicleId = "v1",
): Reading => ({
  id,
  date,
  km,
  status,
  vehicleId,
  source: "reading:" + id,
  owner: "u",
});
test("dvojice různých km bez času v jednom dni se zobrazí jako jediný případ s přesným rozdílem", () => {
  const groups = mileageConflictGroups([
    reading("a", "2025-10-11", 59249),
    reading("b", "2025-10-11", 59349),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].readings.length, 2);
  assert.equal(groups[0].problems.length, 1);
  assert.equal(groups[0].problems[0].kind, "same_day");
  assert.equal(groups[0].problems[0].difference, 100);
});
test("pokles km porovná starší a novější záznam včetně již přijatého protějšku", () => {
  const groups = mileageConflictGroups([
    reading("a", "2025-01-01", 200, "accepted"),
    reading("b", "2025-01-02", 150),
  ]);
  const p = groups[0].problems[0];
  assert.equal(p.kind, "decrease");
  assert.equal(p.left.id, "a");
  assert.equal(p.right.id, "b");
  assert.equal(p.difference, 50);
});
test("shodné stavy ani jiná vozidla nevytvářejí falešný rozpor", () => {
  const groups = mileageConflictGroups([
    reading("a", "2025-01-01", 100),
    reading("b", "2025-01-01", 100, "accepted"),
    reading("c", "2025-01-02", 20, "accepted", "v2"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].problems.length, 0);
  assert.equal(groups[0].readings.length, 1);
});
test("po opravě zmizí vyřešené případy a čekající záznam bez aktuálního rozporu zůstane k potvrzení", () => {
  assert.equal(
    mileageConflictGroups([reading("a", "2025-01-01", 100, "accepted")]).length,
    0,
  );
  const g = mileageConflictGroups([
    reading("a", "2025-01-01", 100),
    reading("b", "2025-01-02", 200, "accepted"),
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].problems.length, 0);
});
