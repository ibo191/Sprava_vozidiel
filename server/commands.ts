import { z } from "zod";
import {
  manager,
  today,
  chronological,
  vehicleSchema,
  readingSchema,
  planSchema,
  serviceSchema,
  issueSchema,
  dateSchema,
  type State,
  type User,
} from "../src/domain.ts";
import { HttpError } from "./http-error.ts";
import { parseAttachment } from "./attachments.ts";
const id = () => crypto.randomUUID();
function assert(ok: unknown, message: string, status = 400): asserts ok {
  if (!ok) throw new HttpError(status, message);
}
function ownAttachment(s: State, u: User, aid: string | null) {
  if (aid)
    assert(
      s.attachments.some(
        (a) => a.id === aid && (a.owner === u.id || manager(u)),
      ),
      "Příloha není dostupná.",
      403,
    );
}
export function applyCommand(
  s: State,
  u: User,
  action: string,
  payload: any,
  hooks: {
    password: (id: string, password: string) => void;
    newUserId?: string;
  },
) {
  assert(u.active && manager(u), "Tato operace vyžaduje správce.", 403);
  assert(
    !["fuel.save", "fuel.review", "fuel.correction", "reading.save"].includes(
      action,
    ),
    "Tankování a provozní kilometry se přijímají pouze importem z Moje Autoškola.",
    403,
  );
  let result: unknown = { ok: true };
  const audit = (
    entity: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) =>
    s.audit.push({
      id: id(),
      actor: u.id,
      at: new Date().toISOString(),
      entity,
      entityId,
      before: structuredClone(before),
      after: structuredClone(after),
    });
  const requireManager = () =>
    assert(manager(u), "Tato operace vyžaduje správce.", 403);
  const vehicle = (vid: string) => {
    const v = s.vehicles.find((v) => v.id === vid);
    assert(v, "Vozidlo neexistuje.", 404);
    return v;
  };
  const addReading = (
    vid: string,
    date: string,
    km: number,
    source: string,
  ) => {
    const reliable = chronological(s.readings, vid, date, km, source);
    s.readings = s.readings.filter((r) => r.source !== source);
    s.readings.push({
      id: id(),
      vehicleId: vid,
      date,
      km,
      source,
      owner: u.id,
      status: reliable ? "accepted" : "conflict",
    });
    return reliable;
  };
  if (action === "vehicle.retire") {
    requireManager();
    const b = z
      .object({
        id: z.string(),
        date: dateSchema.refine(
          (d) => d <= today(),
          "Datum nesmí být v budoucnosti",
        ),
        reason: z.string().trim().min(3).max(1000),
      })
      .parse(payload);
    const v = vehicle(b.id);
    assert(v.active, "Vozidlo už je vyřazeno.");
    const before = structuredClone(v);
    v.active = false;
    v.retirement = { date: b.date, reason: b.reason, actor: u.id };
    audit("vehicle", v.id, before, v);
  } else if (action === "vehicle.save") {
    requireManager();
    const b = vehicleSchema.parse(payload);
    const existing = s.vehicles.find((v) => v.id === payload.id);
    assert(
      !s.vehicles.some((v) => v.plate === b.plate && v.id !== existing?.id),
      "Vozidlo s touto RZ již existuje.",
    );
    if (existing) {
      const before = structuredClone(existing);
      Object.assign(existing, b);
      if (existing.source && typeof payload.availabilityVerified === "boolean")
        existing.source.availabilityVerified = payload.availabilityVerified;
      audit("vehicle", existing.id, before, existing);
    } else {
      const v = { id: id(), ...b };
      s.vehicles.push(v);
      audit("vehicle", v.id, null, v);
      if (payload.km !== null && payload.km !== undefined) {
        const r = readingSchema.parse({
          vehicleId: v.id,
          date: payload.date,
          km: payload.km,
        });
        addReading(v.id, r.date, r.km, "initial:" + v.id);
      } else
        assert(
          b.kind === "trailer",
          "U motorového vozidla zadejte počáteční km a datum.",
        );
    }
  } else if (action === "reading.resolve") {
    requireManager();
    const b = readingSchema.extend({ id: z.string() }).parse(payload);
    const r = s.readings.find((r) => r.id === b.id && r.status === "conflict");
    assert(r, "Rozpor nenalezen.");
    assert(r.vehicleId === b.vehicleId, "Vozidlo nelze změnit.");
    assert(
      chronological(s.readings, b.vehicleId, b.date, b.km, r.source),
      "Opravený údaj stále odporuje chronologii.",
    );
    audit("reading", r.id, { ...r }, b);
    Object.assign(r, { date: b.date, km: b.km, status: "accepted" });
    const f = s.fuels.find((f) => f.id === r.source);
    if (f) {
      audit("fuel", f.id, { ...f }, b);
      Object.assign(f, { date: b.date, km: b.km, reliable: true });
    }
  } else if (action === "plan.save") {
    requireManager();
    const b = planSchema.parse(payload);
    vehicle(b.vehicleId);
    const existing = s.plans.find((p) => p.id === payload.id);
    const p = { id: existing?.id ?? id(), ...b };
    audit("plan", p.id, existing ?? null, p);
    if (existing) {
      Object.assign(existing, p);
      delete existing.reviewServiceId;
      delete existing.lastServiceId;
    } else s.plans.push(p);
  } else if (action === "issue.save") {
    const b = issueSchema.parse(payload);
    const v = vehicle(b.vehicleId);
    assert(v.active, "Vozidlo je neaktivní.");
    ownAttachment(s, u, b.attachmentId);
    assert(
      !b.immobilize || b.severity === "serious",
      "Odstavení vyžaduje vážnou závadu.",
    );
    const issue = {
      ...b,
      id: id(),
      owner: u.id,
      date: today(),
      status: "new" as const,
      response: "",
      supplement: "",
      serviceId: null,
    };
    s.issues.push(issue);
    if (b.immobilize) {
      audit("vehicle", v.id, { ...v }, { ...v, unavailable: true });
      v.unavailable = true;
    }
    audit("issue", issue.id, null, issue);
    result = issue;
  } else if (action === "issue.review") {
    requireManager();
    const b = z
      .object({
        id: z.string(),
        status: z.enum(["new", "in_progress", "needs_info", "resolved"]),
        response: z.string().max(3000),
        serviceId: z.string().nullable(),
      })
      .parse(payload);
    const i = s.issues.find((i) => i.id === b.id);
    assert(i, "Závada nenalezena.");
    if (b.serviceId)
      assert(
        s.services.some(
          (s) => s.id === b.serviceId && s.vehicleId === i.vehicleId,
        ),
        "Servis musí patřit stejnému vozidlu.",
      );
    audit("issue", i.id, { ...i }, b);
    Object.assign(i, b);
  } else if (action === "issue.supplement") {
    const b = z
      .object({
        id: z.string(),
        supplement: z.string().trim().min(3).max(3000),
      })
      .parse(payload);
    const i = s.issues.find((i) => i.id === b.id);
    assert(
      i && (i.owner === u.id || manager(u)),
      "Hlásení není dostupné.",
      403,
    );
    audit("issue", i.id, { ...i }, b);
    i.supplement = b.supplement;
    i.status = "new";
  } else if (action === "service.save" || action === "service.update") {
    requireManager();
    const b = serviceSchema.parse(payload);
    vehicle(b.vehicleId);
    ownAttachment(s, u, b.attachmentId);
    const existing =
      action === "service.update"
        ? s.services.find((r) => r.id === z.string().min(1).parse(payload.id))
        : undefined;
    if (action === "service.update") {
      assert(existing, "Servisní záznam neexistuje.", 404);
      const revision = z
        .number()
        .int()
        .nonnegative()
        .parse(payload.expectedRevision);
      assert(
        revision === (existing.revision ?? 0),
        "Servis mezitím upravil jiný správce. Zavřete formulář, obnovte evidenci a otevřete jej znovu.",
        409,
      );
      assert(
        existing.vehicleId === b.vehicleId ||
          !s.issues.some((i) => i.serviceId === existing.id),
        "Servis je propojen s hlášením závady. Nejprve zrušte propojení, potom změňte vozidlo.",
      );
    }
    const matches = s.plans
      .filter(
        (p) =>
          p.vehicleId === b.vehicleId &&
          b.items.some((i) => i.kind === "action" && i.name === p.action),
      )
      .map((p) => p.id);
    const before = existing ? structuredClone(existing) : null;
    const basisChanged =
      !!existing &&
      (existing.date !== b.date ||
        existing.km !== b.km ||
        existing.vehicleId !== b.vehicleId ||
        JSON.stringify(
          existing.items
            .filter((i) => i.kind === "action")
            .map((i) => i.name)
            .sort(),
        ) !==
          JSON.stringify(
            b.items
              .filter((i) => i.kind === "action")
              .map((i) => i.name)
              .sort(),
          ));
    const service = existing ?? { id: id(), ...b, pendingPlanIds: matches };
    if (existing) {
      Object.assign(service, b, {
        revision: (existing.revision ?? 0) + 1,
        editedAt: new Date().toISOString(),
        editedBy: u.id,
      });
      service.pendingPlanIds = basisChanged ? matches : existing.pendingPlanIds;
      if (basisChanged)
        for (const p of s.plans) {
          const lastAudit = s.audit.findLast(
            (a) => a.entity === "plan" && a.entityId === p.id,
          );
          const linked =
            p.lastServiceId === service.id ||
            (!p.lastServiceId &&
              (lastAudit?.after as { serviceId?: string } | null)?.serviceId ===
                service.id);
          if (linked) {
            const prior = structuredClone(p);
            p.reviewServiceId = service.id;
            audit("plan", p.id, prior, p);
          }
        }
    } else s.services.push(service);
    if (!existing || basisChanged) {
      const source = "service:" + service.id;
      const previous = s.readings.find((r) => r.source === source);
      const readingBefore = previous ? structuredClone(previous) : null;
      s.readings = s.readings.filter((r) => r.source !== source);
      if (b.km !== null) {
        addReading(b.vehicleId, b.date, b.km, source);
        if (previous) s.readings.at(-1)!.id = previous.id;
      }
      const readingAfter = s.readings.find((r) => r.source === source) ?? null;
      if (existing && (readingBefore || readingAfter))
        audit(
          "reading",
          readingAfter?.id ?? readingBefore!.id,
          readingBefore,
          readingAfter,
        );
    }
    audit("service", service.id, before, service);
    result = service;
  } else if (action === "service.confirm") {
    requireManager();
    const b = z
      .object({
        serviceId: z.string(),
        planId: z.string(),
        lastDate: dateSchema,
        lastKm: z.number().int().nonnegative().nullable(),
        nextDate: dateSchema.nullable().optional(),
        nextKm: z.number().int().nonnegative().nullable().optional(),
      })
      .parse(payload);
    assert(b.lastDate <= today(), "Servis nemůže být v budoucnosti.");
    const service = s.services.find((s) => s.id === b.serviceId),
      p = s.plans.find((p) => p.id === b.planId);
    assert(
      service &&
        p &&
        service.pendingPlanIds.includes(p.id) &&
        p.vehicleId === service.vehicleId,
      "Návrh aktualizace neexistuje.",
    );
    assert(
      p.intervalKm === null || b.lastKm !== null,
      "Chybí km: plán ponechte k doplnění.",
    );
    assert(
      p.intervalKm !== null ||
        p.intervalMonths !== null ||
        b.nextDate ||
        b.nextKm != null,
      "Plán nemá opakovací interval. Zadejte další datum nebo km; bez podkladu zůstane návrh k doplnění.",
    );
    assert(
      !b.nextDate || b.nextDate > b.lastDate,
      "Příští termín musí následovat po provedeném servisu.",
    );
    assert(
      b.nextKm == null || b.lastKm === null || b.nextKm > b.lastKm,
      "Příští km musí být vyšší než km servisu.",
    );
    assert(
      !p.lastDate || b.lastDate >= p.lastDate,
      "Historický servis nesmí přepsat novější základ plánu.",
    );
    assert(
      p.lastKm === null || b.lastKm === null || b.lastKm >= p.lastKm,
      "Historické km nesmí snížit základ plánu.",
    );
    assert(
      b.lastKm === null ||
        chronological(s.readings, p.vehicleId, b.lastDate, b.lastKm),
      "Základ plánu odporuje chronologii km.",
    );
    audit("plan", p.id, { ...p }, b);
    Object.assign(p, {
      lastServiceId: service.id,
      lastDate: b.lastDate,
      lastKm: b.lastKm,
      nextDate: b.nextDate ?? null,
      nextKm: b.nextKm ?? null,
    });
    delete p.reviewServiceId;
    service.pendingPlanIds = service.pendingPlanIds.filter(
      (pid) => pid !== p.id,
    );
  } else if (action === "user.save") {
    assert(u.role === "admin", "Pouze admin může spravovat uživatele.", 403);
    const b = z
      .object({
        name: z.string().trim().min(2).max(100),
        email: z
          .string()
          .email()
          .transform((s) => s.toLowerCase()),
        role: z.enum(["manager", "admin"]),
        active: z.boolean(),
      })
      .parse(payload);
    assert(
      !s.users.some((x) => x.email === b.email && x.id !== payload.id),
      "E-mail je již použit.",
    );
    const old = s.users.find((x) => x.id === payload.id);
    assert(
      old?.id !== "ma-import",
      "Technický vlastník importu se nesmí změnit na přihlašovací účet.",
    );
    assert(
      !(
        old?.role === "admin" &&
        (!b.active || b.role !== "admin") &&
        s.users.filter((x) => x.role === "admin" && x.active).length === 1
      ),
      "Posledního aktivního admina nelze odebrat.",
    );
    const row = { id: old?.id ?? hooks.newUserId ?? id(), ...b };
    audit("user", row.id, old ?? null, row);
    if (old) Object.assign(old, row);
    else {
      const password = z.string().min(12).max(200).parse(payload.password);
      s.users.push(row);
      hooks.password(row.id, password);
    }
  } else if (action === "attachment.upload") {
    const b = parseAttachment(payload);
    const a = { id: id(), owner: u.id, ...b };
    s.attachments.push(a);
    result = { id: a.id };
  } else throw new HttpError(404, "Neznámá operace.");

  return result;
}
