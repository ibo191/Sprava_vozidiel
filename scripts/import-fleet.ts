import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { backup } from "node:sqlite";
import { Store } from "../server/store.ts";
import { importFleet } from "../server/import-fleet.ts";
const source =
  process.argv.find((a) => a.startsWith("--source="))?.slice(9) ||
  "data/imports/moje-autoskola-fleet.json";
const snapshot = JSON.parse(readFileSync(source, "utf8"));
const destination = "data/bubu-imported.sqlite";
let target: Store | undefined;
let fresh = false;
if (existsSync(destination)) target = new Store(destination);
let result = importFleet(snapshot, target?.load());
console.log(JSON.stringify(result.report, null, 2));
writeFileSync(
  "data/imports/fleet-import-report.json",
  JSON.stringify(
    { report: result.report, dataset: result.state.dataset },
    null,
    2,
  ),
);
if (!process.argv.includes("--apply")) {
  target?.db.close();
  console.log(
    "Kontrola dokončena. Pro zápis a přepnutí lokální aplikace použijte --apply.",
  );
  process.exit(0);
}
if(target&&!result.report.unchanged){mkdirSync('data/backups',{recursive:true});await backup(target.db,'data/backups/bubu-imported-before-'+Date.now()+'.sqlite');}
if (!target) {
  fresh = true;
  // A separate consistent SQLite copy keeps every demo/manual record intact.
  const original = new Store("data/bubu.sqlite");
  await backup(original.db, destination);
  original.db.close();
  target = new Store(destination);
  const originalUsers = target.load().users;
  result.state.users = [
    ...originalUsers,
    ...result.state.users.filter(
      (u) => !originalUsers.some((o) => o.id === u.id),
    ),
  ];
}
target.transaction(() => {
  // Re-read under the write lock, so an intervening local edit is never lost.
  if (!fresh) result = importFleet(snapshot, target!.load());
  target!.save(result.state);
  if (fresh) target!.db.exec("DELETE FROM fuel_codes");
  for (const f of result.state.fuels) {
    const row = target!.db
      .prepare("SELECT fuel_id FROM fuel_codes WHERE code=?")
      .get(f.code) as { fuel_id: string } | undefined;
    if (row && row.fuel_id !== f.id)
      throw new Error("Kolize kódu účtenky; import byl vrácen zpět.");
    if (!row)
      target!.db
        .prepare("INSERT INTO fuel_codes VALUES(?,?,?)")
        .run(f.code, "import:" + f.id, f.id);
  }
});
target.db.close();
writeFileSync(
  "data/active-database.json.tmp",
  JSON.stringify({ database: "bubu-imported.sqlite" }, null, 2),
);
renameSync("data/active-database.json.tmp", "data/active-database.json");
console.log(
  "Import aktivován v oddělené databázi. Původní data/bubu.sqlite je zachována.",
);
