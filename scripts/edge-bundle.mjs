import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

// Keep a single implementation of validation and commands for local and hosted APIs.
export function edgeFiles() {
  const files = [
    "supabase/functions/fleet-api/index.ts",
    "supabase/functions/fleet-api/deno.json",
  ].map((p) => ({
    name: p.split("/").pop(),
    content: readFileSync(p, "utf8"),
  }));
  for (const name of [
    "server/cloud-handler.ts",
    "server/commands.ts",
    "server/http-error.ts",
    "server/attachments.ts",
    "src/domain.ts",
    "src/catalog.ts",
  ])
    files.push({ name, content: readFileSync(name, "utf8") });
  return files;
}
if (process.argv[1]?.endsWith("edge-bundle.mjs")) {
  mkdirSync("data/deploy", { recursive: true });
  writeFileSync("data/deploy/edge-files.json", JSON.stringify(edgeFiles()));
  if (process.argv.includes("--stage"))
    for (const file of edgeFiles()) {
      if (!file.name.includes("/")) continue;
      const path = "supabase/functions/fleet-api/" + file.name;
      mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      writeFileSync(path, file.content);
    }
  console.log("Edge bundle prepared (shared domain and server sources).");
}
