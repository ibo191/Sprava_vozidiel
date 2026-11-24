import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { activeDatabase } from "../server/active-database.ts";
import type { State } from "../src/domain.ts";

const path = "data/deploy/cloud-initial.json";
if (existsSync(path))
  throw new Error(
    "Initial export already exists; preserve its one-use secret.",
  );
mkdirSync("data/deploy", { recursive: true });
const db = new DatabaseSync(activeDatabase(), { readOnly: true });
const state = JSON.parse(
  (db.prepare("select body from state where id=1").get() as { body: string })
    .body,
) as State;
db.close();
if (!state.dataset)
  throw new Error("Expected imported data; refuse to publish demo state.");
// Preserve historical IDs, never copy development passwords or enable demo identities.
state.users = state.users.map((u) => ({
  ...u,
  role: "teacher",
  active: false,
}));
const bootstrapToken = randomBytes(32).toString("base64url");
const config = {
  origins: ["https://bubu-sprava-vozidiel.vercel.app", "http://127.0.0.1:5173"],
  reportToken: randomBytes(32).toString("base64url"),
  ipSalt: randomBytes(32).toString("hex"),
  bootstrapHash: createHash("sha256").update(bootstrapToken).digest("hex"),
  importHash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
};
writeFileSync(path, JSON.stringify({ state, config, bootstrapToken }, null, 2));
writeFileSync("data/deploy/local-pre-cloud-backup.json", JSON.stringify(state));
console.log(
  JSON.stringify({
    vehicles: state.vehicles.length,
    active: state.vehicles.filter((v) => v.active).length,
    fuels: state.fuels.length,
    services: state.services.length,
    issues: state.issues.length,
    plans: state.plans.length,
  }),
);
