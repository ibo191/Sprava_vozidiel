import { createApp } from "./app.ts";
import express from "express";
import path from "node:path";
import { watchFile } from "node:fs";
import type { Server } from "node:http";
import { Store } from "./store.ts";
import { activeDatabase, activeDatabaseFile } from "./active-database.ts";
let database = activeDatabase(),
  store: Store,
  server: Server;
function start() {
  store = new Store(database);
  const app = createApp(store);
  app.use(express.static("dist"));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
  server = app.listen(3001, "127.0.0.1", () =>
    console.log("BuBu lokální API: http://127.0.0.1:3001 — " + database),
  );
}
start();
let switching = false;
watchFile(activeDatabaseFile, { interval: 1000 }, () => {
  try {
    const next = activeDatabase();
    if (next === database || switching) return;
    // Local import activation closes old sessions. No in-flight synchronous command
    // can overlap the switch, and the original database stays available for rollback.
    switching = true;
    server.close(() => {
      store.db.close();
      database = next;
      start();
      switching = false;
    });
  } catch (e) {
    console.error("Databáze nebyla přepnuta:", (e as Error).message);
  }
});
