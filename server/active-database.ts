import { existsSync, readFileSync } from "node:fs";
export const activeDatabaseFile = "data/active-database.json";
export function activeDatabase(): string {
  if (process.env.BUBU_DEMO_DB) return process.env.BUBU_DEMO_DB;
  if (!existsSync(activeDatabaseFile)) return "data/bubu.sqlite";
  const name = JSON.parse(readFileSync(activeDatabaseFile, "utf8")).database;
  if (typeof name !== "string" || !/^bubu[-a-zA-Z0-9_]*\.sqlite$/.test(name))
    throw new Error("Neplatná konfigurace lokální databáze.");
  return "data/" + name;
}
