import { z } from "zod";
export type Role = "teacher" | "manager" | "admin";
export type SourceRef = {
  system: "moje-autoskola";
  id: string;
  capturedAt: string;
  label?: string;
  undatedKm?: number | null;
  teacherName?: string;
  teacherId?: string;
  availabilityVerified?: boolean;
  vehicleMatchedByLabel?: boolean;
};
export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
};
export type Vehicle = {
  id: string;
  brand: string;
  model: string;
  year: number;
  plate: string;
  kind: "car" | "motorcycle" | "trailer";
  active: boolean;
  unavailable: boolean;
  source?: SourceRef;
  retirement?: { date: string; reason: string; actor: string };
};
export type Reading = {
  id: string;
  vehicleId: string;
  date: string;
  km: number;
  owner: string;
  status: "accepted" | "conflict";
  source: string;
};
export type Plan = {
  id: string;
  vehicleId: string;
  action: string;
  responsible: string;
  lastDate: string | null;
  lastKm: number | null;
  nextDate: string | null;
  nextKm: number | null;
  intervalKm: number | null;
  intervalMonths: number | null;
  leadKm: number;
  leadDays: number;
  booking: string | null;
};
export type Fuel = {
  id: string;
  vehicleId: string;
  owner: string;
  date: string;
  km: number;
  liters: number;
  amount: number | null;
  full: boolean;
  code: string;
  checked: boolean;
  receipt: "missing" | "received" | "complete";
  attachmentId: string | null;
  correction: string;
  reliable: boolean;
  source?: SourceRef;
};
export type Issue = {
  reporterName?: string | null;
  reporterChannel?: "link" | "account";
  kind?: "fault" | "accident";
  id: string;
  vehicleId: string;
  owner: string | null;
  date: string;
  description: string;
  severity: "minor" | "serious";
  immobilize: boolean;
  status: "new" | "in_progress" | "needs_info" | "resolved";
  response: string;
  supplement: string;
  serviceId: string | null;
  attachmentId: string | null;
};
export type ServiceItem = {
  kind: "action" | "part";
  name: string;
  reason: string;
  price: number | null;
};
export type Service = {
  id: string;
  vehicleId: string;
  date: string;
  km: number | null;
  items: ServiceItem[];
  total: number | null;
  workshop: string;
  note: string;
  attachmentId: string | null;
  pendingPlanIds: string[];
  source?: SourceRef;
};
export type Audit = {
  id: string;
  actor: string | null;
  at: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
};
export type Attachment = {
  storagePath?: string;
  id: string;
  owner: string | null;
  name: string;
  mime: string;
  data: string;
};
export type State = {
  operationalAlerts?: Pick<
    Issue,
    | "id"
    | "vehicleId"
    | "date"
    | "description"
    | "severity"
    | "immobilize"
    | "status"
    | "response"
    | "kind"
  >[];
  dataset?: {
    kind: "imported";
    source: string;
    importedAt: string;
    capturedAt: string;
    sourceHash: string;
    period: { from: string; to: string };
    warnings: string[];
    servicesCapturedAt?: string;
  };
  users: User[];
  vehicles: Vehicle[];
  readings: Reading[];
  plans: Plan[];
  fuels: Fuel[];
  issues: Issue[];
  services: Service[];
  audit: Audit[];
  attachments: Attachment[];
};
export const manager = (u: User) => u.role === "manager" || u.role === "admin";
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const normalizePlate = (s: string) => s.replace(/\s/g, "").toUpperCase();
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Neplatné datum",
  );
