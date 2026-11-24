import type { ServiceItem, State } from "./domain.ts";
export type ItemOperation =
  | "replacement"
  | "repair"
  | "inspection"
  | "material"
  | "unspecified";
export type CatalogEntry = {
  id: string;
  kind: "action" | "part";
  name: string;
  aliases: string[];
  defaultOperation?: ItemOperation;
};
export const itemKey = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs-CZ")
    .replace(/[‐‑–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const definitions: {
  name: string;
  kind: "action" | "part";
  aliases: string[];
  defaultOperation?: ItemOperation;
}[] = [
  {
    name: "Spojková sada (3dílná)",
    kind: "part",
    aliases: [
      "3 dílná spojková sada",
      "3 DÍLNÁ SPOJKOVÁ SADA LUK",
      "3 DÍLNÁ SPOJKOVÁ SADA Sachs",
    ],
  },
  {
    name: "Výměna motorového oleje",
    kind: "action",
    aliases: ["Olejový servis", "Olej", "Motorový olej a filtr"],
    defaultOperation: "replacement",
  },
  { name: "Brzdy", kind: "action", aliases: ["Brzy"] },
  {
    name: "Čerpadlo ostřikovače",
    kind: "part",
    aliases: ["Čerpadlo odstřikovače"],
  },
  { name: "Ostřikovače", kind: "part", aliases: ["Odstřikovače"] },
  {
    name: "Vnitřní klouby poloosy",
    kind: "part",
    aliases: ["Vnitřné klouby poloosy"],
  },
  {
    name: "Chladicí kapalina",
    kind: "part",
    aliases: ["Chladící kapalina"],
    defaultOperation: "material",
  },
  {
    name: "Geometrie kol",
    kind: "action",
    aliases: ["Geometrie"],
    defaultOperation: "inspection",
  },
  {
    name: "Mechanické práce",
    kind: "action",
    aliases: ["Mechanická práce"],
  },
  {
    name: "Výměna převodového oleje",
    kind: "action",
    aliases: ["výměna oleje prevodovky"],
    defaultOperation: "replacement",
  },
  {
    name: "Výměna brzdové kapaliny",
    kind: "action",
    aliases: [],
    defaultOperation: "replacement",
  },
  {
    name: "Kontrola chladicí kapaliny",
    kind: "action",
    aliases: ["Kontrola chladící kapaliny"],
    defaultOperation: "inspection",
  },
  {
    name: "Oprava převodovky",
    kind: "action",
    aliases: [],
    defaultOperation: "repair",
  },
  {
    name: "Oprava brzdového třmenu",
    kind: "action",
    aliases: ["Oprava brzdičů"],
    defaultOperation: "repair",
  },
  {
    name: "Oprava levého brzdového třmenu",
    kind: "action",
    aliases: ["Oprava levého brzdiče"],
    defaultOperation: "repair",
  },
];
export const operationLabels: Record<ItemOperation, string> = {
  replacement: "Výměna",
  repair: "Oprava",
  inspection: "Kontrola / seřízení",
  material: "Materiál / doplnění",
  unspecified: "Zásah neurčen",
};
const identifier = (kind: string, name: string) =>
  `catalog:${kind}:${encodeURIComponent(itemKey(name))}`;
export function canonicalEntry(
  s: Pick<State, "catalog">,
  kind: "action" | "part",
  name: string,
): CatalogEntry {
  const key = itemKey(name);
  if (/^mechanicka prace\s*\([^]*\)$/.test(key))
    return canonicalEntry(s, "action", "Mechanické práce");
  const custom = s.catalog?.find(
    (e) =>
      e.kind === kind && [e.name, ...e.aliases].some((n) => itemKey(n) === key),
  );
  if (custom) return custom;
  const match = definitions.find((e) =>
    [e.name, ...e.aliases].some((n) => itemKey(n) === key),
  );
  const entry = match ?? {
    kind,
    name: name.trim().replace(/\s+/g, " "),
    aliases: [],
  };
  return { ...entry, id: identifier(entry.kind, entry.name) };
}
export function catalogFor(
  s: Pick<State, "catalog" | "services">,
): CatalogEntry[] {
  const rows = new Map<string, CatalogEntry>();
  for (const e of [
    ...definitions.map((e) => ({ ...e, id: identifier(e.kind, e.name) })),
    ...(s.catalog ?? []),
  ])
    rows.set(e.id, { ...e, aliases: [...e.aliases] });
  for (const service of s.services)
    for (const item of service.items) {
      const e = canonicalEntry(s, item.kind, item.name),
        old = rows.get(e.id) ?? { ...e, aliases: [...e.aliases] };
      if (
        itemKey(item.name) !== itemKey(old.name) &&
        !old.aliases.includes(item.name)
      )
        old.aliases.push(item.name);
      rows.set(e.id, old);
    }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "cs"));
}
export function itemOperation(item: ServiceItem): ItemOperation {
  if (item.operation) return item.operation;
  const n = itemKey(item.name);
  if (n.startsWith("vymena ")) return "replacement";
  if (n.startsWith("oprava ")) return "repair";
  if (n.startsWith("kontrola ") || n.startsWith("geometrie"))
    return "inspection";
  const entry = canonicalEntry({ catalog: undefined }, item.kind, item.name);
  if (entry.defaultOperation) return entry.defaultOperation;
  if (/kapalin|lepidlo|primer|^lak(?:\s|$)/.test(n)) return "material";
  // Operator confirmed that physical parts in the historic service records were replaced.
  if (entry.kind === "part") return "replacement";
  return "unspecified";
}
export function catalogUsage(s: State, entryId: string, vehicleId?: string) {
  const records = s.services.filter(
    (r) =>
      (!vehicleId || r.vehicleId === vehicleId) &&
      r.items.some((i) => canonicalEntry(s, i.kind, i.name).id === entryId),
  );
  return records.map((r) => ({
    service: r,
    items: r.items.filter(
      (i) => canonicalEntry(s, i.kind, i.name).id === entryId,
    ),
  }));
}
