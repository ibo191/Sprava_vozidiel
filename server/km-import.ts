import { z } from "zod";
import {
  chronological,
  dateSchema,
  today,
  normalizePlate,
  type State,
  type Reading,
} from "../src/domain.ts";
import { HttpError } from "./http-error.ts";
export const kmSnapshotSchema = z.object({
  source: z.literal("Moje Autoškola"),
  capturedAt: z.string().datetime(),
  readings: z
    .array(
      z.object({
        vehicleSourceId: z.string().regex(/^\d+$/),
        plate: z.string().optional(),
        sourceType: z.enum(["fuel", "trip"]),
        sourceId: z.string().regex(/^\d+$/),
        date: dateSchema.refine(
          (d) => d <= today(),
          "Odpočet nesmí být v budoucnosti",
        ),
        km: z.number().int().nonnegative().max(10000000),
        sourceTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
      }),
    )
    .max(500),
});
export function importCurrentKm(
  s: State,
  input: unknown,
  vehicleIds: string[],
) {
  const data = kmSnapshotSchema.parse(input),
    allowed = new Set(vehicleIds),
    added: Reading[] = [],
    warnings: string[] = [];
  let skipped = 0,
    unmatched = 0;
  const covered = new Set<string>();
  const deleted = new Set(
    (s.deletedReadings ?? []).map((x) => x.reading.source),
  );
  for (const row of data.readings) {
    let v = s.vehicles.find(
      (v) =>
        v.source?.system === "moje-autoskola" &&
        v.source.id === row.vehicleSourceId,
    );
    if (!v && row.plate) {
      const matches = s.vehicles.filter(
        (v) => normalizePlate(v.plate) === normalizePlate(row.plate!),
      );
      if (matches.length === 1) v = matches[0];
    }
    if (!v || !allowed.has(v.id) || !v.active) {
      unmatched++;
      continue;
    }
    const source =
      row.sourceType === "fuel"
        ? "ma-fuel:" + row.sourceId
        : "ma-trip:" + row.sourceId;
    if (deleted.has(source)) {
      skipped++;
      continue;
    }
    covered.add(v.id);
    const old = s.readings.find((r) => r.source === source);
    if (old) {
      if (old.date !== row.date || old.km !== row.km)
        warnings.push(
          `${v.plate}: zdroj ${source} se liší od již uloženého odpočtu; místní oprava nebyla přepsána.`,
        );
      skipped++;
      continue;
    }
    const duplicate = added.find((r) => r.source === source);
    if (duplicate) {
      if (duplicate.km !== row.km || duplicate.date !== row.date)
        throw new HttpError(
          400,
          "Zdroj vrátil dvě různé hodnoty stejného záznamu.",
        );
      continue;
    }
    const r: Reading = {
      id: crypto.randomUUID(),
      vehicleId: v.id,
      date: row.date,
      km: row.km,
      owner: "ma-import",
      status: "accepted",
      source,
    };
    added.push(r);
  }
  const candidates = [
    ...s.readings.filter((r) => r.status === "accepted"),
    ...added,
  ];
  for (const r of added) {
    r.status = chronological(
      candidates.filter((x) => x.id !== r.id),
      r.vehicleId,
      r.date,
      r.km,
      r.source,
    )
      ? "accepted"
      : "conflict";
    s.readings.push(r);
  }
  return {
    added: added.length,
    conflicts: added.filter((r) => r.status === "conflict").length,
    skipped,
    unmatched,
    vehiclesWithReadings: covered.size,
    missingVehicles: vehicleIds.filter((id) => !covered.has(id)).length,
    warnings: [...new Set(warnings)],
    capturedAt: data.capturedAt,
  };
}
export function claimKmJob(s: State) {
  const now = Date.now();
  if (!s.kmWorker) throw new HttpError(403, "Importér není spárovaný.");
  s.kmWorker.lastSeen = new Date(now).toISOString();
  const job = s.kmImports?.find(
    (j) =>
      j.status === "queued" ||
      (j.status === "running" && Date.parse(j.leaseUntil ?? "") < now),
  );
  if (!job) return null;
  job.status = "running";
  job.lease = crypto.randomUUID();
  job.leaseUntil = new Date(now + 10 * 60000).toISOString();
  job.startedAt = new Date(now).toISOString();
  return {
    id: job.id,
    lease: job.lease,
    source: job.source,
    vehicles: s.vehicles
      .filter((v) => job.vehicleIds.includes(v.id) && v.active)
      .map((v) => ({
        id: v.id,
        sourceId: v.source?.id ?? null,
        plate: v.plate,
      })),
  };
}
export function completeKmJob(s: State, input: unknown) {
  const b = z
    .object({
      id: z.string().uuid(),
      lease: z.string().uuid(),
      snapshot: z.unknown().optional(),
      error: z.string().max(1500).optional(),
    })
    .parse(input);
  const job = s.kmImports?.find((j) => j.id === b.id);
  if (
    !job ||
    job.status !== "running" ||
    job.lease !== b.lease ||
    Date.parse(job.leaseUntil ?? "") < Date.now()
  )
    throw new HttpError(409, "Požadavek importu vypršel nebo byl dokončen.");
  if (b.error) {
    job.status = "error";
    job.error = b.error;
  } else {
    const snapshot = kmSnapshotSchema.parse(b.snapshot);
    if (
      job.source !== "both" &&
      snapshot.readings.some((r) => r.sourceType !== job.source)
    )
      throw new HttpError(400, "Výsledek neodpovídá zvolenému zdroji km.");
    job.result = importCurrentKm(s, snapshot, job.vehicleIds);
    job.status = "done";
  }
  job.finishedAt = new Date().toISOString();
  delete job.lease;
  delete job.leaseUntil;
  if (s.kmWorker) s.kmWorker.lastSeen = job.finishedAt;
  s.audit.push({
    id: crypto.randomUUID(),
    actor: null,
    at: job.finishedAt,
    entity: "km-import",
    entityId: job.id,
    before: { status: "running" },
    after: structuredClone(job),
  });
  return { ok: true };
}
