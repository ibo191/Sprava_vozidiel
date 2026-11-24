import type { Express } from "express";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { z } from "zod";
import { Store, id } from "./store.ts";
import { HttpError } from "./http-error.ts";
import { parseAttachment } from "./attachments.ts";
import { today, type Issue } from "../src/domain.ts";
export function reportToken(store: Store): string {
  store.db
    .prepare("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)")
    .run("report-token", randomBytes(32).toString("base64url"));
  return (
    store.db
      .prepare("SELECT value FROM settings WHERE key=?")
      .get("report-token") as { value: string }
  ).value;
}
export function registerReporting(app: Express, store: Store) {
  const attempts = new Map<string, { count: number; expires: number }>();
  app.use("/api/reporting", (req, res, next) => {
    try {
      const supplied = String(req.headers["x-report-token"] ?? ""),
        expected = reportToken(store);
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(supplied) ||
        supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        throw new HttpError(
          403,
          "Odkaz pro hlášení není platný. Požádejte správce o správný odkaz.",
        );
      res.setHeader("Referrer-Policy", "no-referrer");
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/reporting/vehicles", (_req, res) =>
    res.json({
      vehicles: store
        .load()
        .vehicles.filter((v) => v.active)
        .map((v) => ({
          id: v.id,
          label: [v.brand, v.model].filter(Boolean).join(" "),
          plate: v.plate,
          kind: v.kind,
        })),
    }),
  );
  app.post("/api/reporting/submit", (req, res, next) => {
    try {
      const b = z
        .object({
          requestKey: z.string().uuid(),
          vehicleId: z.string(),
          kind: z.enum(["fault", "accident"]).default("fault"),
          description: z.string().trim().min(5).max(3000),
          severity: z.enum(["minor", "serious"]),
          immobilize: z.boolean(),
          reporterName: z.string().trim().max(100).default(""),
          website: z.string().max(200).default(""),
          photo: z.unknown().optional(),
        })
        .parse(req.body);
      if (b.website) throw new HttpError(400, "Hlášení nelze přijmout.");
      if (b.immobilize && b.severity !== "serious")
        throw new HttpError(400, "Odstavení vyžaduje vážnou závadu.");
      const photo = b.photo ? parseAttachment(b.photo) : null;
      if (photo?.mime === "application/pdf")
        throw new HttpError(400, "Přiložte fotografii JPG nebo PNG.");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ ...b, photo }))
        .digest("hex");
      const result = store.transaction(() => {
        const old = store.db
          .prepare(
            "SELECT fingerprint,receipt FROM report_submissions WHERE request_key=?",
          )
          .get(b.requestKey) as
          | { fingerprint: string; receipt: string }
          | undefined;
        if (old) {
          if (old.fingerprint !== fingerprint)
            throw new HttpError(
              409,
              "Stejný požadavek už byl uložen s jinými údaji. Obnovte formulář.",
            );
          return { receipt: old.receipt };
        }
        const now = Date.now();
        for (const [key, a] of attempts)
          if (a.expires < now) attempts.delete(key);
        const key = createHash("sha256")
            .update(req.ip ?? "local")
            .digest("hex"),
          a = attempts.get(key);
        if ((a?.count ?? 0) >= 20 || attempts.size > 10000)
          throw new HttpError(
            429,
            "Příliš mnoho hlášení. Zkuste to později nebo kontaktujte správce.",
          );
        const s = store.load(),
          v = s.vehicles.find((v) => v.id === b.vehicleId && v.active);
        if (!v) throw new HttpError(400, "Vozidlo není aktivní.");
        const issueId = id(),
          aid = photo ? id() : null,
          receipt = "H-" + issueId.toUpperCase();
        if (photo) s.attachments.push({ id: aid!, owner: null, ...photo });
        const issue: Issue = {
          id: issueId,
          owner: null,
          vehicleId: v.id,
          date: today(),
          kind: b.kind,
          description: b.description,
          severity: b.severity,
          immobilize: b.immobilize,
          status: "new",
          response: "",
          supplement: "",
          serviceId: null,
          attachmentId: aid,
          reporterName: b.reporterName || null,
          reporterChannel: "link",
        };
        s.issues.push(issue);
        if (b.immobilize) {
          const before = structuredClone(v);
          v.unavailable = true;
          s.audit.push({
            id: id(),
            actor: null,
            at: new Date().toISOString(),
            entity: "vehicle",
            entityId: v.id,
            before,
            after: structuredClone(v),
          });
        }
        s.audit.push({
          id: id(),
          actor: null,
          at: new Date().toISOString(),
          entity: "issue",
          entityId: issue.id,
          before: null,
          after: structuredClone(issue),
        });
        store.db
          .prepare("INSERT INTO report_submissions VALUES(?,?,?,?)")
          .run(b.requestKey, issueId, fingerprint, receipt);
        store.save(s);
        attempts.set(key, {
          count: (a?.count ?? 0) + 1,
          expires: a?.expires ?? now + 3600000,
        });
        return { receipt };
      });
      res.status(201).json(result);
    } catch (e) {
      next(e);
    }
  });
}
