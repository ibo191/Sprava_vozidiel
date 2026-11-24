import { applyCommand } from "./commands.ts";
import express from "express";
import { randomBytes } from "node:crypto";
import { z, ZodError } from "zod";
import { Store, id } from "./store.ts";
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
  type User,
  type State,
} from "../src/domain.ts";
import { HttpError } from "./http-error.ts";
import { parseAttachment } from "./attachments.ts";
import { registerReporting, reportToken } from "./reporting.ts";
function assert(ok: unknown, message: string, status = 400): asserts ok {
  if (!ok) throw new HttpError(status, message);
}
export function createApp(store = new Store()) {
  const app = express();
  const sessions = new Map<string, { userId: string; expires: number }>(),
    resets = new Map<string, { userId: string; expires: number }>();
  const attempts = new Map<string, { count: number; until: number }>();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8mb" }));
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers.origin &&
      !/^http:\/\/(localhost|127\.0\.0\.1):(5173|3001)$/.test(
        req.headers.origin,
      )
    )
      return res.status(403).json({ error: "Nepovolený původ požadavku." });
    next();
  });
  registerReporting(app, store);
  const safeUser = (u: User) => u;
  app.post("/api/login", (req, res, next) => {
    try {
      const { email, password } = z
        .object({ email: z.string().email(), password: z.string().max(200) })
        .parse(req.body);
      const key = (req.ip ?? "") + email,
        a = attempts.get(key);
      assert(
        !a || a.until < Date.now() || a.count < 10,
        "Příliš mnoho pokusů. Zkuste to za 15 minut.",
        429,
      );
      const u = store
        .load()
        .users.find((u) => u.email === email.toLowerCase() && u.active);
      if (!u || !store.verify(u.id, password)) {
        attempts.set(key, {
          count: a && a.until > Date.now() ? a.count + 1 : 1,
          until: Date.now() + 900000,
        });
        throw new HttpError(401, "Nesprávný e-mail nebo heslo.");
      }
      assert(
        manager(u),
        "Instruktoři hlásí závady přes odkaz bez přihlášení.",
        403,
      );
      attempts.delete(key);
      const token = randomBytes(32).toString("hex");
      sessions.set(token, { userId: u.id, expires: Date.now() + 8 * 3600000 });
      res
        .cookie("bubu_session", token, {
          httpOnly: true,
          sameSite: "strict",
          maxAge: 8 * 3600000,
          path: "/",
        })
        .json(safeUser(u));
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/reset-request", (req, res, next) => {
    try {
      const email = z.string().email().parse(req.body.email);
      const u = store
        .load()
        .users.find((u) => u.email === email && u.active && manager(u));
      let demoToken: string | undefined;
      if (u) {
        demoToken = randomBytes(32).toString("hex");
        resets.set(demoToken, { userId: u.id, expires: Date.now() + 900000 });
      }
      res.json({
        message:
          "DEMO: e-mail se neodesílá. Pro existující demo účet je odkaz zobrazen zde.",
        demoToken,
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/reset-password", (req, res, next) => {
    try {
      const b = z
        .object({ token: z.string(), password: z.string().min(12).max(200) })
        .parse(req.body);
      const r = resets.get(b.token);
      assert(r && r.expires > Date.now(), "Odkaz vypršel nebo už byl použit.");
      store.password(r.userId, b.password);
      resets.delete(b.token);
      for (const [k, s] of sessions)
        if (s.userId === r.userId) sessions.delete(k);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", (req, res, next) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("bubu_session="))
      ?.slice(13);
    const sess = token ? sessions.get(token) : undefined;
    const u =
      sess && sess.expires > Date.now()
        ? store.load().users.find((u) => u.id === sess.userId && u.active)
        : undefined;
    if (!u) return res.status(401).json({ error: "Přihlaste se prosím." });
    if (!manager(u))
      return res
        .status(403)
        .json({ error: "Správa je přístupná pouze správci a adminovi." });
    res.locals.user = u;
    res.locals.token = token;
    next();
  });
  app.get("/api/me", (_req, res) => res.json(res.locals.user));
  app.get("/api/report-link", (_req, res) =>
    res.json({ path: "/hlaseni#" + reportToken(store) }),
  );
  app.post("/api/logout", (_req, res) => {
    sessions.delete(res.locals.token);
    res.clearCookie("bubu_session", { path: "/" }).json({ ok: true });
  });
  app.get("/api/state", (_req, res) => {
    const u: User = res.locals.user,
      s = store.load();
    const visible = s;
    res.json({ ...visible, attachments: [] });
  });
  const ownAttachment = (s: State, u: User, aid: string | null) => {
    if (aid)
      assert(
        s.attachments.some(
          (a) => a.id === aid && (a.owner === u.id || manager(u)),
        ),
        "Příloha není dostupná.",
        403,
      );
  };
  app.get("/api/attachments/:id", (req, res, next) => {
    try {
      const s = store.load(),
        u: User = res.locals.user,
        a = s.attachments.find((a) => a.id === req.params.id);
      assert(a, "Příloha nenalezena.", 404);
      assert(
        manager(u) ||
          s.fuels.some((f) => f.attachmentId === a.id && f.owner === u.id) ||
          s.issues.some((i) => i.attachmentId === a.id && i.owner === u.id),
        "Přístup k příloze zamítnut.",
        403,
      );
      res.setHeader("Content-Type", a.mime);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="priloha.${a.mime === "application/pdf" ? "pdf" : a.mime === "image/png" ? "png" : "jpg"}"`,
      );
      res.send(Buffer.from(a.data, "base64"));
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/command", (req, res, next) => {
    try {
      const u: User = res.locals.user;
      const { action, payload } = z
        .object({ action: z.string(), payload: z.any() })
        .parse(req.body);
      assert(
        ![
          "fuel.save",
          "fuel.review",
          "fuel.correction",
          "reading.save",
        ].includes(action),
        "Tankování a provozní kilometry se přijímají pouze importem z Moje Autoškola.",
        403,
      );
      const result = store.transaction(() => {
        const s = store.load();
        const result = applyCommand(s, u, action, payload, {
          password: (id, pw) => store.password(id, pw),
        });
        store.save(s);
        return result;
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/export/:kind", (req, res, next) => {
    try {
      assert(manager(res.locals.user), "Export vyžaduje správce.", 403);
      const s = store.load();
      const csv = (v: unknown) =>
        '"' +
        String(v ?? "")
          .replace(/"/g, '""')
          .replace(/^[=+@\-\t\r]/, "'" + "$&") +
        '"';
      const kind = req.params.kind;
      const datasetLabel = s.dataset
        ? "Import Moje Autoškola (lokální)"
        : "DEMO";
      assert(["fuels", "services"].includes(kind), "Neznámý export.");
      const rows =
        kind === "fuels"
          ? [
              [
                "Původ dat",
                "Kód",
                "RZ",
                "Datum",
                "Km",
                "Litry",
                "Kč",
                "Plná",
                "Kontrola",
                "Doklad",
              ],
              ...s.fuels.map((f) => [
                s.dataset
                  ? f.source
                    ? "Import Moje Autoškola"
                    : "Lokální zápis"
                  : "DEMO",
                f.code,
                s.vehicles.find((v) => v.id === f.vehicleId)?.plate,
                f.date,
                f.km,
                f.liters,
                f.amount ?? "neuvedena",
                f.full,
                f.checked,
                f.receipt,
              ]),
            ]
          : [
              [
                "Původ dat",
                "RZ",
                "Datum",
                "Km",
                "Servis",
                "Úkony a materiál",
                "Cena Kč",
                "Poznámka",
              ],
              ...s.services.map((r) => [
                s.dataset
                  ? r.source
                    ? "Import Moje Autoškola"
                    : "Lokální zápis"
                  : "DEMO",
                s.vehicles.find((v) => v.id === r.vehicleId)?.plate,
                r.date,
                r.km ?? "neznámý",
                r.workshop,
                r.items.map((i) => `${i.name} (${i.reason})`).join("; "),
                r.total ??
                  (r.items.every((i) => i.price !== null)
                    ? r.items.reduce((a, i) => a + i.price!, 0)
                    : "neúplná"),
                r.note,
              ]),
            ];
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="bubu-${s.dataset ? "import" : "demo"}-${kind}.csv"`,
      );
      res.send("\ufeff" + rows.map((r) => r.map(csv).join(";")).join("\r\n"));
    } catch (e) {
      next(e);
    }
  });
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof ZodError)
        return res.status(400).json({
          error: err.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
      if (err instanceof HttpError)
        return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({
        error: "Operaci se nepodařilo dokončit. Změny nebyly uloženy.",
      });
    },
  );
  return app;
}
