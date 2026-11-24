import { createHash } from "node:crypto";
import { z } from "zod";
import {
  chronological,
  dateSchema,
  normalizePlate,
  today,
  type Fuel,
  type Reading,
  type State,
  type Service,
  type Vehicle,
} from "../src/domain.ts";
const fields = z.record(z.string(), z.union([z.string(), z.array(z.string())]));
export const snapshotSchema = z.object({
  version: z.literal(1),
  source: z.literal("Moje Autoškola"),
  origin: z.literal("https://bubu.moje-autoskola.cz"),
  capturedAt: z.string().datetime(),
  period: z.object({ from: z.string(), to: z.string() }),
  vehicles: z
    .array(
      z.object({
        sourceId: z.string().regex(/^\d+$/),
        label: z.string().min(1),
        plate: z.string().min(1),
        year: z.string(),
        listedKm: z.string(),
        group: z.string(),
        active: z.boolean(),
        fields,
      }),
    )
    .min(1),
  fuels: z.array(
    z.object({
      sourceId: z.string().regex(/^\d+$/),
      fields,
      teacherName: z.string(),
    }),
  ),
  readings: z.object({
    headers: z.array(z.string()),
    rows: z.array(
      z.object({ cells: z.array(z.string()), sourceId: z.string().nullable() }),
    ),
  }),
  servicesCapturedAt: z.string().datetime().optional(),
  services: z
    .array(
      z.object({
        sourceId: z.string().regex(/^\d+$/),
        fields,
        cells: z.array(z.string()).min(7),
      }),
    )
    .optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const sourceHash = (snapshot: unknown) =>
  createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
export function sourceDate(value: string): string {
  const m = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) throw new Error("Zdrojové datum není úplné: " + value);
  const d = dateSchema.parse(
    `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`,
  );
  if (d > today()) throw new Error("Budoucí odečet: " + d);
  return d;
}
function number(value: unknown, nullable = false): number | null {
  if (typeof value !== "string")
    throw new Error("Chybí číselné pole ve zdroji.");
  if (!value.trim()) {
    if (nullable) return null;
    throw new Error("Chybí povinné číslo.");
  }
  const n = Number(value.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error("Neplatné číslo: " + value);
  return n;
}
const field = (f: Snapshot["vehicles"][number]["fields"], key: string) => {
  const v = f[key];
  if (typeof v !== "string") throw new Error("Chybí pole " + key);
  return v;
};
export function importFleet(input: unknown, existing?: State) {
  const snap = snapshotSchema.parse(input),
    hash = sourceHash(snap);
  if (existing?.dataset?.sourceHash === hash)
    return {
      state: existing,
      report: {
        unchanged: true,
        vehicles: 0,
        fuels: 0,
        readings: 0,
        conflicts: existing.readings.filter((r) => r.status === "conflict")
          .length,
        missingPrices: existing.fuels.filter((f) => f.amount === null).length,
        services: 0,
        missingServicePrices: existing.services.filter(
          (r) => r.total === null && r.items.some((i) => i.price === null),
        ).length,
      },
    };
  const s: State = existing
    ? structuredClone(existing)
    : {
        users: [],
        vehicles: [],
        readings: [],
        plans: [],
        fuels: [],
        issues: [],
        services: [],
        audit: [],
        attachments: [],
      };
  const owner = "ma-import";
  if (!s.users.some((u) => u.id === owner))
    s.users.push({
      id: owner,
      name: "Import z Moje Autoškola",
      email: "import@bubu.local",
      role: "teacher",
      active: false,
    });
  let vehicles = 0,
    fuels = 0,
    readings = 0;
  let services = 0;
  const warnings: string[] = [];
  const bySource = new Map<string, Vehicle>();
  const byLabel = new Map<string, Vehicle>();
  const sourceIds = new Set<string>();
  for (const row of snap.vehicles) {
    if (sourceIds.has(row.sourceId))
      throw new Error("Duplicitní ID vozidla ve zdroji.");
    sourceIds.add(row.sourceId);
    const plate = normalizePlate(field(row.fields, "vozidlo_rz"));
    if (!plate) throw new Error("Chybí RZ vozidla " + row.sourceId);
    const found = s.vehicles.find(
      (v) =>
        v.source?.system === "moje-autoskola" && v.source.id === row.sourceId,
    );
    if (s.vehicles.some((v) => v.plate === plate && v.id !== found?.id))
      throw new Error("Kolize RZ " + plate + "; vyžaduje ruční párování.");
    const year = number(field(row.fields, "vozidlo_rok_vyroby"));
    if (
      !year ||
      !Number.isInteger(year) ||
      year < 1900 ||
      year > new Date().getFullYear() + 1
    )
      throw new Error("Neplatný rok výroby.");
    const kind: Vehicle["kind"] = /motork/i.test(row.group)
      ? "motorcycle"
      : /vozík|přívěs/i.test(row.label)
        ? "trailer"
        : /osobní/i.test(row.group)
          ? "car"
          : (() => {
              throw new Error("Neznámý druh vozidla.");
            })();
    // The source stores one designation, not independently verified brand/model fields.
    const v: Vehicle = found ?? {
      id: "ma-vehicle:" + row.sourceId,
      brand: "",
      model: row.label,
      year,
      plate,
      kind,
      active: row.active,
      unavailable: false,
      source: {
        system: "moje-autoskola",
        id: row.sourceId,
        label: row.label,
        capturedAt: snap.capturedAt,
        undatedKm: number(row.listedKm, true),
        availabilityVerified: false,
      },
    };
    if (!found) {
      s.vehicles.push(v);
      vehicles++;
    }
    bySource.set(row.sourceId, v);
    byLabel.set(row.label.replace(/\s+/g, " ").trim(), v);
  }
  const importedReadings: Reading[] = [];
  const serviceSourceIds = new Set<string>();
  for (const row of snap.services ?? []) {
    if (serviceSourceIds.has(row.sourceId))
      throw new Error("Duplicitní ID servisu ve zdroji.");
    serviceSourceIds.add(row.sourceId);
    const sid = "ma-service:" + row.sourceId;
    if (s.services.some((r) => r.id === sid)) continue;
    const rawVehicleId = field(row.fields, "vservis_vozidlo");
    let v = bySource.get(rawVehicleId),
      matchedByLabel = false;
    if (!v && ["", "x", "-1"].includes(rawVehicleId)) {
      const matches = snap.vehicles.filter(
        (x) =>
          x.label.replace(/\s+/g, " ").trim() ===
          row.cells[1]?.replace(/\s+/g, " ").trim(),
      );
      if (matches.length === 1) {
        v = bySource.get(matches[0].sourceId);
        matchedByLabel = true;
      }
    }
    if (!v)
      throw new Error(
        "Servis " + row.sourceId + " nelze jednoznačně přiřadit vozidlu.",
      );
    const date = sourceDate(field(row.fields, "vservis_datum")),
      km = number(field(row.fields, "vservis_tachometr"), true),
      total = number(field(row.fields, "vservis_cena"), true);
    if (km !== null && !Number.isInteger(km))
      throw new Error("Neplatné km servisu.");
    const name =
      field(row.fields, "vservis_nazev").trim() ||
      row.cells[2]?.trim() ||
      "Název úkonu neuveden";
    const service: Service = {
      id: sid,
      vehicleId: v.id,
      date,
      km,
      total,
      workshop: row.cells[3]?.trim() ?? "",
      note: field(row.fields, "vservis_popis").trim(),
      items: [
        {
          kind: "action",
          name,
          reason: "Důvod ve zdroji neuveden",
          price: null,
        },
      ],
      attachmentId: null,
      pendingPlanIds: [],
      source: {
        system: "moje-autoskola",
        id: row.sourceId,
        capturedAt: snap.servicesCapturedAt ?? snap.capturedAt,
        label: row.cells[2],
        vehicleMatchedByLabel: matchedByLabel,
      },
    };
    s.services.push(service);
    services++;
    if (km !== null)
      importedReadings.push({
        id: "ma-reading:service:" + row.sourceId,
        source: "service:" + sid,
        vehicleId: v.id,
        date,
        km,
        owner,
        status: "conflict",
      });
  }
  const fuelSourceIds = new Set<string>();
  for (const row of snap.fuels) {
    if (fuelSourceIds.has(row.sourceId))
      throw new Error("Duplicitní ID tankování ve zdroji.");
    fuelSourceIds.add(row.sourceId);
    const fid = "ma-fuel:" + row.sourceId;
    if (s.fuels.some((f) => f.id === fid)) continue;
    const f = row.fields,
      v = bySource.get(field(f, "tank_vozidlo"));
    if (!v) throw new Error("Tankování odkazuje na neznámé vozidlo.");
    const km = number(field(f, "tank_tachometr"))!,
      liters = number(field(f, "tank_litry"))!,
      amount = number(field(f, "tank_cena"), true),
      date = sourceDate(field(f, "tank_datum"));
    if (!Number.isInteger(km) || !liters || amount === 0)
      throw new Error("Neplatné tankování " + row.sourceId);
    if (!Array.isArray(f.tank_plna))
      throw new Error("Chybí informace o plné nádrži.");
    const fuel: Fuel = {
      id: fid,
      vehicleId: v.id,
      owner,
      date,
      km,
      liters,
      amount,
      full: f.tank_plna.includes("1"),
      code: "MA-" + row.sourceId,
      checked: false,
      receipt: "missing",
      attachmentId: null,
      correction: "",
      reliable: false,
      source: {
        system: "moje-autoskola",
        id: row.sourceId,
        capturedAt: snap.capturedAt,
        teacherId: field(f, "tank_ucitel"),
        teacherName: row.teacherName,
      },
    };
    s.fuels.push(fuel);
    fuels++;
    importedReadings.push({
      id: "ma-reading:fuel:" + row.sourceId,
      source: fid,
      vehicleId: v.id,
      date,
      km,
      owner,
      status: "conflict",
    });
  }
  const dateIndex = snap.readings.headers.indexOf("Datum tankování"),
    vehicleIndex = snap.readings.headers.indexOf("Vozidlo"),
    kmIndex = snap.readings.headers.indexOf("Tachometr");
  if ([dateIndex, vehicleIndex, kmIndex].some((i) => i < 0))
    throw new Error("Změněné sloupce výpisu km.");
  const fuelIds = new Set(snap.fuels.map((f) => f.sourceId));
  for (const row of snap.readings.rows) {
    if (row.sourceId && fuelIds.has(row.sourceId)) continue;
    const v = byLabel.get(row.cells[vehicleIndex]?.replace(/\s+/g, " ").trim());
    if (!v) throw new Error("Nespárované vozidlo v odečtech.");
    const date = sourceDate(row.cells[dateIndex]),
      km = number(row.cells[kmIndex])!;
    if (!Number.isInteger(km)) throw new Error("Neplatné km.");
    const key =
      "ma-odometer:" +
      (row.sourceId ??
        createHash("sha256")
          .update(v.id + "|" + date + "|" + km)
          .digest("hex"));
    if (!s.readings.some((r) => r.source === key))
      importedReadings.push({
        id: key,
        source: key,
        vehicleId: v.id,
        date,
        km,
        owner,
        status: "conflict",
      });
  }
  // Evaluate all observations symmetrically. Never choose an arbitrary winner for
  // conflicting days or assume an order within a day when no time is provided.
  const removedSources = new Set(
    (s.deletedReadings ?? []).map((x) => x.reading.source),
  );
  const candidates = [
    ...s.readings.filter((r) => r.status === "accepted"),
    ...importedReadings
      .filter((r) => !removedSources.has(r.source))
      .map((r) => ({ ...r, status: "accepted" as const })),
  ];
  for (const r of importedReadings.filter(
    (r) => !removedSources.has(r.source),
  )) {
    r.status = chronological(
      candidates.filter((c) => c.id !== r.id),
      r.vehicleId,
      r.date,
      r.km,
    )
      ? "accepted"
      : "conflict";
    s.readings.push(r);
    readings++;
    const f = s.fuels.find((f) => f.id === r.source);
    if (f) f.reliable = r.status === "accepted";
  }
  const conflicts = s.readings.filter((r) => r.status === "conflict").length,
    missingPrices = s.fuels.filter((f) => f.amount === null).length;
  if (conflicts)
    warnings.push(
      `${conflicts} odečtů má rozpornou chronologii (včetně různých km ve stejný den bez času); vyžaduje kontrolu správce.`,
    );
  if (missingPrices)
    warnings.push(
      `${missingPrices} tankování nemá ve zdroji cenu; cena nebyla nahrazena nulou ani odhadem a průměr je u neúplných výběrů nedostupný.`,
    );
  warnings.push(
    "Tachometry z přehledu vozidel nemají datum odečtu. Jsou zachovány odděleně a neaktualizují datovaný stav.",
  );
  warnings.push(
    "Provozní dostupnost, převzetí dokladů ani správnost tankování nebyly importem potvrzeny. Servisní plány se importem historie automaticky nemění.",
  );
  const missingServicePrices = s.services.filter(
    (r) => r.total === null && r.items.some((i) => i.price === null),
  ).length;
  if (missingServicePrices)
    warnings.push(
      `${missingServicePrices} servisních záznamů nemá úplnou cenu; náklady jsou neúplné.`,
    );
  s.dataset = {
    kind: "imported",
    source: snap.source,
    importedAt: new Date().toISOString(),
    capturedAt: snap.capturedAt,
    sourceHash: hash,
    period: snap.period,
    warnings,
    servicesCapturedAt:
      snap.servicesCapturedAt ?? existing?.dataset?.servicesCapturedAt,
  };
  s.audit.push({
    id: "ma-batch:" + hash,
    actor: owner,
    at: new Date().toISOString(),
    entity: "import",
    entityId: hash,
    before: null,
    after: {
      vehicles,
      fuels,
      readings,
      conflicts,
      missingPrices,
      sourceHash: hash,
      services,
      missingServicePrices,
    },
  });
  return {
    state: s,
    report: {
      unchanged: false,
      vehicles,
      fuels,
      readings,
      conflicts,
      missingPrices,
      services,
      missingServicePrices,
    },
  };
}
