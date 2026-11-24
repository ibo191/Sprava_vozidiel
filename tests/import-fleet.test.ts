import { test } from "node:test";
import assert from "node:assert/strict";
import {
  importFleet,
  sourceDate,
  type Snapshot,
} from "../server/import-fleet.ts";
import { fuelAnalytics, latestReading } from "../src/domain.ts";
import { applyCommand } from "../server/commands.ts";
function fixture(): Snapshot {
  return {
    version: 1,
    source: "Moje Autoškola",
    origin: "https://bubu.moje-autoskola.cz",
    capturedAt: "2026-11-23T10:00:00.000Z",
    period: { from: "1.1.2000", to: "23.11.2026" },
    vehicles: [
      {
        sourceId: "1",
        label: "001 Vozidlo ze zdroje",
        plate: "1 ab 2345",
        year: "2020",
        listedKm: "9000",
        group: "Osobní vozidla",
        active: true,
        fields: { vozidlo_rz: "1 ab 2345", vozidlo_rok_vyroby: "2020" },
      },
    ],
    fuels: [
      {
        sourceId: "10",
        teacherName: "Původní učitel",
        fields: {
          tank_vozidlo: "1",
          tank_ucitel: "12",
          tank_tachometr: "100",
          tank_litry: "10.0",
          tank_cena: "",
          tank_datum: "1.1.2025",
          tank_plna: [],
        },
      },
      {
        sourceId: "11",
        teacherName: "Původní učitel",
        fields: {
          tank_vozidlo: "1",
          tank_ucitel: "12",
          tank_tachometr: "200",
          tank_litry: "20.0",
          tank_cena: "800",
          tank_datum: "2.1.2025",
          tank_plna: ["1"],
        },
      },
    ],
    readings: {
      headers: ["Datum tankování", "Vozidlo", "Tachometr"],
      rows: [],
    },
  };
}
test("import zachová neznámou cenu, původního učitele a plnou/částečnou nádrž", () => {
  const { state: s, report } = importFleet(fixture());
  assert.equal(report.fuels, 2);
  assert.equal(s.fuels[0].amount, null);
  assert.equal(s.fuels[0].full, false);
  assert.equal(s.fuels[1].full, true);
  assert.equal(s.fuels[0].checked, false);
  assert.equal(s.fuels[0].source?.teacherName, "Původní učitel");
  assert.equal(s.fuels[0].owner, "ma-import");
  assert.equal(s.users[0].active, false);
  assert.equal(s.vehicles[0].plate, "1AB2345");
  assert.equal(s.vehicles[0].brand, "");
  assert.equal(s.vehicles[0].source?.availabilityVerified, false);
});
test("opakovaný import neobnoví smazaný samostatný odpočet ani tankovací km", () => {
  const snap = fixture();
  snap.readings.rows = [
    { sourceId: "555", cells: ["3.1.2025", "001 Vozidlo ze zdroje", "250"] },
  ];
  const s = importFleet(snap).state;
  assert.equal(s.readings.length, 3);
  const u = {
    id: "mgr",
    name: "Správce",
    email: "mgr@example.test",
    role: "manager" as const,
    active: true,
  };
  for (const r of [...s.readings])
    applyCommand(
      s,
      u,
      "reading.delete",
      { id: r.id, reason: "Ověřená chyba" },
      { password: () => {} },
    );
  snap.capturedAt = "2026-11-24T08:00:00.000Z";
  const again = importFleet(snap, s).state;
  assert.equal(again.readings.length, 0);
  assert.equal(again.fuels.length, 2);
  assert.equal(again.fuels[0].readingExcluded, true);
});
test("nedatovaný tachometr nenahrazuje datovaný stav a chybějící cena nedeformuje průměr", () => {
  const { state: s } = importFleet(fixture());
  assert.equal(latestReading(s, s.vehicles[0].id)?.km, 200);
  assert.equal(s.vehicles[0].source?.undatedKm, 9000);
  const a = fuelAnalytics(s.fuels);
  assert.equal(a.average, null);
  assert.equal(a.amount, 800);
  assert.equal(a.missingPrices, 1);
});
test("opakovaný import nevytváří duplicity a nepřepíše ruční opravy", () => {
  const snap = fixture(),
    { state: s } = importFleet(snap);
  s.fuels[0].amount = 444;
  const again = importFleet(snap, s);
  assert.equal(again.report.unchanged, true);
  assert.equal(again.state.fuels.length, 2);
  assert.equal(again.state.fuels[0].amount, 444);
  snap.capturedAt = "2026-11-23T11:00:00.000Z";
  const newer = importFleet(snap, s);
  assert.equal(newer.report.fuels, 0);
  assert.equal(newer.state.fuels[0].amount, 444);
  assert.equal(newer.state.readings.length, 2);
});
test("rozporné km ve stejný den mají oba záznamy k ověření bez volby vítěze", () => {
  const snap = fixture();
  snap.fuels[1].fields.tank_datum = "1.1.2025";
  const { state: s, report } = importFleet(snap);
  assert.equal(report.conflicts, 2);
  assert(s.readings.every((r) => r.status === "conflict"));
  assert(s.fuels.every((f) => !f.reliable));
  assert.equal(latestReading(s, s.vehicles[0].id), undefined);
});
test("import odmítá kolize RZ, duplicitní zdrojová ID, neznámé vazby a neplatná data", () => {
  const snap = fixture();
  snap.vehicles.push({ ...snap.vehicles[0], sourceId: "2" });
  assert.throws(() => importFleet(snap), /Kolize RZ/);
  const duplicate = fixture();
  duplicate.fuels.push(duplicate.fuels[0]);
  assert.throws(() => importFleet(duplicate), /Duplicitní ID/);
  const broken = fixture();
  broken.fuels[0].fields.tank_vozidlo = "999";
  assert.throws(() => importFleet(broken), /neznámé vozidlo/);
  assert.throws(() => sourceDate("31.2.2025"));
});
function serviceFixture(): Snapshot {
  const snap = fixture();
  snap.servicesCapturedAt = "2026-11-23T11:00:00.000Z";
  snap.services = [
    {
      sourceId: "500",
      fields: {
        vservis_vozidlo: "1",
        vservis_datum: "3.1.2025",
        vservis_tachometr: "",
        vservis_cena: "13970",
        vservis_nazev: "Olej",
        vservis_popis: "Olejový filtr a těsnění",
      },
      cells: [
        "Pá 3.1.2025",
        "001 Vozidlo ze zdroje",
        "ostatní",
        "Skutečný dodavatel",
        "Olej",
        "",
        "13 970,- Kč",
        "upravit",
      ],
    },
  ];
  return snap;
}
test("servisní import zachová datum, cenu, dodavatele a popis bez domýšlení km nebo důvodu", () => {
  const { state: s, report } = importFleet(serviceFixture());
  const r = s.services[0];
  assert.equal(report.services, 1);
  assert.equal(r.total, 13970);
  assert.equal(r.date, "2025-01-03");
  assert.equal(r.km, null);
  assert.equal(r.workshop, "Skutečný dodavatel");
  assert.equal(r.note, "Olejový filtr a těsnění");
  assert.equal(r.items[0].reason, "Důvod ve zdroji neuveden");
  assert.equal(r.source?.id, "500");
  assert.equal(s.issues.length, 0);
  assert.equal(s.plans.length, 0);
  assert.equal(s.readings.length, 2);
});
test("servis bez ceny zůstává neúplný; explicitní nulová cena se zachová", () => {
  const snap = serviceFixture();
  snap.services![0].fields.vservis_cena = "";
  let result = importFleet(snap);
  assert.equal(result.state.services[0].total, null);
  assert.equal(result.report.missingServicePrices, 1);
  snap.services![0].fields.vservis_cena = "0";
  result = importFleet(snap);
  assert.equal(result.state.services[0].total, 0);
  assert.equal(result.report.missingServicePrices, 0);
});
test("opakování servisního importu nepřidá duplicity a zachová ruční změnu", () => {
  const snap = serviceFixture(),
    { state: s } = importFleet(snap);
  const r = s.services[0];
  applyCommand(
    s,
    {
      id: "test-manager",
      name: "Správce",
      email: "manager@example.test",
      role: "manager",
      active: true,
    },
    "service.update",
    { ...r, total: 555, expectedRevision: 0 },
    { password: () => {} },
  );
  snap.servicesCapturedAt = "2026-11-23T12:00:00.000Z";
  const result = importFleet(snap, s);
  assert.equal(result.state.services.length, 1);
  assert.equal(result.state.services[0].total, 555);
  assert.equal(result.report.services, 0);
});
test("servis vyřazeného vozidla lze při chybějícím ID spárovat pouze přesným jednoznačným označením", () => {
  const snap = serviceFixture();
  snap.vehicles[0].active = false;
  snap.services![0].fields.vservis_vozidlo = "x";
  const r = importFleet(snap).state.services[0];
  assert.equal(r.vehicleId, "ma-vehicle:1");
  assert.equal(r.source?.vehicleMatchedByLabel, true);
  snap.services![0].cells[1] = "Podobné ale jiné označení";
  assert.throws(() => importFleet(snap), /jednoznačně/);
});
test("známé km servisu se ověří chronologicky a neznámé neaktualizují tachometr", () => {
  const snap = serviceFixture();
  snap.services![0].fields.vservis_tachometr = "50";
  const { state: s } = importFleet(snap, importFleet(fixture()).state);
  const r = s.readings.find((r) => r.source === "service:ma-service:500")!;
  assert.equal(r.status, "conflict");
  assert.equal(latestReading(s, "ma-vehicle:1")?.km, 200);
  assert.equal(s.services[0].km, 50);
});
