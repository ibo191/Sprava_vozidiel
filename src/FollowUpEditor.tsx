import { canonicalEntry, itemKey } from "./catalog";
import type { State, ServiceItem } from "./domain";
export type FollowUp = {
  itemIndex: number;
  planId: string | null;
  intervalKm: number | null;
  intervalMonths: number | null;
  nextDate: string | null;
  nextKm: number | null;
  leadKm: number;
  leadDays: number;
  responsible: string;
};
export function FollowUpEditor({
  state: s,
  items,
  vehicleId,
  date,
  km,
  values,
  onChange,
  responsible,
}: {
  state: State;
  items: ServiceItem[];
  vehicleId: string;
  date: string;
  km: number | null;
  values: FollowUp[];
  onChange: (v: FollowUp[]) => void;
  responsible: string;
}) {
  const selected = (index: number) => values.find((x) => x.itemIndex === index);
  const update = (index: number, k: string, v: any) =>
    onChange(values.map((x) => (x.itemIndex === index ? { ...x, [k]: v } : x)));
  const seen = new Set<string>();
  return (
    <div className="follow-up-editor">
      <h3>Další servis a upozornění</h3>
      <p>
        Zaškrtněte položku, pro kterou chcete po uložení nastavit nebo
        aktualizovat plán. Termín se uloží až s celým servisem.
      </p>
      {items.map((item, index) => {
        if (!item.name.trim()) return null;
        const entry = canonicalEntry(s, item.kind, item.name);
        if (seen.has(entry.id)) return null;
        seen.add(entry.id);
        const plans = s.plans.filter(
          (p) =>
            p.vehicleId === vehicleId &&
            canonicalEntry(s, p.catalogKind ?? "action", p.action).id ===
              entry.id,
        );
        const v = selected(index),
          oil = itemKey(entry.name) === "vymena motoroveho oleje";
        return (
          <div className="follow-up-row" key={index}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!v}
                onChange={(e) => {
                  if (!e.target.checked) {
                    onChange(values.filter((x) => x.itemIndex !== index));
                    return;
                  }
                  const p = plans[0];
                  onChange([
                    ...values,
                    {
                      itemIndex: index,
                      planId: p?.id ?? null,
                      intervalKm: p?.intervalKm ?? (oil ? 15000 : null),
                      intervalMonths: p?.intervalMonths ?? null,
                      nextDate: null,
                      nextKm: null,
                      leadKm: p?.leadKm ?? 1000,
                      leadDays: p?.leadDays ?? 14,
                      responsible: p?.responsible ?? responsible,
                    },
                  ]);
                }}
              />
              {plans.length ? "Aktualizovat plán" : "Naplánovat další servis"}:{" "}
              {entry.name}
              {oil ? " · výchozí interval 15 000 km" : ""}
            </label>
            {v && (
              <div className="form-grid">
                <label>
                  Plán
                  <select
                    value={v.planId ?? ""}
                    onChange={(e) =>
                      update(index, "planId", e.target.value || null)
                    }
                  >
                    {!plans.length && (
                      <option value="">Vytvořit nový plán</option>
                    )}
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.action} · {p.responsible}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Interval km
                  <input
                    aria-label={"Interval km pro " + entry.name}
                    type="number"
                    min="1"
                    value={v.intervalKm ?? ""}
                    onChange={(e) =>
                      update(
                        index,
                        "intervalKm",
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  />
                </label>
                <label>
                  Interval měsíců (volitelný)
                  <input
                    type="number"
                    min="1"
                    max="240"
                    value={v.intervalMonths ?? ""}
                    onChange={(e) =>
                      update(
                        index,
                        "intervalMonths",
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  />
                </label>
                <label>
                  Další datum (volitelné)
                  <input
                    type="date"
                    value={v.nextDate ?? ""}
                    onChange={(e) =>
                      update(index, "nextDate", e.target.value || null)
                    }
                  />
                </label>
                <label>
                  Další km (volitelné)
                  <input
                    type="number"
                    min="0"
                    value={v.nextKm ?? ""}
                    onChange={(e) =>
                      update(
                        index,
                        "nextKm",
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  />
                </label>
                <label>
                  Upozornit předem km
                  <input
                    type="number"
                    min="0"
                    required
                    value={v.leadKm}
                    onChange={(e) =>
                      update(index, "leadKm", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  Upozornit předem dnů
                  <input
                    type="number"
                    min="0"
                    required
                    value={v.leadDays}
                    onChange={(e) =>
                      update(index, "leadDays", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  Zodpovědná osoba
                  <input
                    required
                    value={v.responsible}
                    onChange={(e) =>
                      update(index, "responsible", e.target.value)
                    }
                  />
                </label>
                <p className="wide">
                  Základ: {date || "datum servisu chybí"} ·{" "}
                  {km === null
                    ? "Km servisu neznámé; kilometrový plán zůstane k doplnění."
                    : km.toLocaleString("cs-CZ") +
                      " km (server ověří chronologii)"}
                  . Při obou intervalech rozhodne první dosažený limit.
                </p>
                {!v.intervalKm &&
                  !v.intervalMonths &&
                  !v.nextDate &&
                  v.nextKm === null && (
                    <p className="error-banner wide">
                      Vyplňte interval nebo další termín.
                    </p>
                  )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
