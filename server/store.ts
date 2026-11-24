import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { randomUUID, scryptSync } from "node:crypto";
import type { State } from "../src/domain.ts";
import { today } from "../src/domain.ts";
export const id = () => randomUUID();
export function seed(): State {
  const at = today(),
    ago = (n: number) =>
      new Date(Date.parse(at) - n * 86400000).toISOString().slice(0, 10);
  return {
    users: [
      {
        id: "admin",
        name: "Jakub Novák",
        email: "admin@bubu.local",
        role: "admin",
        active: true,
      },
      {
        id: "manager",
        name: "Petra Dvořáková",
        email: "spravce@bubu.local",
        role: "manager",
        active: true,
      },
      {
        id: "teacher",
        name: "Martin Svoboda",
        email: "ucitel@bubu.local",
        role: "teacher",
        active: true,
      },
    ],
    vehicles: [
      {
        id: "v1",
        brand: "Škoda",
        model: "Octavia",
        year: 2021,
        plate: "1AB2345",
        kind: "car",
        active: true,
        unavailable: false,
      },
      {
        id: "v2",
        brand: "Škoda",
        model: "Fabia",
        year: 2022,
        plate: "2BC6789",
        kind: "car",
        active: true,
        unavailable: false,
      },
      {
        id: "v3",
        brand: "Volkswagen",
        model: "Golf",
        year: 2020,
        plate: "3CD4567",
        kind: "car",
        active: true,
        unavailable: true,
      },
      {
        id: "v4",
        brand: "Honda",
        model: "CB500F",
        year: 2023,
        plate: "4E1234",
        kind: "motorcycle",
        active: true,
        unavailable: false,
      },
      {
        id: "v5",
        brand: "Agados",
        model: "VZ 26",
        year: 2019,
        plate: "5AF8901",
        kind: "trailer",
        active: true,
        unavailable: false,
      },
    ],
    readings: [
      {
        id: "r1",
        vehicleId: "v1",
        date: ago(1),
        km: 148250,
        owner: "teacher",
        status: "accepted",
        source: "initial",
      },
      {
        id: "r2",
        vehicleId: "v2",
        date: ago(2),
        km: 62840,
        owner: "teacher",
        status: "accepted",
        source: "initial",
      },
      {
        id: "r3",
        vehicleId: "v3",
        date: ago(3),
        km: 186410,
        owner: "teacher",
        status: "accepted",
        source: "initial",
      },
      {
        id: "r4",
        vehicleId: "v4",
        date: ago(48),
        km: 19200,
        owner: "teacher",
        status: "accepted",
        source: "initial",
      },
    ],
    plans: [
      {
        id: "p1",
        vehicleId: "v1",
        action: "Motorový olej a filtr",
        responsible: "Petra Dvořáková",
        lastDate: ago(280),
        lastKm: 134000,
        nextDate: null,
        nextKm: null,
        intervalKm: 15000,
        intervalMonths: 12,
        leadKm: 1500,
        leadDays: 30,
        booking: ago(-5),
      },
      {
        id: "p2",
        vehicleId: "v2",
        action: "Technická prohlídka",
        responsible: "Petra Dvořáková",
        lastDate: null,
        lastKm: null,
        nextDate: ago(-18),
        nextKm: null,
        intervalKm: null,
        intervalMonths: null,
        leadKm: 0,
        leadDays: 30,
        booking: null,
      },
      {
        id: "p3",
        vehicleId: "v3",
        action: "Brzdové destičky",
        responsible: "Jakub Novák",
        lastDate: ago(400),
        lastKm: 145000,
        nextDate: null,
        nextKm: 185000,
        intervalKm: 40000,
        intervalMonths: null,
        leadKm: 1500,
        leadDays: 30,
        booking: ago(-2),
      },
      {
        id: "p4",
        vehicleId: "v4",
        action: "Pravidelná prohlídka",
        responsible: "Petra Dvořáková",
        lastDate: ago(100),
        lastKm: 16000,
        nextDate: null,
        nextKm: null,
        intervalKm: 6000,
        intervalMonths: 12,
        leadKm: 1000,
        leadDays: 30,
        booking: null,
      },
      {
        id: "p5",
        vehicleId: "v5",
        action: "Technická prohlídka",
        responsible: "Jakub Novák",
        lastDate: null,
        lastKm: null,
        nextDate: ago(-170),
        nextKm: null,
        intervalKm: null,
        intervalMonths: null,
        leadKm: 0,
        leadDays: 30,
        booking: null,
      },
    ],
    fuels: [
      {
        id: "f1",
        vehicleId: "v1",
        owner: "teacher",
        date: ago(15),
        km: 147000,
        liters: 42,
        amount: 1596,
        full: true,
        code: "B-000001",
        checked: true,
        receipt: "complete",
        attachmentId: null,
        correction: "",
        reliable: true,
      },
      {
        id: "f2",
        vehicleId: "v1",
        owner: "teacher",
        date: ago(9),
        km: 147400,
        liters: 15,
        amount: 585,
        full: false,
        code: "B-000002",
        checked: true,
        receipt: "received",
        attachmentId: null,
        correction: "",
        reliable: true,
      },
      {
        id: "f3",
        vehicleId: "v1",
        owner: "teacher",
        date: ago(4),
        km: 147800,
        liters: 37,
        amount: 1424.5,
        full: true,
        code: "B-000003",
        checked: true,
        receipt: "complete",
        attachmentId: null,
        correction: "",
        reliable: true,
      },
      {
        id: "f4",
        vehicleId: "v2",
        owner: "teacher",
        date: ago(3),
        km: 62800,
        liters: 38.4,
        amount: 1474.56,
        full: true,
        code: "B-000004",
        checked: false,
        receipt: "missing",
        attachmentId: null,
        correction: "",
        reliable: true,
      },
    ],
    issues: [
      {
        id: "i1",
        vehicleId: "v3",
        owner: "teacher",
        date: ago(3),
        description: "Při brzdění se ozývá kovový zvuk od předního kola.",
        severity: "serious",
        immobilize: true,
        status: "in_progress",
        response: "Vozidlo odstaveno, objednána kontrola brzd.",
        supplement: "",
        serviceId: null,
        attachmentId: null,
      },
    ],
    services: [
      {
        id: "s1",
        vehicleId: "v1",
        date: ago(280),
        km: 134000,
        items: [
          {
            kind: "action",
            name: "Motorový olej a filtr",
            reason: "Preventivní výměna dle intervalu",
            price: 1800,
          },
          {
            kind: "part",
            name: "Olej 5W-30 + filtr",
            reason: "Preventivní výměna",
            price: 2100,
          },
        ],
        total: 3900,
        workshop: "Autoservis Praha",
        note: "Pravidelná údržba, bez závady.",
        attachmentId: null,
        pendingPlanIds: [],
      },
    ],
    audit: [],
    attachments: [],
  };
}
export class Store {
  db: DatabaseSync;
  constructor(path = "data/bubu.sqlite") {
    if (path !== ":memory:") mkdirSync("data", { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS fuel_codes(code TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, fuel_id TEXT UNIQUE NOT NULL); CREATE TABLE IF NOT EXISTS credentials(user_id TEXT PRIMARY KEY, hash TEXT NOT NULL, salt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY); INSERT OR IGNORE INTO schema_migrations VALUES(1);`,
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS report_submissions(request_key TEXT PRIMARY KEY, issue_id TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, receipt TEXT UNIQUE NOT NULL);",
    );
    if (!this.db.prepare("SELECT id FROM state").get()) {
      const s = seed();
      for (const f of s.fuels)
        s.readings.push({
          id: id(),
          vehicleId: f.vehicleId,
          date: f.date,
          km: f.km,
          owner: f.owner,
          status: "accepted",
          source: f.id,
        });
      this.save(s);
      for (const f of s.fuels)
        this.db
          .prepare("INSERT INTO fuel_codes VALUES(?,?,?)")
          .run(f.code, f.id, f.id);
      for (const u of s.users) this.password(u.id, "BubuDemo2026!");
    }
  }
  load(): State {
    return JSON.parse(
      (
        this.db.prepare("SELECT body FROM state WHERE id=1").get() as {
          body: string;
        }
      ).body,
    );
  }
  save(s: State) {
    this.db
      .prepare(
        "INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(JSON.stringify(s));
  }
  password(userId: string, password: string) {
    const salt = id();
    const hash = scryptSync(password, salt, 64).toString("hex");
    this.db
      .prepare("INSERT OR REPLACE INTO credentials VALUES(?,?,?)")
      .run(userId, hash, salt);
  }
  verify(userId: string, password: string) {
    const row = this.db
      .prepare("SELECT * FROM credentials WHERE user_id=?")
      .get(userId) as { hash: string; salt: string } | undefined;
    return (
      row && scryptSync(password, row.salt, 64).toString("hex") === row.hash
    );
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