const pastDate = dateSchema.refine(
  (s) => s <= today(),
  "Datum nesmí být v budoucnosti",
);
const text = z.string().trim().min(1).max(500);
const nullableKm = z.number().int().min(0).max(10000000).nullable();
export const vehicleSchema = z.object({
  brand: text,
  model: text,
  year: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 1),
  plate: text.transform(normalizePlate),
  kind: z.enum(["car", "motorcycle", "trailer"]),
  active: z.boolean(),
  unavailable: z.boolean(),
});
export const readingSchema = z.object({
  vehicleId: text,
  date: pastDate,
  km: z.number().int().min(0).max(10000000),
});
export const fuelSchema = readingSchema.extend({
  liters: z.number().positive().max(1000),
  amount: z.number().positive().max(1000000),
  full: z.boolean(),
  attachmentId: z.string().nullable(),
});
export const planSchema = z
  .object({
    vehicleId: text,
    action: text,
    responsible: text,
    lastDate: pastDate.nullable(),
    lastKm: nullableKm,
    nextDate: dateSchema.nullable(),
    nextKm: nullableKm,
    intervalKm: z.number().int().positive().nullable(),
    intervalMonths: z.number().int().positive().max(240).nullable(),
    leadKm: z.number().int().nonnegative(),
    leadDays: z.number().int().nonnegative(),
    booking: dateSchema.nullable(),
  })
  .refine(
    (p) => p.intervalKm || p.intervalMonths || p.nextDate || p.nextKm !== null,
    "Zadejte interval nebo příští limit",
  );
