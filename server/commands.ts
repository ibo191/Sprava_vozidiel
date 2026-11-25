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
  insurancePayoutSchema,
  type State,
  type User,
  type Service,
} from "../src/domain.ts";
import { HttpError } from "./http-error.ts";
import { parseAttachment } from "./attachments.ts";
import { canonicalEntry, itemOperation, itemKey } from "../src/catalog.ts";
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
  } else if (action === "vehicle.stk") {
    requireManager();
    const b = z
      .object({
        id: z.string(),
        stkValidUntil: dateSchema.nullable(),
        stkLeadDays: z.number().int().min(0).max(365),
      })
      .parse(payload);
    const v = vehicle(b.id),
      before = structuredClone(v);
    v.stkValidUntil = b.stkValidUntil;
    v.stkLeadDays = b.stkLeadDays;
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
  } else if (action === "vehicle.clearUndatedKm") {
    requireManager();
    const b = z
      .object({ id: z.string(), reason: z.string().trim().min(3).max(1000) })
      .parse(payload);
    const v = vehicle(b.id);
    assert(
      v.source?.undatedKm != null,
      "Nedatovaný stav km už není evidován.",
      404,
    );
    const before = structuredClone(v);
    v.source!.undatedKm = null;
    audit("vehicle", v.id, before, { ...v, reason: b.reason });
  } else if (action === "reading.delete") {
    requireManager();
    const b = z
      .object({ id: z.string(), reason: z.string().trim().min(3).max(1000) })
      .parse(payload);
    const r = s.readings.find((r) => r.id === b.id);
    assert(r, "Odpočet neexistuje.", 404);
    (s.deletedReadings ??= []).push({
      reading: structuredClone(r),
      deletedAt: new Date().toISOString(),
      deletedBy: u.id,
      reason: b.reason,
    });
    s.readings = s.readings.filter((x) => x.id !== r.id);
    const fuel = s.fuels.find((f) => f.id === r.source);
    if (fuel) {
      const prior = structuredClone(fuel);
      fuel.readingExcluded = true;
      fuel.reliable = false;
      audit("fuel", fuel.id, prior, fuel);
    }
    const service = s.services.find((x) => "service:" + x.id === r.source);
    if (service) {
      const prior = structuredClone(service);
      service.readingExcluded = true;
      service.revision = (service.revision ?? 0) + 1;
      audit("service", service.id, prior, service);
    }
    for (const p of s.plans)
      if (
        p.vehicleId === r.vehicleId &&
        ((!!service && p.lastServiceId === service.id) ||
          (p.lastDate === r.date && p.lastKm === r.km))
      ) {
        const prior = structuredClone(p);
        p.reviewServiceId = service?.id ?? "reading:" + r.id;
        audit("plan", p.id, prior, p);
      }
    audit("reading", r.id, r, { deleted: true, reason: b.reason });
  } else if (action === "reading.restore") {
    requireManager();
    const b = z.object({ id: z.string() }).parse(payload);
    const entry = s.deletedReadings?.find((x) => x.reading.id === b.id);
    assert(entry, "Smazaný odpočet nenalezen.", 404);
    const r = structuredClone(entry.reading);
    assert(
      !s.readings.some(
        (x) => x.source === r.source && x.vehicleId === r.vehicleId,
      ),
      "Zdroj už má novější odpočet. Smazaný údaj nelze obnovit.",
      409,
    );
    r.status = chronological(s.readings, r.vehicleId, r.date, r.km, r.source)
      ? "accepted"
      : "conflict";
    s.readings.push(r);
    s.deletedReadings = s.deletedReadings!.filter((x) => x !== entry);
    const fuel = s.fuels.find((f) => f.id === r.source);
    if (fuel) {
      const before = structuredClone(fuel);
      delete fuel.readingExcluded;
      fuel.reliable = r.status === "accepted";
      audit("fuel", fuel.id, before, fuel);
    }
    const service = s.services.find((x) => "service:" + x.id === r.source);
    if (service) {
      const before = structuredClone(service);
      delete service.readingExcluded;
      service.revision = (service.revision ?? 0) + 1;
      audit("service", service.id, before, service);
    }
    audit("reading", r.id, { deleted: true }, r);
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
  } else if (action === "plan.delete") {
    requireManager();
    const b = z
      .object({ id: z.string(), reason: z.string().trim().min(3).max(1000) })
      .parse(payload);
    const p = s.plans.find((p) => p.id === b.id);
    assert(p, "Servisní plán neexistuje.", 404);
    const deleted = {
      plan: structuredClone(p),
      deletedAt: new Date().toISOString(),
      deletedBy: u.id,
      reason: b.reason,
      pendingServiceIds: s.services
        .filter((r) => r.pendingPlanIds.includes(p.id))
        .map((r) => r.id),
    };
    (s.deletedPlans ??= []).push(deleted);
    s.plans = s.plans.filter((x) => x.id !== p.id);
    for (const r of s.services)
      r.pendingPlanIds = r.pendingPlanIds.filter((id) => id !== p.id);
    audit("plan", p.id, p, { deleted: true, reason: b.reason });
  } else if (action === "plan.restore") {
    requireManager();
    const b = z.object({ id: z.string() }).parse(payload);
    const saved = s.deletedPlans?.find((x) => x.plan.id === b.id);
    assert(saved, "Smazaný plán nenalezen.", 404);
    assert(!s.plans.some((p) => p.id === b.id), "Plán už existuje.", 409);
    s.plans.push(saved.plan);
    const linked = s.services.find((r) => r.id === saved.plan.lastServiceId);
    if (
      linked &&
      (linked.date !== saved.plan.lastDate ||
        linked.km !== saved.plan.lastKm ||
        linked.readingExcluded)
    )
      saved.plan.reviewServiceId = linked.id;
    for (const id of saved.pendingServiceIds) {
      const r = s.services.find((r) => r.id === id);
      if (
        r &&
        r.vehicleId === saved.plan.vehicleId &&
        r.items.some(
          (i) =>
            canonicalEntry(s, i.kind, i.name).id ===
            canonicalEntry(
              s,
              saved.plan.catalogKind ?? "action",
              saved.plan.action,
            ).id,
        ) &&
        !r.pendingPlanIds.includes(b.id)
      )
        r.pendingPlanIds.push(b.id);
    }
    s.deletedPlans = s.deletedPlans!.filter((x) => x !== saved);
    audit("plan", b.id, { deleted: true }, saved.plan);
  } else if (action === "plan.save") {
    requireManager();
    const b = planSchema.parse(payload);
    vehicle(b.vehicleId);
    const existing = s.plans.find((p) => p.id === payload.id);
    if (payload.id)
      assert(
        existing,
        "Plán byl smazán nebo neexistuje. Obnovte evidenci.",
        409,
      );
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
        insuranceCase: z.boolean().optional(),
        insurancePayout: insurancePayoutSchema.optional(),
      })
      .parse(payload);
    const i = s.issues.find((i) => i.id === b.id);
    assert(i, "Závada nenalezena.");
    const insured = b.insuranceCase ?? i.insuranceCase ?? false;
    const payout =
      b.insurancePayout === undefined
        ? (i.insurancePayout ?? null)
        : b.insurancePayout;
    assert(
      insured || payout === null,
      "Plnění lze evidovat pouze u pojistné události.",
    );
    if (b.serviceId)
      assert(
        s.services.some(
          (s) => s.id === b.serviceId && s.vehicleId === i.vehicleId,
        ),
        "Servis musí patřit stejnému vozidlu.",
      );
    audit("issue", i.id, { ...i }, b);
    Object.assign(i, b, { insuranceCase: insured, insurancePayout: payout });
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
    b.items = b.items.map((item) => {
      const entry = canonicalEntry(s, item.kind, item.name);
      const prior =
        existing?.items.find(
          (old) =>
            canonicalEntry(s, old.kind, old.name).id === entry.id &&
            (old.name === item.name || old.originalName === item.name),
        ) ??
        existing?.items.find(
          (old) => canonicalEntry(s, old.kind, old.name).id === entry.id,
        );
      return {
        ...item,
        kind: entry.kind,
        name: entry.name,
        catalogId: entry.id,
        originalName:
          prior?.originalName ??
          (prior && prior.name !== entry.name
            ? prior.name
            : item.name !== entry.name
              ? item.name
              : undefined),
        originalKind:
          prior?.originalKind ??
          (item.kind !== entry.kind ? item.kind : undefined),
        operation: item.operation ?? itemOperation(prior ?? item),
      };
    });
    const matches = s.plans
      .filter(
        (p) =>
          p.vehicleId === b.vehicleId &&
          b.items.some(
            (i) =>
              canonicalEntry(s, i.kind, i.name).id ===
              canonicalEntry(s, p.catalogKind ?? "action", p.action).id,
          ),
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
            .map((i) => canonicalEntry(s, i.kind, i.name).id)
            .sort(),
        ) !==
          JSON.stringify(
            b.items.map((i) => canonicalEntry(s, i.kind, i.name).id).sort(),
          ));
    const service: Service = existing ?? {
      id: id(),
      ...b,
      pendingPlanIds: matches,
    };
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
    if (payload.restoreReading === true && service.readingExcluded) {
      delete service.readingExcluded;
      s.deletedReadings = s.deletedReadings?.filter(
        (x) => x.reading.source !== "service:" + service.id,
      );
    }
    if (
      (!existing || basisChanged || payload.restoreReading === true) &&
      !service.readingExcluded
    ) {
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
    if (payload.followUps !== undefined) {
      const followUps = z
        .array(
          z.object({
            itemIndex: z.number().int().nonnegative(),
            planId: z.string().nullable().optional(),
            intervalKm: z.number().int().positive().nullable(),
            intervalMonths: z.number().int().positive().max(240).nullable(),
            nextDate: dateSchema.nullable(),
            nextKm: z.number().int().nonnegative().nullable(),
            leadKm: z.number().int().nonnegative(),
            leadDays: z.number().int().nonnegative(),
            responsible: z.string().trim().min(1).max(500),
          }),
        )
        .max(50)
        .parse(payload.followUps);
      const used = new Set<string>();
      for (const follow of followUps) {
        const item = service.items[follow.itemIndex];
        assert(item, "Položka dalšího servisu neexistuje.");
        const entry = canonicalEntry(s, item.kind, item.name);
        assert(
          !used.has(entry.id),
          "Pro stejný úkon či díl zadejte jen jeden další servis.",
        );
        used.add(entry.id);
        const old = follow.planId
          ? s.plans.find((p) => p.id === follow.planId)
          : undefined;
        if (follow.planId)
          assert(
            old &&
              old.vehicleId === service.vehicleId &&
              canonicalEntry(s, old.catalogKind ?? "action", old.action).id ===
                entry.id,
            "Vybraný plán neodpovídá vozidlu a položce.",
          );
        if (!old)
          assert(
            !s.plans.some(
              (p) =>
                p.vehicleId === service.vehicleId &&
                canonicalEntry(s, p.catalogKind ?? "action", p.action).id ===
                  entry.id,
            ),
            "Pro tuto položku již existuje plán. Vyberte aktualizaci existujícího plánu.",
            409,
          );
        const reading = s.readings.find(
          (r) =>
            r.source === "service:" + service.id && r.status === "accepted",
        );
        const baseKm = reading?.km ?? null;
        const draft = planSchema.parse({
          vehicleId: service.vehicleId,
          action: entry.name,
          responsible: follow.responsible,
          lastDate: service.date,
          lastKm: baseKm,
          intervalKm: follow.intervalKm,
          intervalMonths: follow.intervalMonths,
          nextDate: follow.nextDate,
          nextKm: follow.nextKm,
          leadKm: follow.leadKm,
          leadDays: follow.leadDays,
          booking: null,
        });
        if (draft.nextDate)
          assert(
            draft.nextDate > service.date,
            "Další datum musí následovat po servisu.",
          );
        if (draft.nextKm !== null && baseKm !== null)
          assert(
            draft.nextKm > baseKm,
            "Další km musí být vyšší než km servisu.",
          );
        const prior = old ? structuredClone(old) : null;
        const plan = {
          id: old?.id ?? id(),
          ...draft,
          lastServiceId: service.id,
          catalogKind: entry.kind,
        };
        const missingKm =
          draft.intervalKm !== null && baseKm === null && draft.nextKm === null;
        if (old && missingKm) {
          // Preserve the known deadline until the new service has a reliable km baseline.
          old.reviewServiceId = service.id;
        } else if (old) {
          assert(
            !old.lastDate || service.date >= old.lastDate,
            "Historický servis nesmí přepsat novější základ plánu.",
          );
          assert(
            old.lastKm === null || baseKm === null || baseKm >= old.lastKm,
            "Servis nesmí snížit km základu plánu.",
          );
          Object.assign(old, plan);
          delete old.reviewServiceId;
        } else s.plans.push(plan);
        if (missingKm) {
          if (!service.pendingPlanIds.includes(plan.id))
            service.pendingPlanIds.push(plan.id);
        } else
          service.pendingPlanIds = service.pendingPlanIds.filter(
            (x) => x !== plan.id,
          );
        audit("plan", plan.id, prior, old ?? plan);
      }
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
      !service.readingExcluded || b.lastKm === null,
      "Odpočet tohoto servisu byl vyřazen. Nejdříve jej opravte a obnovte, nebo potvrďte pouze časový plán bez km.",
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
