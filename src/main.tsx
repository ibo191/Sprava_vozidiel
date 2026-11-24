import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  CarFront,
  Wrench,
  Fuel as FuelIcon,
  TriangleAlert,
  ChartNoAxesCombined,
  Users,
  LogOut,
  Bell,
  Plus,
  Search,
  ChevronRight,
  ArrowUpRight,
  Check,
  X,
  Gauge,
  CalendarDays,
  Download,
  FileText,
  History,
  Menu,
  ShieldCheck,
  Bike,
  Truck,
  CircleHelp,
  CheckCircle2,
  Clock3,
  Camera,
} from "lucide-react";
import {
  latestReading,
  planStatus,
  statusLabels,
  fuelAnalytics,
  replacementIntervals,
  manager,
  today,
  type State,
  type User,
  type Vehicle,
  type Plan,
  type Fuel,
  type Service,
  type Issue,
} from "./domain";
import "./styles.css";
import { MileageReadings } from "./MileageReadings";
import { ServiceCatalog } from "./ServiceCatalog";
import { FollowUpEditor } from "./FollowUpEditor";
import {
  catalogFor,
  canonicalEntry,
  itemOperation,
  operationLabels,
} from "./catalog";
import { MileageConflicts } from "./MileageConflicts";
import { PublicReport } from "./PublicReport";
import { ImportedFuel } from "./ImportedFuel";
import { OpenReports } from "./OpenReports";
import { ServiceAnalytics as Analytics } from "./ServiceAnalytics";
import { api, cloud, openPrivate } from "./cloud";
const fmt = (n: number) =>
  new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 }).format(n);
const money = (n: number | null) =>
  n === null ? "Cena neuvedena" : fmt(n) + " Kč";
const date = (d: string | null | undefined) =>
  d ? new Date(d + "T12:00:00").toLocaleDateString("cs-CZ") : "Neznámé datum";