export const serviceSchema = z.object({
  vehicleId: text,
  date: pastDate,
  km: nullableKm,
  items: z
    .array(
      z.object({
        kind: z.enum(["action", "part"]),
        name: text,
        reason: text,
        price: z.number().nonnegative().nullable(),
      }),
    )
    .min(1),
  total: z.number().nonnegative().nullable(),
  workshop: text,
  note: z.string().max(3000),
  attachmentId: z.string().nullable(),
});
export const issueSchema = z.object({
  kind: z.enum(["fault", "accident"]).default("fault"),
  vehicleId: text,
  description: z.string().trim().min(5).max(3000),
  severity: z.enum(["minor", "serious"]),
  immobilize: z.boolean(),
  attachmentId: z.string().nullable(),
});
export function latestReading(s: Pick<State, "readings">, vehicleId: string) {
  return s.readings
    .filter((r) => r.vehicleId === vehicleId && r.status === "accepted")
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}
export function chronological(
  readings: Reading[],
  vehicleId: string,
  date: string,
  km: number,
  excludeSource?: string,
) {
  return !readings.some(
    (r) =>
      r.vehicleId === vehicleId &&
      r.status === "accepted" &&
      r.source !== excludeSource &&
      ((r.date < date && r.km > km) ||
        (r.date > date && r.km < km) ||
        (r.date === date && r.km !== km)),
  );
}
export type MileageProblem = {
  left: Reading;
  right: Reading;
  kind: "same_day" | "decrease";
  difference: number;
};
export type MileageConflictGroup = {
  id: string;
  vehicleId: string;
  readings: Reading[];
  problems: MileageProblem[];
};
export function mileageConflictGroups(
  readings: Reading[],
): MileageConflictGroup[] {
  const pending = readings.filter((r) => r.status === "conflict"),
    edges = new Map<string, MileageProblem>();
  const order = (a: Reading, b: Reading) =>
    a.date.localeCompare(b.date) || a.km - b.km || a.id.localeCompare(b.id);
  for (const r of pending)
    for (const other of readings) {
      if (r.id === other.id || r.vehicleId !== other.vehicleId) continue;
      const [left, right] = [r, other].sort(order);
      const sameDay = left.date === right.date && left.km !== right.km;
      if (!sameDay && !(left.date < right.date && left.km > right.km)) continue;
      edges.set([r.id, other.id].sort().join("|"), {
        left,
        right,
        kind: sameDay ? "same_day" : "decrease",
        difference: Math.abs(left.km - right.km),
      });
    }
  const seen = new Set<string>(),
    groups: MileageConflictGroup[] = [];
  for (const r of pending) {
    if (seen.has(r.id)) continue;
    const nodes = new Set([r.id]),
      queue = [r.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const p of edges.values())
        if (p.left.id === id || p.right.id === id) {
          for (const n of [p.left.id, p.right.id])
            if (!nodes.has(n)) {
              nodes.add(n);
              queue.push(n);
            }
        }
    }
    nodes.forEach((id) => seen.add(id));
    groups.push({
      id: [...nodes].sort().join("|"),
      vehicleId: r.vehicleId,
      readings: readings.filter((x) => nodes.has(x.id)).sort(order),
      problems: [...edges.values()].filter(
        (p) => nodes.has(p.left.id) && nodes.has(p.right.id),
      ),
    });
  }
  return groups.sort((a, b) =>
    b.readings.at(-1)!.date.localeCompare(a.readings.at(-1)!.date),
  );
}
export function addMonths(date: string, months: number) {
  const d = new Date(date + "T12:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function planStatus(p: Plan, reading?: Reading, at = today()) {
  const dueKm =
    p.nextKm ??
    (p.intervalKm && p.lastKm !== null ? p.lastKm + p.intervalKm : null);
  const dueDate =
    p.nextDate ??
    (p.intervalMonths && p.lastDate
      ? addMonths(p.lastDate, p.intervalMonths)
      : null);
  const days = dueDate
    ? Math.round((Date.parse(dueDate) - Date.parse(at)) / 86400000)
    : null;
  const km = dueKm !== null && reading ? dueKm - reading.km : null;
  const stale =
    !!dueKm &&
    (!reading || Date.parse(at) - Date.parse(reading.date) > 30 * 86400000);
  const incomplete =
    (p.intervalKm !== null && dueKm === null) ||
    (p.intervalMonths !== null && dueDate === null) ||
    (dueKm !== null && !reading) ||
    stale;
  // A known exceeded limit always wins, even when the other input is unknown or a visit is booked.
  const status =
    (days !== null && days <= 0) || (km !== null && km <= 0)
      ? "overdue"
      : incomplete
        ? "unknown"
        : (days !== null && days <= p.leadDays) ||
            (km !== null && km <= p.leadKm)
          ? "soon"
          : "ok";
  return { status, dueKm, dueDate, days, km, incomplete };
}
export const statusLabels: Record<string, string> = {
  overdue: "Po termínu",
  soon: "Blíží se",
  ok: "V pořádku",
  unknown: "Neúplné / staré údaje",
};
export function fuelAnalytics(rows: Fuel[]) {
  const sorted = [...rows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.km - b.km,
  );
  const liters = rows.reduce((s, r) => s + r.liters, 0),
    amount = rows.reduce((s, r) => s + (r.amount ?? 0), 0),
    missingPrices = rows.filter((r) => r.amount === null).length;
  let anchor: Fuel | undefined,
    volume = 0,
    distance = 0,
    used = 0;
  for (const r of sorted) {
    if (!r.reliable || !r.checked) {
      anchor = undefined;
      volume = 0;
      continue;
    }
    if (anchor && r.km <= anchor.km) {
      anchor = undefined;
      volume = 0;
    }
    if (anchor) volume += r.liters;
    if (r.full) {
      if (anchor) {
        distance += r.km - anchor.km;
        used += volume;
      }
      anchor = r;
      volume = 0;
    }
  }
  return {
    liters,
    amount,
    average: liters && !missingPrices ? amount / liters : null,
    missingPrices,
    consumption: distance > 0 ? (used / distance) * 100 : null,
    distance,
    explanation:
      "Spotřeba vyžaduje dvě zkontrolované plné nádrže, chronologické km a všechna mezitankování. Úplnost evidence musí potvrdit správce.",
  };
}
export function replacementIntervals(services: Service[], name: string) {
  const rows = services
    .filter((s) => s.items.some((i) => i.name === name))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 2) return null;
  return rows.slice(1).map((r, i) => ({
    days: (Date.parse(r.date) - Date.parse(rows[i].date)) / 86400000,
    km:
      r.km !== null && rows[i].km !== null && r.km >= rows[i].km!
        ? r.km - rows[i].km!
        : null,
  }));
}