const roleNames = {
  teacher: "Učitel",
  manager: "Správce",
  admin: "Administrátor",
};
const vehicleCategories = [
  { key: "car", label: "Auto", icon: CarFront },
  { key: "motorcycle", label: "Moto", icon: Bike },
  { key: "trailer", label: "Přívěsy", icon: Truck },
];
const issueNames = {
  new: "Nová",
  in_progress: "V řešení",
  needs_info: "K doplnění",
  resolved: "Vyřešena",
};
type Field = {
  camera?: boolean;
  name: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
};
type Dialog = {
  title: string;
  subtitle?: string;
  fields: Field[];
  initial: Record<string, any>;
  action: string;
  extra?: "items";
  onSuccess?: (r: any) => void;
};
const input = (
  name: string,
  label: string,
  type = "text",
  required = true,
): Field => ({ name, label, type, required });
function App() {
  const [user, setUser] = useState<User | null>(null),
    [state, setState] = useState<State | null>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("overview"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [vehicleId, setVehicleId] = useState("all"),
    [category, setCategory] = useState("all"),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reportLink, setReportLink] = useState(""),
    [mobile, setMobile] = useState(false);
  const refresh = async () => setState(await api<State>("/state"));
  useEffect(() => {
    api<User>("/me")
      .then((u) => {
        setUser(u);
        return refresh();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!user || !manager(user)) return;
    let stopped = false;
    const reload = () => {
      if (document.visibilityState === "hidden") return;
      api<State>("/state")
        .then((next) => {
          if (!stopped) setState(next);
        })
        .catch(() => {});
    };
    const timer = window.setInterval(reload, 30000);
    window.addEventListener("focus", reload);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", reload);
    };
  }, [user?.id, user?.role]);
  const notify = (s: string) => {
    setNotice(s);
    setTimeout(() => setNotice(""), 7000);
  };
  const command = async (action: string, payload: unknown) => {
    const r = await api("/command", { action, payload });
    await refresh();
    return r;
  };
  if (loading) return <div className="loading">Načítání flotily…</div>;
  if (!user || !state || !manager(user))
    return (
      <Login
        onLogin={async (u) => {
          setUser(u);
          await refresh();
        }}
      />
    );
  const s = state,
    admin = manager(user),
    vehicles = s.vehicles.filter(
      (v) => vehicleId === "all" || v.id === vehicleId,
    );
  const imported = s.dataset?.kind === "imported";
  const unplanned = s.vehicles.filter(
    (v) => v.active && !s.plans.some((p) => p.vehicleId === v.id),
  );
  const vehicle = (id: string) => s.vehicles.find((v) => v.id === id)!;
  const vname = (id: string) => {
    const v = vehicle(id);
    return v ? `${v.brand} ${v.model}` : "Neznámé vozidlo";
  };
  const vehicleField: Field = {
    name: "vehicleId",
    label: "Vozidlo",
    type: "select",
    options: s.vehicles
      .filter((v) => v.active)
      .map((v) => ({
        value: v.id,
        label: `${v.brand} ${v.model} · ${v.plate}`,
      })),
  };
  const currentVehicle = s.vehicles.some((v) => v.id === vehicleId && v.active)
    ? vehicleId
    : s.vehicles.find((v) => v.active)?.id;
  const safeInitial = {
    vehicleId: currentVehicle,
    date: today(),
    km: undefined,
  };
  const openReportLink = async () => {
    try {
      const b = await api("/report-link");
      setReportLink(new URL(b.path, window.location.origin).href);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const issueDialog = () =>
    setDialog({
      title: "Nahlásit závadu nebo nehodu",
      subtitle:
        "U nebezpečné závady vozidlo odstavte a ihned kontaktujte správce.",
      action: "issue.save",
      initial: {
        vehicleId: currentVehicle,
        kind: "fault",
        description: "",
        severity: "minor",
        immobilize: false,
        attachmentId: null,
      },
      fields: [
        vehicleField,
        {
          name: "kind",
          label: "Typ hlášení",
          type: "select",
          options: [
            { value: "fault", label: "Závada" },
            { value: "accident", label: "Nehoda" },
          ],
        },
        input("description", "Popis závady nebo nehody", "textarea"),
        {
          name: "severity",
          label: "Závažnost",
          type: "select",
          options: [
            { value: "minor", label: "Běžné / bez nebezpečí" },
            { value: "serious", label: "Vážné / nebezpečné" },
          ],
        },
        input(
          "immobilize",
          "Označit vozidlo za nepoužitelné",
          "checkbox",
          false,
        ),
        {
          ...input(
            "attachmentId",
            "Fotografie závady nebo nehody",
            "file",
            false,
          ),
          camera: true,
        },
      ],
      onSuccess: (r) => {
        if (r.severity === "serious" || r.kind === "accident")
          notify("Hlášení přijato. Ihned kontaktujte správce.");
        else notify("Hlášení přijato.");
      },
    });
  const vehicleDialog = (v?: Vehicle) =>
    setDialog({
      title: v ? "Upravit vozidlo" : "Přidat vozidlo",
      action: "vehicle.save",
      initial: v
        ? { ...v, availabilityVerified: v.source?.availabilityVerified ?? true }
        : {
            brand: "",
            model: "",
            year: 2022,
            plate: "",
            kind: "car",
            active: true,
            unavailable: false,
            km: "",
            date: today(),
          },
      fields: [
        input("brand", "Značka"),
        input("model", "Model"),
        input("year", "Rok výroby", "number"),
        input("plate", "Registrační značka"),
        {
          name: "kind",
          label: "Druh vozidla",
          type: "select",
          options: [
            { value: "car", label: "Auto" },
            { value: "motorcycle", label: "Motorka" },
            { value: "trailer", label: "Přívěs" },
          ],
        },
        ...(!v
          ? [
              input(
                "km",
                "Počáteční km (u přívěsu volitelné)",
                "number",
                false,
              ),
              input("date", "Datum odečtu", "date"),
            ]
          : []),
        input("active", "Aktivní vozidlo", "checkbox", false),
        input("unavailable", "Vozidlo je nepoužitelné", "checkbox", false),
        ...(v?.source
          ? [
              input(
                "availabilityVerified",
                "Provozní dostupnost byla ověřena správcem",
                "checkbox",
                false,
              ),
            ]
          : []),
      ],
    });
  const planDialog = (p?: Plan) =>
    setDialog({
      title: p ? "Upravit servisní plán" : "Nový servisní plán",
      subtitle:
        "Platí limit, který nastane dříve. Prázdné hodnoty zůstávají neznámé.",
      action: "plan.save",
      initial: p
        ? { ...p }
        : {
            vehicleId: currentVehicle,
            action: "",
            responsible: user.name,
            lastDate: null,
            lastKm: null,
            nextDate: null,
            nextKm: null,
            intervalKm: null,
            intervalMonths: null,
            leadKm: 1000,
            leadDays: 30,
            booking: null,
          },
      fields: [
        vehicleField,
        input("action", "Servisní úkon"),
        input("responsible", "Zodpovědná osoba"),
        input("lastDate", "Poslední servis – datum", "date", false),
        input("lastKm", "Poslední servis – km", "number", false),
        input("nextDate", "Příští pevný termín", "date", false),
        input("nextKm", "Příští pevný stav km", "number", false),
        input("intervalKm", "Interval (km)", "number", false),
        input("intervalMonths", "Interval (měsíce)", "number", false),
        input("leadKm", "Upozornit předem (km)", "number"),
        input("leadDays", "Upozornit předem (dny)", "number"),
        input("booking", "Termín objednání", "date", false),
      ],
    });
  const serviceDialog = (record?: Service) =>
    setDialog({
      title: record ? "Upravit servisní záznam" : "Zapsat provedený servis",
      subtitle: record
        ? "Oprava se uloží do historie změn. Import ze zdroje zůstane označený. Servisní plány se nepřepíší automaticky."
        : "Preventivní výměny evidujeme samostatně od závad. Aktualizaci plánu potvrdíte po uložení.",
      action: record ? "service.update" : "service.save",
      extra: "items",
      initial: {
        followUps: [],
        followUpResponsible: user.name,
        ...safeInitial,
        km: null,
        items: [
          {
            kind: "action",
            name: "",
            reason: "Preventivní výměna",
            price: null,
          },
        ],
        total: null,
        workshop: "",
        note: "",
        attachmentId: null,
        ...(record
          ? {
              ...record,
              items: record.items.map((item) => ({
                ...item,
                operation: itemOperation(item),
              })),
              expectedRevision: record.revision ?? 0,
            }
          : {}),
      },
      fields: [
        record
          ? {
              ...vehicleField,
              options: s.vehicles.map((v) => ({
                value: v.id,
                label: `${v.brand} ${v.model} · ${v.plate}${v.active ? "" : " · vyřazeno"}`,
              })),
            }
          : vehicleField,
        input("date", "Datum servisu", "date"),
        input("km", "Stav km (prázdné = neznámý)", "number", false),
        input("workshop", "Servis / dílna (prázdné = neuveden)", "text", false),
        input("total", "Celková cena (Kč, volitelně)", "number", false),
        input("note", "Poznámka", "textarea", false),
        input("attachmentId", "Doklad k servisu", "file", false),
        ...(record?.readingExcluded
          ? [
              {
                name: "restoreReading",
                label:
                  "Znovu použít opravený odpočet km (server ověří chronologii)",
                type: "checkbox",
              },
            ]
          : []),
      ],
      onSuccess: () => {
        setPage("services");
        notify(
          record
            ? "Servis opraven. Zkontrolujte případné návrhy a upozornění servisních plánů."
            : "Servis i zvolený další plán uloženy. Zkontrolujte případné položky k doplnění.",
        );
      },
    });
  const deleteReadingDialog = (r: State["readings"][number]) =>
    setDialog({
      title: "Smazat odpočet km",
      subtitle: `${r.date} · ${r.km.toLocaleString("cs-CZ")} km. Vyřadí se pouze odpočet; původní servis nebo tankování zůstane zachováno.`,
      action: "reading.delete",
      initial: { id: r.id, reason: "" },
      fields: [input("reason", "Důvod smazání", "textarea")],
    });
  const reviewIssue = (i: Issue) =>
    setDialog({
      title: "Zpracovat hlášení závady",
      action: "issue.review",
      initial: { ...i },
      fields: [
        {
          name: "status",
          label: "Stav hlášení",
          type: "select",
          options: Object.entries(issueNames).map(([value, label]) => ({
            value,
            label,
          })),
        },
        input("response", "Odpověď správce", "textarea", false),
        {
          name: "serviceId",
          label: "Propojit se servisem",
          type: "select",
          options: [
            { value: "", label: "Bez propojení" },
            ...s.services
              .filter((r) => r.vehicleId === i.vehicleId)
              .map((r) => ({
                value: r.id,
                label: date(r.date) + " · " + r.workshop,
              })),
          ],
        },
      ],
    });
  const userDialog = (u?: User) =>
    setDialog({
      title: u ? "Upravit uživatele" : "Přidat uživatele",
      action: "user.save",
      initial: u
        ? { ...u }
        : { name: "", email: "", role: "manager", active: true, password: "" },
      fields: [
        input("name", "Jméno"),
        input("email", "E-mail", "email"),
        {
          name: "role",
          label: "Role",
          type: "select",
          options: Object.entries(roleNames)
            .filter(([value]) => value !== "teacher")
            .map(([value, label]) => ({
              value,
              label,
            })),
        },
        input("active", "Aktivní účet", "checkbox", false),
        ...(!u
          ? [
              input(
                "password",
                "Počáteční heslo (alespoň 12 znaků)",
                "password",
              ),
            ]
          : []),
      ],
    });
  const allPlans = s.plans
    .filter((p) => vehicle(p.vehicleId)?.active)
    .map((p) => ({ ...p, ...planStatus(p, latestReading(s, p.vehicleId)) }));
  const counts = {
    overdue: allPlans.filter((p) => p.status === "overdue").length,
    soon: allPlans.filter((p) => p.status === "soon").length,
    ok: allPlans.filter((p) => p.status === "ok").length,
    unknown: allPlans.filter((p) => p.status === "unknown").length,
  };
  const titles: Record<string, [string, string]> = {
    overview: ["Přehled flotily", "Hlášení závad, servisní termíny a náklady."],
    vehicles: ["Vozidla", "Stav, dostupnost a historie vaší flotily."],
    plans: ["Servisní plány", "Správný servis ve správný čas."],
    services: [
      "Servisní historie",
      "Provedené práce, materiál a doklady na jednom místě.",
    ],
    fuels: [
      admin ? "Tankování" : "Moje tankování",
      "Každá účtenka má své místo.",
    ],
    issues: [
      admin ? "Závady a hlášení" : "Moje hlášení",
      "Od prvního upozornění až po vyřešení.",
    ],
    analytics: [
      "Servisní náklady",
      "Náklady na údržbu podle vozidla a období.",
    ],
    catalog: [
      "Díly a úkony",
      "Sjednocený katalog a historie výměn podle vozidla.",
    ],
    users: ["Uživatelé", "Lidé, kteří udržují flotilu v pohybu."],
    audit: ["Historie změn", "Důležité opravy a jejich původ."],
  };
  const nav = [
    { key: "overview", label: "Přehled", icon: LayoutDashboard },
    { key: "vehicles", label: "Vozidla", icon: CarFront },
    { key: "plans", label: "Servisní plány", icon: Wrench, restricted: true },
    {
      key: "services",
      label: "Servisní historie",
      icon: History,
      restricted: true,
    },
    { key: "catalog", label: "Díly a úkony", icon: Wrench, restricted: true },
    { key: "fuels", label: "Tankování", icon: FuelIcon },
    { key: "issues", label: "Závady a hlášení", icon: TriangleAlert },
    {
      key: "analytics",
      label: "Servisní náklady",
      icon: ChartNoAxesCombined,
      restricted: true,
    },
  ];
  const goto = (p: string) => {
    setPage(p);
    setSearch("");
    setFilter("all");
    setMobile(false);
  };
  const matchVehicle = (v: Vehicle) =>
    `${v.brand} ${v.model} ${v.plate}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const serviceRows = s.services
    .filter(
      (r) =>
        (vehicleId === "all" || r.vehicleId === vehicleId) &&
        matchVehicle(vehicle(r.vehicleId)),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const serviceCosts = serviceRows.map(
    (r) =>
      r.total ??
      (r.items.every((i) => i.price !== null)
        ? r.items.reduce((sum, i) => sum + i.price!, 0)
        : null),
  );
  const planRows = allPlans.filter(
    (p) =>
      (vehicleId === "all" || p.vehicleId === vehicleId) &&
      matchVehicle(vehicle(p.vehicleId)) &&
      (filter === "all" || p.status === filter),
  );
  const vehicleStatus = (vid: string) => {
    const rows = allPlans.filter((p) => p.vehicleId === vid);
    return (
      ["overdue", "unknown", "soon", "ok"].find((x) =>
        rows.some((p) => p.status === x),
      ) ?? "unknown"
    );
  };
  const planTable = (rows: typeof allPlans) => (
    <div className="table-scroll plan-table">
      <table>
        <thead>
          <tr>
            <th>Vozidlo / servisní úkon</th>
            <th>Stav</th>
            <th>Příští servis</th>
            <th>Objednání</th>
            <th>Zodpovědnost</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <strong>{vname(p.vehicleId)}</strong>
                <small>
                  {vehicle(p.vehicleId).plate} <span>·</span> {p.action}
                </small>
              </td>
              <td>
                <Badge status={p.status} />
                {p.reviewServiceId && (
                  <small>Podklad servisu byl opraven. Zkontrolujte plán.</small>
                )}
                {p.incomplete && p.status === "overdue" && (
                  <small>Také neúplné údaje</small>
                )}
              </td>
              <td>
                <strong>
                  {p.dueKm !== null
                    ? fmt(p.dueKm) + " km"
                    : p.dueDate
                      ? date(p.dueDate)
                      : "K doplnění"}
                </strong>
                <small>
                  {p.dueKm !== null && p.dueDate
                    ? date(p.dueDate)
                    : p.km !== null
                      ? p.km <= 0
                        ? "Překročeno o " + fmt(-p.km) + " km"
                        : "Zbývá " + fmt(p.km) + " km"
                      : p.days !== null
                        ? p.days <= 0
                          ? "Termín překročen"
                          : "Zbývá " + p.days + " dní"
                        : "Chybí podklad"}
                </small>
              </td>
              <td>
                {p.booking ? (
                  <span className="booking">
                    <CalendarDays size={14} />
                    {date(p.booking)}
                  </span>
                ) : (
                  <span className="muted">Neobjednáno</span>
                )}
              </td>
              <td className="muted">{p.responsible}</td>
              <td>
                {admin && (
                  <>
                    <button
                      className="icon-btn"
                      aria-label={"Upravit " + p.action}
                      onClick={() => planDialog(p)}
                    >
                      <ChevronRight size={18} />
                    </button>
                    <button
                      className="text-button"
                      aria-label={"Smazat plán " + p.action}
                      onClick={() =>
                        setDialog({
                          title: "Smazat servisní plán",
                          subtitle:
                            "Plán přestane upozorňovat. Servisní historie zůstane zachována; plán lze obnovit v seznamu smazaných plánů.",
                          action: "plan.delete",
                          initial: { id: p.id, reason: "" },
                          fields: [
                            input("reason", "Důvod smazání", "textarea"),
                          ],
                        })
                      }
                    >
                      Smazat
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <Empty text="Pro tento výběr nejsou servisní plány." />}
    </div>
  );
  return (
    <div className={admin ? "app-shell" : "instructor-shell"}>
      {admin ? (
        <>
          <aside className={"sidebar " + (mobile ? "open" : "")}>
            <a
              className="brand"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                goto("overview");
              }}
            >
              <img
                className="brand-logo"
                src="/brand/bubu-logo.png"
                alt="Autoškola BuBu"
                width="588"
                height="217"
              />
            </a>
            <div className="workspace-label">
              <span className="workspace-icon">
                <CarFront size={18} />
              </span>
              <div>
                Správa vozidel<small>Interní portál Autoškoly BuBu</small>
              </div>
            </div>
            <div className="nav-label">PRACOVNÍ PROSTOR</div>
            <nav>
              {nav
                .filter((n) => !n.restricted || admin)
                .map((n) => (
                  <button
                    key={n.key}
                    className={page === n.key ? "active" : ""}
                    onClick={() => goto(n.key)}
                  >
                    <n.icon size={19} />
                    <span>{n.label}</span>
                    {n.key === "plans" && counts.overdue > 0 && (
                      <b>{counts.overdue}</b>
                    )}
                    {n.key === "issues" &&
                      (s.issues.some((i) => i.status !== "resolved") ||
                        (admin &&
                          s.readings.some((r) => r.status === "conflict"))) && (
                        <i className="nav-dot" />
                      )}
                  </button>
                ))}
            </nav>
            <div className="sidebar-bottom">
              {user.role === "admin" && (
                <button
                  className={page === "users" ? "active" : ""}
                  onClick={() => goto("users")}
                >
                  <Users size={18} />
                  Uživatelé a role
                </button>
              )}
              {admin && (
                <button onClick={() => goto("audit")}>
                  <History size={18} />
                  Historie změn
                </button>
              )}
              <div className="local-note">
                <ShieldCheck size={20} />
                <div>
                  {cloud
                    ? "Online pilotní provoz"
                    : imported
                      ? "Lokální vývoj"
                      : "Lokální demo"}
                  <small>
                    {imported ? "Import Moje Autoškola" : "Ukázková data"} · bez
                    e-mailů
                  </small>
                </div>
              </div>
              <div className="profile">
                <span className="avatar">
                  {user.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </span>
                <div>
                  <strong>{user.name}</strong>
                  <small>{roleNames[user.role]}</small>
                </div>
                <button
                  title="Odhlásit se"
                  onClick={async () => {
                    await api("/logout", {});
                    setUser(null);
                    setState(null);
                  }}
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          </aside>
          <main>
            <header className="topbar">
              <div>
                <button
                  className="mobile-toggle icon-btn"
                  onClick={() => setMobile(!mobile)}
                  aria-label="Otevřít menu"
                >
                  <Menu size={22} />
                </button>
                <span className="breadcrumb">
                  Pracovní prostor <ChevronRight size={13} />
                  <b>{titles[page][0]}</b>
                </span>
                <button
                  className="mobile-brand"
                  onClick={() => goto("overview")}
                  aria-label="Autoškola BuBu – přehled flotily"
                >
                  <img
                    src="/brand/bubu-logo.png"
                    alt=""
                    width="588"
                    height="217"
                  />
                </button>
              </div>
              <div className="top-right">
                <span className="demo-pill">
                  <i /> {imported ? "IMPORTOVANÁ DATA" : "DEMO REŽIM"}
                </span>
                <span className="today">
                  {new Date().toLocaleDateString("cs-CZ", {
                    timeZone: "Europe/Prague",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <button
                  className="notification icon-btn"
                  title="Zobrazit upozornění"
                  onClick={() => {
                    goto("overview");
                    setTimeout(
                      () =>
                        document
                          .getElementById("service-section")
                          ?.scrollIntoView({ behavior: "smooth" }),
                      0,
                    );
                  }}
                >
                  <Bell size={19} />
                  {counts.overdue + counts.soon > 0 && <i />}
                </button>
              </div>
            </header>
            <div className="content">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">AUTOŠKOLA BUBU</div>
                  <h1>{titles[page][0]}</h1>
                  <p>{titles[page][1]}</p>
                </div>
                <div className="heading-actions">
                  {page === "overview" ? (
                    <>
                      <button
                        className="button secondary"
                        onClick={openReportLink}
                      >
                        Odkaz pro hlášení
                      </button>
                      <button
                        className="button primary"
                        onClick={() => goto("issues")}
                      >
                        <TriangleAlert size={18} />
                        Závady a hlášení
                      </button>
                    </>
                  ) : page === "vehicles" && admin ? (
                    <button
                      className="button primary"
                      onClick={() => vehicleDialog()}
                    >
                      <Plus size={18} />
                      Přidat vozidlo
                    </button>
                  ) : page === "plans" ? (
                    <button
                      className="button primary"
                      onClick={() => planDialog()}
                    >
                      <Plus size={18} />
                      Nový plán
                    </button>
                  ) : page === "services" ? (
                    <button
                      className="button primary"
                      onClick={() => serviceDialog()}
                    >
                      <Plus size={18} />
                      Zapsat servis
                    </button>
                  ) : page === "issues" ? (
                    <>
                      <button
                        className="button secondary"
                        onClick={openReportLink}
                      >
                        Odkaz pro hlášení
                      </button>
                      <button className="button primary" onClick={issueDialog}>
                        <Plus size={18} />
                        Nahlásit závadu
                      </button>
                    </>
                  ) : page === "users" ? (
                    <button
                      className="button primary"
                      onClick={() => userDialog()}
                    >
                      <Plus size={18} />
                      Přidat uživatele
                    </button>
                  ) : null}
                </div>
              </div>
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                  <button onClick={() => setError("")}>
                    <X size={16} />
                  </button>
                </div>
              )}
              {imported && (
                <section className="import-banner">
                  <div>
                    <strong>Data z Moje Autoškola</strong>
                    <p>
                      Načteno{" "}
                      {new Date(s.dataset!.capturedAt).toLocaleString("cs-CZ", {
                        timeZone: "Europe/Prague",
                      })}{" "}
                      · {s.vehicles.length} vozidel ·{" "}
                      {admin
                        ? s.fuels.length +
                          " tankování · " +
                          s.services.length +
                          " servisů · "
                        : ""}
                      {cloud
                        ? "Pilotní provoz se skutečnými účty."
                        : "Lokální vývoj s testovacími účty."}
                    </p>
                    <p>
                      Datované odečty a nedatované tachometry zobrazujeme
                      odděleně. Dostupnost vozidel, doklady a správnost importu
                      musí ověřit správce.
                    </p>
                  </div>
                  {admin && (
                    <details>
                      <summary>Výsledky kontroly importu</summary>
                      {s
                        .dataset!.warnings.filter(
                          (w) =>
                            page === "issues" || !/rozpor|chronologi/i.test(w),
                        )
                        .map((w) => (
                          <p key={w}>{w}</p>
                        ))}
                    </details>
                  )}
                </section>
              )}
              {page === "overview" && (
                <>
                  <OpenReports
                    state={s}
                    onAll={() => goto("issues")}
                    onOpen={(i) => {
                      goto("issues");
                      setVehicleId(i.vehicleId);
                    }}
                  />
                  <div className="summary-grid">
                    <Stat
                      title="Aktivní vozidla"
                      value={s.vehicles.filter((v) => v.active).length}
                      caption={
                        imported
                          ? "Provozní dostupnost je třeba ověřit"
                          : `${s.vehicles.filter((v) => v.active && !v.unavailable).length} připraveno k jízdě`
                      }
                      icon={<CarFront />}
                      tone="green"
                      onClick={() => goto("vehicles")}
                    />
                    <Stat
                      title="Po termínu servisu"
                      value={counts.overdue}
                      caption="Vyžaduje vaši pozornost"
                      icon={<TriangleAlert />}
                      tone="red"
                      onClick={() => {
                        if (admin) {
                          goto("plans");
                          setFilter("overdue");
                        }
                      }}
                    />
                    <Stat
                      title="Blížící se servis"
                      value={counts.soon}
                      caption="Naplánujte včas návštěvu"
                      icon={<Clock3 />}
                      tone="amber"
                      onClick={() => {
                        if (admin) {
                          goto("plans");
                          setFilter("soon");
                        }
                      }}
                    />
                    <Stat
                      title="K doplnění údajů"
                      value={counts.unknown + unplanned.length}
                      caption={
                        unplanned.length
                          ? `${unplanned.length} vozidel bez servisního plánu`
                          : "Ať víme, na čem jsme"
                      }
                      icon={<CircleHelp />}
                      tone="gray"
                      onClick={() => {
                        if (admin) {
                          goto("plans");
                          setFilter("unknown");
                        }
                      }}
                    />
                  </div>
                  {unplanned.length > 0 && (
                    <div className="info-banner">
                      <CircleHelp size={19} />
                      <div>
                        <strong>
                          {unplanned.length} aktivních vozidel nemá servisní
                          plán.
                        </strong>
                        <p>
                          Bez limitů nelze servisní stav vyhodnotit. Nulový
                          počet překročení neznamená, že je flotila v pořádku.
                        </p>
                        {admin && (
                          <button
                            className="text-button"
                            onClick={() => planDialog()}
                          >
                            Doplnit servisní plán <Plus size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {s.vehicles.some((v) => v.active && v.unavailable) && (
                    <div className="safety-banner">
                      <div className="safety-icon">
                        <TriangleAlert size={21} />
                      </div>
                      <div>
                        <strong>
                          {s.vehicles
                            .filter((v) => v.active && v.unavailable)
                            .map((v) => `${v.brand} ${v.model} (${v.plate})`)
                            .join(", ")}{" "}
                          mimo provoz
                        </strong>
                        <p>
                          Vozidlo nepoužívejte. Ihned kontaktujte správce.
                          Návrat do provozu schvaluje správce.
                        </p>
                      </div>
                      <button onClick={() => goto("vehicles")}>
                        Detail vozidla <ArrowUpRight size={16} />
                      </button>
                    </div>
                  )}
                  <div className="overview-grid">
                    <section
                      className="panel service-panel"
                      id="service-section"
                    >
                      <div className="panel-heading">
                        <div>
                          <h2>
                            Servis pod kontrolou{" "}
                            <span className="count">{allPlans.length}</span>
                          </h2>
                          <p>Nejdříve to nejdůležitější.</p>
                        </div>
                        {admin && (
                          <button
                            className="text-button"
                            onClick={() => goto("plans")}
                          >
                            Všechny plány <ArrowUpRight size={16} />
                          </button>
                        )}
                      </div>
                      <div className="tabs">
                        {[
                          ["all", "Vše"],
                          ["overdue", "Po termínu"],
                          ["soon", "Blíží se"],
                          ["unknown", "K doplnění"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            className={filter === value ? "selected" : ""}
                            onClick={() => setFilter(value)}
                          >
                            {label}
                            {value !== "all" && (
                              <span>
                                {counts[value as keyof typeof counts]}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                      {planTable(
                        [...planRows].sort(
                          (a, b) =>
                            ["overdue", "soon", "unknown", "ok"].indexOf(
                              a.status,
                            ) -
                            ["overdue", "soon", "unknown", "ok"].indexOf(
                              b.status,
                            ),
                        ),
                      )}
                    </section>
                    <div className="right-column">
                      <section className="panel quick-panel">
                        <div className="panel-heading">
                          <h2>Rychlý zápis</h2>
                          <span className="tiny-label">KAŽDODENNÍ PROVOZ</span>
                        </div>
                        {[
                          {
                            icon: TriangleAlert,
                            title: "Nahlásit závadu",
                            sub: "Závada nebo nehoda",
                            click: issueDialog,
                            tone: "orange",
                          },
                          {
                            icon: Wrench,
                            title: "Zapsat servis",
                            sub: "Údržba a servisní náklady",
                            click: () => serviceDialog(),
                            tone: "green",
                          },
                          {
                            icon: FileText,
                            title: "Odkaz pro hlášení",
                            sub: "Formulář bez přihlášení",
                            click: openReportLink,
                            tone: "blue",
                          },
                        ].map((a) => (
                          <button
                            className="quick-action"
                            key={a.title}
                            onClick={a.click}
                          >
                            <span className={"quick-icon " + a.tone}>
                              <a.icon size={20} />
                            </span>
                            <span>
                              <strong>{a.title}</strong>
                              <small>{a.sub}</small>
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                      </section>
                      <section className="fleet-note">
                        <span className="note-symbol">
                          <Wrench size={24} />
                        </span>
                        <h3>O krok před servisem.</h3>
                        <p>
                          Upozornění sledují datum i kilometry. Rozhoduje limit,
                          který nastane dříve.
                        </p>
                        <div>
                          <CheckCircle2 size={15} /> Objednání nemění stav
                          intervalu
                        </div>
                      </section>
                    </div>
                  </div>
                  <section className="fleet-preview">
                    <div className="section-heading">
                      <div>
                        <h2>Vaše flotila</h2>
                        <p>Připravenost vozidel na jednom místě.</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => goto("vehicles")}
                      >
                        Všechna vozidla <ArrowUpRight size={16} />
                      </button>
                    </div>
                    <div className="vehicle-grid">
                      {s.vehicles
                        .filter((v) => v.active)
                        .slice(0, 4)
                        .map((v) => (
                          <VehicleCard
                            key={v.id}
                            v={v}
                            state={s}
                            status={vehicleStatus(v.id)}
                            onClick={() => {
                              goto("vehicles");
                              setVehicleId(v.id);
                            }}
                          />
                        ))}
                    </div>
                  </section>
                </>
              )}
              {[
                "vehicles",
                "plans",
                "services",
                "fuels",
                "issues",
                "analytics",
                "catalog",
              ].includes(page) && (
                <div className="toolbar">
                  <label className="search-field">
                    <Search size={17} />
                    <input
                      placeholder={
                        page === "catalog"
                          ? "Hledat díl, úkon nebo původní název…"
                          : "Hledat vozidlo nebo RZ…"
                      }
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Filtrovat vozidlo"
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                  >
                    <option value="all">Všechna vozidla</option>
                    {vehicleCategories.map((c) => (
                      <optgroup key={c.key} label={c.label}>
                        {s.vehicles
                          .filter((v) => v.kind === c.key)
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.brand} {v.model} · {v.plate}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                  {admin && ["fuels", "services"].includes(page) && (
                    <a
                      className="button secondary"
                      href={"/api/export/" + page}
                      onClick={
                        cloud
                          ? (e) => {
                              e.preventDefault();
                              openPrivate("/export/" + page, true).catch(
                                (err) => notify(err.message),
                              );
                            }
                          : undefined
                      }
                    >
                      <Download size={16} />
                      Export CSV
                    </a>
                  )}
                </div>
              )}
              {page === "vehicles" && (
                <>
                  <div
                    className="category-tabs"
                    role="group"
                    aria-label="Kategorie vozidel"
                  >
                    {[
                      { key: "all", label: "Všechna" },
                      ...vehicleCategories,
                    ].map((c) => (
                      <button
                        key={c.key}
                        className={category === c.key ? "selected" : ""}
                        aria-pressed={category === c.key}
                        onClick={() => {
                          setCategory(c.key);
                          setVehicleId("all");
                        }}
                      >
                        {c.label}
                        <span>
                          {
                            s.vehicles.filter(
                              (v) =>
                                (admin || v.active) &&
                                (c.key === "all" || v.kind === c.key),
                            ).length
                          }
                        </span>
                      </button>
                    ))}
                  </div>
                  {vehicleCategories
                    .filter((c) => category === "all" || c.key === category)
                    .map((c) => {
                      const group = vehicles
                        .filter(
                          (v) =>
                            (admin || v.active) &&
                            matchVehicle(v) &&
                            v.kind === c.key,
                        )
                        .sort((a, b) => Number(b.active) - Number(a.active));
                      if (!group.length) return null;
                      return (
                        <section
                          className="vehicle-category"
                          key={c.key}
                          data-category={c.key}
                        >
                          <div className="category-heading">
                            <c.icon size={21} />
                            <h2>{c.label}</h2>
                            <span>{group.length} vozidel</span>
                          </div>
                          <div className="vehicle-grid full">
                            {group.map((v) => (
                              <div key={v.id}>
                                <VehicleCard
                                  v={v}
                                  state={s}
                                  status={vehicleStatus(v.id)}
                                  onClick={() => setVehicleId(v.id)}
                                />
                                <div className="vehicle-actions">
                                  {admin && (
                                    <button
                                      className="text-button"
                                      onClick={() => vehicleDialog(v)}
                                    >
                                      Upravit vozidlo
                                    </button>
                                  )}
                                  {admin && v.active && (
                                    <button
                                      className="text-button retire-action"
                                      onClick={() =>
                                        setDialog({
                                          title: "Vyřadit vozidlo z evidence",
                                          subtitle: `${v.brand} ${v.model} · ${v.plate}. Vozidlo zmizí z aktivní nabídky; tankování, servis i hlášení zůstanou zachovány.`,
                                          action: "vehicle.retire",
                                          initial: {
                                            id: v.id,
                                            date: today(),
                                            reason: "",
                                          },
                                          fields: [
                                            input(
                                              "date",
                                              "Datum vyřazení",
                                              "date",
                                            ),
                                            input(
                                              "reason",
                                              "Důvod vyřazení",
                                              "textarea",
                                            ),
                                          ],
                                        })
                                      }
                                    >
                                      Vyřadit
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  {!vehicles.some(
                    (v) =>
                      (admin || v.active) &&
                      matchVehicle(v) &&
                      (category === "all" || v.kind === category),
                  ) && <Empty text="Pro tento výběr nejsou vozidla." />}
                  {vehicleId !== "all" && (
                    <section className="panel detail-panel">
                      <div className="panel-heading">
                        <h2>Historie odečtů a servisní upozornění</h2>
                        <button
                          className="text-button"
                          onClick={() => setVehicleId("all")}
                        >
                          Všechna vozidla
                        </button>
                      </div>
                      {planTable(planRows)}
                      <div className="reading-list">
                        {s.readings
                          .filter(
                            (r) =>
                              r.vehicleId === vehicleId &&
                              r.status === "accepted",
                          )
                          .sort((a, b) => b.date.localeCompare(a.date))
                          .map((r) => (
                            <div key={r.id}>
                              <Gauge size={16} />
                              <strong>{fmt(r.km)} km</strong>
                              <button
                                className="text-button"
                                onClick={() => deleteReadingDialog(r)}
                              >
                                Smazat odpočet
                              </button>
                              <span>{date(r.date)}</span>
                              <span
                                className={
                                  "badge " +
                                  (r.status === "accepted" ? "ok" : "overdue")
                                }
                              >
                                {r.status === "accepted"
                                  ? "Platný odečet"
                                  : "Rozpor – k řešení"}
                              </span>
                            </div>
                          ))}
                      </div>
                    </section>
                  )}
                </>
              )}
              {page === "plans" && (
                <section className="panel">
                  <div className="tabs">
                    {[["all", "Vše"], ...Object.entries(statusLabels)].map(
                      ([value, label]) => (
                        <button
                          key={value}
                          className={filter === value ? "selected" : ""}
                          onClick={() => setFilter(value)}
                        >
                          {label}
                        </button>
                      ),
                    )}
                  </div>
                  {planTable(planRows)}
                  {!!s.deletedPlans?.length && (
                    <details className="record-note">
                      <summary>Smazané plány ({s.deletedPlans.length})</summary>
                      {s.deletedPlans
                        .filter(
                          (x) =>
                            vehicleId === "all" ||
                            x.plan.vehicleId === vehicleId,
                        )
                        .map((x) => (
                          <div className="proposal" key={x.plan.id}>
                            <div>
                              <strong>
                                {vname(x.plan.vehicleId)} · {x.plan.action}
                              </strong>
                              <p>
                                {x.reason} ·{" "}
                                {new Date(x.deletedAt).toLocaleString("cs-CZ")}
                              </p>
                            </div>
                            <button
                              className="button secondary"
                              onClick={async () => {
                                try {
                                  await command("plan.restore", {
                                    id: x.plan.id,
                                  });
                                  notify("Plán obnoven.");
                                } catch (e) {
                                  notify((e as Error).message);
                                }
                              }}
                            >
                              Obnovit plán
                            </button>
                          </div>
                        ))}
                    </details>
                  )}
                </section>
              )}
              {page === "catalog" && (
                <ServiceCatalog
                  state={s}
                  vehicleId={vehicleId}
                  search={search}
                />
              )}
              {page === "fuels" && (
                <ImportedFuel state={s} vehicleId={vehicleId} search={search} />
              )}
              {page === "issues" && admin && (
                <MileageReadings
                  state={s}
                  vehicleId={vehicleId}
                  search={search}
                  onDelete={deleteReadingDialog}
                  onDeleteUndated={(id) =>
                    setDialog({
                      title: "Smazat nedatovaný stav km",
                      subtitle:
                        "Původní hodnota zůstane v historii změn vozidla.",
                      action: "vehicle.clearUndatedKm",
                      initial: { id, reason: "" },
                      fields: [input("reason", "Důvod smazání", "textarea")],
                    })
                  }
                  onRestore={async (id) => {
                    try {
                      await command("reading.restore", { id });
                      notify("Odpočet obnoven; chronologie ověřena.");
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                />
              )}
              {page === "issues" && admin && (
                <MileageConflicts
                  state={s}
                  vehicleId={vehicleId}
                  search={search}
                  onDelete={deleteReadingDialog}
                  onResolve={(r, context) =>
                    setDialog({
                      title: "Prověřit rozporný odečet",
                      subtitle: context,
                      action: "reading.resolve",
                      initial: { ...r },
                      fields: [
                        input("date", "Datum odečtu", "date"),
                        input("km", "Správný stav km", "number"),
                      ],
                    })
                  }
                />
              )}
              {page === "issues" && (
                <div className="issue-grid">
                  {s.issues
                    .filter(
                      (i) =>
                        (vehicleId === "all" || i.vehicleId === vehicleId) &&
                        matchVehicle(vehicle(i.vehicleId)),
                    )
                    .map((i) => (
                      <section className="panel issue-card" key={i.id}>
                        <div className="issue-title">
                          <span
                            className={
                              "quick-icon " +
                              (i.severity === "serious" ? "orange" : "blue")
                            }
                          >
                            <TriangleAlert size={21} />
                          </span>
                          <div>
                            <h3>{vname(i.vehicleId)}</h3>
                            <small>
                              {vehicle(i.vehicleId).plate} · {date(i.date)}
                            </small>
                            <small>
                              {i.kind === "accident" ? "Nehoda" : "Závada"}
                            </small>
                            {i.reporterChannel === "link" && (
                              <small>
                                Formulář bez přihlášení ·{" "}
                                {i.reporterName || "Jméno neuvedeno"}
                              </small>
                            )}
                          </div>
                          <span
                            className={
                              "badge " +
                              (i.status === "resolved" ? "ok" : "soon")
                            }
                          >
                            {issueNames[i.status]}
                          </span>
                        </div>
                        <p>{i.description}</p>
                        {i.immobilize && (
                          <div className="danger-text">
                            Vážná závada · Vozidlo nepoužívat, kontaktovat
                            správce.
                          </div>
                        )}
                        {i.response && (
                          <blockquote>
                            <small>ODPOVĚĎ SPRÁVCE</small>
                            {i.response}
                          </blockquote>
                        )}
                        {i.supplement && (
                          <p>
                            <strong>Doplnění:</strong> {i.supplement}
                          </p>
                        )}
                        {i.serviceId && (
                          <p>
                            Propojeno se servisem:{" "}
                            {date(
                              s.services.find((r) => r.id === i.serviceId)
                                ?.date,
                            )}
                          </p>
                        )}
                        <div className="row-actions">
                          {admin ? (
                            <button onClick={() => reviewIssue(i)}>
                              Zpracovat hlášení
                            </button>
                          ) : (
                            <button
                              onClick={() =>
                                setDialog({
                                  title: "Doplnit hlášení",
                                  action: "issue.supplement",
                                  initial: {
                                    id: i.id,
                                    supplement: i.supplement,
                                  },
                                  fields: [
                                    input(
                                      "supplement",
                                      "Doplňující informace",
                                      "textarea",
                                    ),
                                  ],
                                })
                              }
                            >
                              Doplnit informace
                            </button>
                          )}
                          {i.attachmentId && (
                            <a
                              href={"/api/attachments/" + i.attachmentId}
                              onClick={
                                cloud
                                  ? (e) => {
                                      e.preventDefault();
                                      openPrivate(
                                        "/attachments/" + i.attachmentId,
                                      ).catch((err) => notify(err.message));
                                    }
                                  : undefined
                              }
                            >
                              Fotografie
                            </a>
                          )}
                        </div>
                      </section>
                    ))}
                  {!s.issues.length && (
                    <Empty text="Zatím žádná hlášení závad vozidel." />
                  )}
                </div>
              )}
              {page === "services" && (
                <div className="service-list">
                  <section className="panel service-summary">
                    <div>
                      <small>Servisní záznamy ve výběru</small>
                      <strong>{serviceRows.length}</strong>
                    </div>
                    <div>
                      <small>
                        Evidované náklady{" "}
                        {serviceCosts.some((c) => c === null)
                          ? "(neúplné)"
                          : ""}
                      </small>
                      <strong>
                        {serviceRows.length
                          ? money(
                              serviceCosts.reduce<number>(
                                (sum, c) => sum + (c ?? 0),
                                0,
                              ),
                            )
                          : "Bez záznamů"}
                      </strong>
                    </div>
                    {serviceCosts.some((c) => c === null) && (
                      <p>
                        U některých záznamů chybí cena; započteny jsou pouze
                        známé částky.
                      </p>
                    )}
                  </section>
                  {serviceRows.map((r) => (
                    <section key={r.id} className="panel service-record">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            {vname(r.vehicleId)}{" "}
                            <span className="plate-inline">
                              {vehicle(r.vehicleId).plate}
                            </span>
                          </h2>
                          <p>
                            {date(r.date)} ·{" "}
                            {r.km === null
                              ? "Stav km neznámý"
                              : fmt(r.km) + " km"}{" "}
                            · {r.workshop || "Dodavatel neuveden"}
                            {r.readingExcluded &&
                              " · Odpočet km vyřazen z výpočtů"}
                          </p>
                          {r.source && (
                            <p className="source-note">
                              Import Moje Autoškola · servis #{r.source.id}
                              {r.source.vehicleMatchedByLabel
                                ? " · historické vozidlo spárováno podle přesného označení"
                                : ""}
                            </p>
                          )}
                        </div>
                        <strong>
                          {r.total !== null
                            ? money(r.total)
                            : r.items.every((i) => i.price !== null)
                              ? money(r.items.reduce((a, i) => a + i.price!, 0))
                              : r.source && !r.editedAt
                                ? "Cena ve zdroji neuvedena"
                                : "Cena neúplná"}
                        </strong>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => serviceDialog(r)}
                      >
                        Upravit servis
                      </button>
                      {r.editedAt && (
                        <p className="source-note">
                          Upraveno v této aplikaci{" "}
                          {new Date(r.editedAt).toLocaleString("cs-CZ")} ·{" "}
                          {s.users.find((u) => u.id === r.editedBy)?.name ??
                            "Správce"}
                          . Původní hodnoty jsou v historii změn.
                        </p>
                      )}
                      <div className="service-items">
                        {r.items.map((i, n) => (
                          <div key={n}>
                            <Wrench size={15} />
                            <div>
                              <strong>
                                {canonicalEntry(s, i.kind, i.name).name}
                              </strong>
                              <small>
                                {canonicalEntry(s, i.kind, i.name).kind ===
                                "part"
                                  ? "Díl / materiál"
                                  : "Úkon"}{" "}
                                · {i.reason} ·{" "}
                                {operationLabels[itemOperation(i)]}
                                {(i.originalName ?? i.name) !==
                                  canonicalEntry(s, i.kind, i.name).name && (
                                  <span>
                                    {" "}
                                    · původně: {i.originalName ?? i.name}
                                  </span>
                                )}
                              </small>
                            </div>
                            <span>
                              {i.price === null
                                ? r.source && r.total !== null
                                  ? "Cena položky nerozepsána"
                                  : "Cena neuvedena"
                                : money(i.price)}
                            </span>
                          </div>
                        ))}
                      </div>
                      {r.note && <p className="record-note">{r.note}</p>}
                      {r.attachmentId && (
                        <a
                          className="attachment-link"
                          href={"/api/attachments/" + r.attachmentId}
                          onClick={
                            cloud
                              ? (e) => {
                                  e.preventDefault();
                                  openPrivate(
                                    "/attachments/" + r.attachmentId,
                                  ).catch((err) => notify(err.message));
                                }
                              : undefined
                          }
                        >
                          <FileText size={15} />
                          Stáhnout doklad
                        </a>
                      )}
                      {r.pendingPlanIds.map((pid) => {
                        const p = s.plans.find((p) => p.id === pid)!;
                        return (
                          <div className="proposal" key={pid}>
                            <div>
                              <strong>Navržená aktualizace: {p.action}</strong>
                              <p>
                                {r.km === null && p.intervalKm
                                  ? "Chybí km. Doplňte podklad před potvrzením."
                                  : "Zkontrolujte datum a km. Plán se změní až po potvrzení."}
                              </p>
                            </div>
                            <button
                              className="button secondary"
                              onClick={() =>
                                setDialog({
                                  title: "Potvrdit základ servisního plánu",
                                  action: "service.confirm",
                                  initial: {
                                    serviceId: r.id,
                                    planId: pid,
                                    lastDate: r.date,
                                    lastKm: r.km,
                                    nextDate: null,
                                    nextKm: null,
                                  },
                                  fields: [
                                    input(
                                      "lastDate",
                                      "Datum provedení",
                                      "date",
                                    ),
                                    input(
                                      "lastKm",
                                      "Stav km (neznámý ponechte prázdný)",
                                      "number",
                                      false,
                                    ),
                                    input(
                                      "nextDate",
                                      "Příští pevný termín (není-li interval)",
                                      "date",
                                      false,
                                    ),
                                    input(
                                      "nextKm",
                                      "Příští pevný stav km (není-li interval)",
                                      "number",
                                      false,
                                    ),
                                  ],
                                })
                              }
                            >
                              Prověřit návrh
                            </button>
                          </div>
                        );
                      })}
                    </section>
                  ))}
                  {!s.services.length && (
                    <Empty text="Zatím žádné servisní záznamy." />
                  )}
                </div>
              )}
              {page === "analytics" && (
                <Analytics state={s} vehicleId={vehicleId} search={search} />
              )}
              {page === "users" && (
                <section className="panel">
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Uživatel</th>
                          <th>Role</th>
                          <th>Stav</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {s.users
                          .filter((u) => manager(u))
                          .map((u) => (
                            <tr key={u.id}>
                              <td>
                                <strong>{u.name}</strong>
                                <small>{u.email}</small>
                              </td>
                              <td>{roleNames[u.role]}</td>
                              <td>
                                <span
                                  className={
                                    "badge " + (u.active ? "ok" : "unknown")
                                  }
                                >
                                  {u.active ? "Aktivní" : "Deaktivovaný"}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() => userDialog(u)}
                                >
                                  Upravit
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {page === "audit" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Audit významných změn</h2>
                    <span className="muted">Záznamy jsou pouze ke čtení</span>
                  </div>
                  {s.audit.length === 0 ? (
                    <Empty text="Zatím nebyly provedeny žádné změny." />
                  ) : (
                    <div className="audit-list">
                      {[...s.audit].reverse().map((a) => (
                        <details key={a.id}>
                          <summary>
                            {new Date(a.at).toLocaleString("cs-CZ")} ·{" "}
                            {s.users.find((u) => u.id === a.actor)?.name ??
                              "Formulář přes odkaz"}{" "}
                            · {a.entity}
                          </summary>
                          <div className="audit-diff">
                            <pre>{JSON.stringify(a.before, null, 2)}</pre>
                            <pre>{JSON.stringify(a.after, null, 2)}</pre>
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
                </section>
              )}
              <footer>
                <span>BuBu · Správa vozidel</span>
                <span>
                  {cloud
                    ? "Supabase · Pilotní provoz"
                    : imported
                      ? "Importovaná data · Testovací přihlášení · Supabase nepřipojen"
                      : "Lokální demo"}{" "}
                  · Upozornění pouze v aplikaci
                </span>
              </footer>
            </div>
          </main>
        </>
      ) : null}
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={20} />
          {notice}
          <button onClick={() => setNotice("")}>
            <X size={17} />
          </button>
        </div>
      )}
      {dialog && (
        <FormDialog
          dialog={dialog}
          state={s}
          onClose={() => setDialog(null)}
          onSubmit={async (payload) => {
            const r = await command(dialog.action, payload);
            setDialog(null);
            if (dialog.onSuccess) dialog.onSuccess(r);
            else notify("Změny byly uloženy.");
          }}
          upload={async (f) => {
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(String(reader.result).split(",")[1]);
              reader.onerror = reject;
              reader.readAsDataURL(f);
            });
            return (
              await command("attachment.upload", {
                name: f.name,
                mime: f.type,
                data,
              })
            ).id;
          }}
        />
      )}
      {reportLink && (
        <div className="modal-backdrop">
          <section
            className="receipt-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
          >
            <button
              className="modal-close"
              onClick={() => setReportLink("")}
              aria-label="Zavřít"
            >
              <X size={20} />
            </button>
            <h2 id="share-title">Odkaz pro hlášení závad</h2>
            <p>
              Instruktor vyplní formulář bez účtu. Odkaz sdílejte pouze s lidmi,
              kteří mají hlásit závady.
            </p>
            <input
              readOnly
              aria-label="Odkaz pro hlášení"
              value={reportLink}
              onFocus={(e) => e.target.select()}
            />
            <p>
              {cloud
                ? "Odkaz funguje na mobilu i počítači. Držitel odkazu může odeslat hlášení; správu ani ostatní hlášení neuvidí."
                : "Lokálně funguje odkaz pouze na tomto počítači. Veřejný přístup bude dostupný po nasazení aplikace."}
            </p>
            <button
              className="button primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(reportLink);
                  notify("Odkaz zkopírován.");
                } catch {
                  notify("Označte a zkopírujte odkaz z pole.");
                }
              }}
            >
              Kopírovat odkaz
            </button>
            <a
              className="button secondary"
              href={reportLink}
              target="_blank"
              rel="noreferrer"
            >
              Otevřít formulář
            </a>
            {cloud && admin && (
              <button
                className="text-button"
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Předchozí odkaz přestane fungovat. Vytvořit nový odkaz pro instruktory?",
                    )
                  )
                    return;
                  try {
                    const r = await api("/report-link/rotate", {});
                    setReportLink(window.location.origin + r.path);
                    notify("Starý odkaz byl zneplatněn. Sdílejte nový odkaz.");
                  } catch (e) {
                    notify((e as Error).message);
                  }
                }}
              >
                Zneplatnit odkaz a vytvořit nový
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={"badge " + status}>
      <i />
      {statusLabels[status]}
    </span>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <FileText size={25} />
      <p>{text}</p>
    </div>
  );
}
function Stat({
  title,
  value,
  caption,
  icon,
  tone,
  onClick,
}: {
  title: string;
  value: number;
  caption: string;
  icon: React.ReactNode;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button className={"stat-card " + tone} onClick={onClick}>
      <div>
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value.toString().padStart(2, "0")}</strong>
      <small>
        <i />
        {caption}
      </small>
    </button>
  );
}
function VehicleCard({
  v,
  state,
  status,
  onClick,
}: {
  v: Vehicle;
  state: State;
  status: string;
  onClick: () => void;
}) {
  const r = latestReading(state, v.id);
  const Icon =
    v.kind === "car" ? CarFront : v.kind === "motorcycle" ? Bike : Truck;
  return (
    <button
      className={"vehicle-card " + (!v.active ? "inactive" : "")}
      onClick={onClick}
    >
      <div className="vehicle-card-top">
        <span className={"availability " + (v.unavailable ? "off" : "")}>
          <i />
          {!v.active
            ? "Neaktivní"
            : v.unavailable
              ? "Mimo provoz"
              : v.source && !v.source.availabilityVerified
                ? "Dostupnost neověřena"
                : "V provozu"}
        </span>
        <ArrowUpRight size={17} />
      </div>
      <div className="vehicle-art">
        <Icon strokeWidth={1.15} />
        <span>
          {v.kind === "car"
            ? "OSOBNÍ AUTO"
            : v.kind === "motorcycle"
              ? "MOTOCYKL"
              : "PŘÍVĚS"}
        </span>
      </div>
      <h3>
        {v.brand} {v.model}
      </h3>
      <div className="vehicle-meta">
        <span className="plate">{v.plate}</span>
        <span>{v.year}</span>
      </div>
      <div className="odometer">
        <Gauge size={16} />
        <strong>
          {r
            ? fmt(r.km) + " km"
            : v.kind === "trailer"
              ? "Km neevidujeme"
              : "Km neznámé"}
        </strong>
        <small>{r ? date(r.date) : "Bez odečtu"}</small>
      </div>
      {v.source?.undatedKm != null && (
        <div className="undated-km">
          <strong>{fmt(v.source.undatedKm)} km</strong> · nedatovaný stav ze
          zdroje
          <small>Datum odečtu chybí; nenahrazuje platný datovaný stav.</small>
        </div>
      )}
      <div className="vehicle-card-bottom">
        <Badge status={status} />
        <ChevronRight size={15} />
      </div>
    </button>
  );
}
function FormDialog({
  dialog: d,
  state,
  onClose,
  onSubmit,
  upload,
}: {
  dialog: Dialog;
  state: State;
  onClose: () => void;
  onSubmit: (p: any) => Promise<void>;
  upload: (f: File) => Promise<string>;
}) {
  const [values, setValues] = useState({ ...d.initial }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState<File | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  const chooseFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    if (!selected) return;
    const allowed = d.fields.some((f) => f.camera)
      ? ["image/jpeg", "image/png"]
      : ["image/jpeg", "image/png", "application/pdf"];
    if (selected.size > 5 * 1024 * 1024 || !allowed.includes(selected.type)) {
      setError(
        "Vyberte JPG nebo PNG do 5 MB" +
          (d.fields.some((f) => f.camera) ? "." : " (případně PDF)."),
      );
      e.target.value = "";
      return;
    }
    setError("");
    setFile(selected);
  };
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const set = (k: string, v: any) =>
    setValues((p) => ({
      ...p,
      [k]: v,
      ...(k === "items" &&
      (v.length !== p.items.length ||
        v.some(
          (item: any, i: number) =>
            item.name !== p.items[i]?.name || item.kind !== p.items[i]?.kind,
        ))
        ? { followUps: [] }
        : {}),
    }));
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", key);
    const el = document.querySelector<HTMLElement>(
      ".modal input,.modal select",
    );
    el?.focus();
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { ...values };
      for (const f of d.fields) {
        if (f.type === "number")
          payload[f.name] =
            values[f.name] === "" ||
            values[f.name] === undefined ||
            values[f.name] === null
              ? null
              : Number(values[f.name]);
        if (f.type === "date" && !values[f.name]) payload[f.name] = null;
        if (f.name === "serviceId" && !values[f.name]) payload[f.name] = null;
      }
      if (file) payload.attachmentId = await upload(file);
      await onSubmit(payload);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const itemNames = Array.from(
    new Set([...catalogFor(state).map((e) => e.name)]),
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div className="modal-heading">
          <div>
            <div className="eyebrow">SPRÁVA FLOTILY</div>
            <h2 id="dialog-title">{d.title}</h2>
            {d.subtitle && <p>{d.subtitle}</p>}
          </div>
          <button
            className="icon-btn"
            onClick={onClose}
            disabled={busy}
            aria-label="Zavřít"
          >
            <X size={22} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            {d.fields.map((f) => (
              <label
                key={f.name}
                className={
                  ["textarea", "file", "checkbox"].includes(f.type ?? "")
                    ? "wide " + (f.type === "checkbox" ? "checkbox-label" : "")
                    : ""
                }
              >
                {f.type !== "checkbox" && (
                  <span>
                    {f.label}
                    {f.required && <b> *</b>}
                  </span>
                )}
                {f.type === "select" ? (
                  <select
                    value={values[f.name] ?? ""}
                    onChange={(e) => set(f.name, e.target.value)}
                    required={f.required}
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    value={values[f.name] ?? ""}
                    onChange={(e) => set(f.name, e.target.value)}
                    required={f.required}
                    rows={3}
                  />
                ) : f.type === "checkbox" ? (
                  <>
                    <input
                      type="checkbox"
                      checked={values[f.name] ?? false}
                      onChange={(e) => set(f.name, e.target.checked)}
                    />
                    <span>{f.label}</span>
                  </>
                ) : f.type === "file" ? (
                  <>
                    <input
                      type="file"
                      ref={attachmentInput}
                      className={f.camera ? "camera-input" : undefined}
                      accept={
                        f.camera
                          ? "image/png,image/jpeg"
                          : "image/png,image/jpeg,application/pdf"
                      }
                      onChange={chooseFile}
                    />
                    {f.camera && (
                      <span className="photo-actions">
                        <button
                          className="button secondary"
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            attachmentInput.current?.click();
                          }}
                        >
                          Vybrat fotografii
                        </button>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            cameraInput.current?.click();
                          }}
                        >
                          <Camera size={18} />
                          Vyfotit
                        </button>
                        <input
                          ref={cameraInput}
                          type="file"
                          accept="image/jpeg,image/png"
                          capture="environment"
                          onChange={chooseFile}
                          className="camera-input"
                          aria-label="Fotoaparát"
                        />
                      </span>
                    )}
                    {file && <small>Vybráno: {file.name}</small>}
                    {preview && (
                      <img
                        className="attachment-preview"
                        src={preview}
                        alt="Náhled vybrané fotografie"
                      />
                    )}
                    <small>
                      {f.camera
                        ? "JPG nebo PNG · nejvýše 5 MB"
                        : "JPG, PNG nebo PDF · nejvýše 5 MB"}
                      {values.attachmentId
                        ? " · Původní příloha je zachována"
                        : ""}
                    </small>
                  </>
                ) : (
                  <input
                    type={f.type ?? "text"}
                    value={values[f.name] ?? ""}
                    onChange={(e) => set(f.name, e.target.value)}
                    required={f.required}
                    step={f.type === "number" ? "any" : undefined}
                    min={f.type === "number" ? 0 : undefined}
                    maxLength={f.type === "number" ? undefined : 3000}
                  />
                )}
              </label>
            ))}
          </div>
          {d.extra === "items" && (
            <div className="items-editor">
              <h3>Úkony a díly / materiál</h3>
              <p>
                Vyberte název z katalogu nebo napište vlastní. Typ zásahu
                určuje, zda se položka počítá jako výměna.
              </p>
              <datalist id="item-catalog">
                {itemNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              {values.items.map((item: any, i: number) => (
                <div className="item-editor" key={i}>
                  <select
                    aria-label="Typ položky"
                    value={item.kind}
                    onChange={(e) =>
                      set(
                        "items",
                        values.items.map((x: any, n: number) =>
                          n === i ? { ...x, kind: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    <option value="action">Úkon</option>
                    <option value="part">Díl / materiál</option>
                  </select>
                  <input
                    list="item-catalog"
                    aria-label="Název úkonu nebo dílu"
                    placeholder="Vyberte nebo napište vlastní název"
                    value={item.name}
                    required
                    onChange={(e) =>
                      set(
                        "items",
                        values.items.map((x: any, n: number) =>
                          n === i ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <select
                    aria-label="Typ zásahu"
                    value={item.operation ?? itemOperation(item)}
                    onChange={(e) =>
                      set(
                        "items",
                        values.items.map((x: any, n: number) =>
                          n === i ? { ...x, operation: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    {Object.entries(operationLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Důvod výměny"
                    placeholder="Důvod výměny"
                    value={item.reason}
                    required
                    onChange={(e) =>
                      set(
                        "items",
                        values.items.map((x: any, n: number) =>
                          n === i ? { ...x, reason: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    aria-label="Cena položky"
                    placeholder="Cena Kč (volitelná)"
                    value={item.price ?? ""}
                    onChange={(e) =>
                      set(
                        "items",
                        values.items.map((x: any, n: number) =>
                          n === i
                            ? {
                                ...x,
                                price:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Odebrat položku"
                    disabled={values.items.length === 1}
                    onClick={() =>
                      set(
                        "items",
                        values.items.filter((_: any, n: number) => n !== i),
                      )
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  set("items", [
                    ...values.items,
                    { kind: "part", name: "", reason: "", price: null },
                  ])
                }
              >
                <Plus size={16} />
                Přidat položku
              </button>
            </div>
          )}
          {d.action === "issue.save" &&
            (values.severity === "serious" || values.kind === "accident") && (
              <div className="error-banner">
                Vozidlo nepoužívejte, je-li nebezpečné. Nehodu nebo vážnou
                závadu ihned oznamte správci; aplikace neposílá automatické
                e-maily.
              </div>
            )}
          {d.extra === "items" && (
            <FollowUpEditor
              state={state}
              items={values.items}
              vehicleId={values.vehicleId}
              date={values.date}
              km={
                values.km === null ||
                values.km === undefined ||
                values.km === ""
                  ? null
                  : Number(values.km)
              }
              values={values.followUps ?? []}
              onChange={(v) => set("followUps", v)}
              responsible={values.followUpResponsible ?? "Správce"}
            />
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <div className="modal-footer">
            <span>
              {cloud
                ? "Změna se uloží do evidence"
                : "Lokální vývoj · změna se uloží na server"}
            </span>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onClose}
            >
              Zrušit
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy
                ? "Ukládání…"
                : d.action === "vehicle.retire"
                  ? "Vyřadit vozidlo"
                  : d.action === "reading.delete" ||
                      d.action === "vehicle.clearUndatedKm"
                    ? "Smazat odpočet"
                    : d.action === "plan.delete"
                      ? "Smazat plán"
                      : "Uložit"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (u: User) => Promise<void> }) {
  const [email, setEmail] = useState(cloud ? "" : "admin@bubu.local"),
    [password, setPassword] = useState(cloud ? "" : "BubuDemo2026!"),
    [error, setError] = useState(""),
    [mode, setMode] = useState(
      cloud && window.location.pathname === "/obnova" ? "new" : "login",
    ),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <div className="login-story">
        <img
          className="login-brand"
          src="/brand/bubu-logo.png"
          alt="Autoškola BuBu"
          width="588"
          height="217"
        />
        <div>
          <span className="eyebrow">INTERNÍ PORTÁL AUTOŠKOLY</span>
          <h1>
            Dobrá jízda začíná
            <br />u spolehlivého auta.
          </h1>
          <p>
            Servis, provoz a celá flotila.
            <br />
            Přehledně na jednom místě.
          </p>
          <div className="login-car">
            <CarFront size={150} strokeWidth={0.8} />
            <span>VŽDY O KROK NAPŘED</span>
          </div>
        </div>
        <small>Autoškola BuBu · Správa vozidel</small>
      </div>
      <div className="login-form-wrap">
        <section className="login-form">
          <span className="demo-pill">
            <i /> {cloud ? "SPRÁVA VOZIDEL" : "LOKÁLNÍ DEMO"}
          </span>
          <h2>
            {mode === "login"
              ? "Vítejte zpátky."
              : mode === "reset"
                ? "Obnovení hesla"
                : "Nastavte nové heslo"}
          </h2>
          <p>
            {mode === "login"
              ? "Přihlaste se do správy vozidel."
              : cloud
                ? "Obnova přístupu ke správě vozidel."
                : "Lokální simulace. Žádný e-mail se neodesílá."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                if (mode === "login")
                  await onLogin(await api("/login", { email, password }));
                else if (mode === "reset") {
                  const r = await api("/reset-request", { email });
                  if (r.demoToken) {
                    setToken(r.demoToken);
                    setMode("new");
                    setPassword("");
                  } else if (cloud) setError(r.message);
                  else
                    setError(
                      "Pro tento e-mail není lokální demo odkaz k dispozici.",
                    );
                } else {
                  await api("/reset-password", { token, password });
                  setMode("login");
                  setError("Heslo změněno. Nyní se přihlaste.");
                }
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode !== "new" && (
              <label>
                E-mail
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                {mode === "new" ? "Nové heslo (alespoň 12 znaků)" : "Heslo"}
                <input
                  type="password"
                  autoComplete={
                    mode === "new" ? "new-password" : "current-password"
                  }
                  value={password}
                  minLength={mode === "new" ? 12 : 1}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
            )}
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <button className="button primary" disabled={busy}>
              {busy
                ? "Probíhá…"
                : mode === "login"
                  ? "Přihlásit se"
                  : mode === "reset"
                    ? cloud
                      ? "Odeslat odkaz pro obnovu"
                      : "Zobrazit demo odkaz"
                    : "Uložit nové heslo"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <button
            className="text-button reset-link"
            onClick={() => {
              setMode(mode === "login" ? "reset" : "login");
              setError("");
            }}
          >
            {mode === "login" ? "Zapomenuté heslo" : "Zpět na přihlášení"}
          </button>
          {!cloud && (
            <div className="demo-accounts">
              <strong>Vyzkoušejte jednotlivé role</strong>
              <p>
                Lokální vývoj s testovacími účty může obsahovat importovaná
                data. Supabase není připojen. Toto není produkční zabezpečení.
              </p>
              <div>
                {[
                  ["admin", "Admin"],
                  ["spravce", "Správce"],
                ].map(([e, label]) => (
                  <button
                    key={e}
                    onClick={() => {
                      setEmail(e + "@bubu.local");
                      setPassword("BubuDemo2026!");
                      setMode("login");
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <small>Výchozí heslo: BubuDemo2026!</small>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname === "/hlaseni" ? (
      <PublicReport />
    ) : window.location.pathname === "/obnova" ? (
      <Login
        onLogin={async () => {
          window.location.assign("/");
        }}
      />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
