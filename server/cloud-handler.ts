import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import { applyCommand } from "./commands.ts";
import { parseAttachment } from "./attachments.ts";
import { HttpError } from "./http-error.ts";
import { manager, today, type State, type User } from "../src/domain.ts";

export type Snapshot = {
  version: number;
  body: State;
  config: {
    origins: string[];
    reportToken: string;
    ipSalt: string;
    bootstrapHash?: string;
    importHash?: string;
  };
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
export function createCloudHandler(db: SupabaseClient) {
  async function rpc(name: string, args?: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args);
    if (error) throw error;
    return data;
  }
  async function snapshot(): Promise<Snapshot> {
    const s = await rpc("fleet_snapshot");
    if (!s) fail(503, "Aplikace ještě není připravena.");
    return s;
  }
  async function current(req: Request, s: Snapshot): Promise<User> {
    const bearer = req.headers.get("authorization")?.replace(/^Bearer /i, "");
    if (!bearer) fail(401, "Přihlaste se prosím.");
    const { data, error } = await db.auth.getUser(bearer);
    if (error || !data.user)
      fail(401, "Přihlášení vypršelo. Přihlaste se znovu.");
    const u = s.body.users.find(
      (x) => x.id === data.user!.id && x.active && manager(x),
    );
    if (!u)
      fail(403, "Správa je přístupná pouze aktivnímu správci a adminovi.");
    return u!;
  }
  function link(req: Request, s: Snapshot) {
    const value = req.headers.get("x-report-token") ?? "";
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(value) ||
      !same(value, s.config.reportToken)
    )
      fail(
        403,
        "Odkaz pro hlášení není platný. Požádejte správce o správný odkaz.",
      );
  }
  async function saveFiles(s: State) {
    const paths: string[] = [];
    try {
      for (const a of s.attachments.filter((x) => x.data && !x.storagePath)) {
        const path = `attachments/${a.id}`;
        const { error } = await db.storage
          .from("fleet-private")
          .upload(path, Buffer.from(a.data, "base64"), {
            contentType: a.mime,
            upsert: false,
          });
        if (error) throw error;
        paths.push(path);
        a.data = "";
        a.storagePath = path;
      }
      return paths;
    } catch (e) {
      if (paths.length) await db.storage.from("fleet-private").remove(paths);
      throw e;
    }
  }
  async function mutate(
    req: Request,
    run: (
      s: Snapshot,
      u: User | null,
    ) => Promise<{ result: unknown; commit?: Record<string, unknown> }>,
    anonymous = false,
  ) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const s = await snapshot();
      const u = anonymous ? null : await current(req, s);
      if (anonymous) link(req, s);
      const { result, commit } = await run(s, u);
      const paths = await saveFiles(s.body);
      try {
        const committed = await rpc("fleet_commit", {
          p_version: s.version,
          p_body: s.body,
          ...commit,
        });
        if (committed?.duplicate && paths.length)
          await db.storage.from("fleet-private").remove(paths);
        return committed?.duplicate ? { receipt: committed.receipt } : result;
      } catch (e) {
        if (paths.length) await db.storage.from("fleet-private").remove(paths);
        const code = (e as { code?: string }).code;
        if (code === "40001") continue;
        if (code === "23505")
          fail(409, "Stejný požadavek už byl uložen s jinými údaji.");
        if ((e as { message?: string }).message?.includes("rate_limit"))
          fail(
            429,
            "Příliš mnoho hlášení. Zkuste to později nebo kontaktujte správce.",
          );
        throw e;
      }
    }
    fail(409, "Evidence se právě změnila. Obnovte ji a zkuste operaci znovu.");
  }
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    let headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    };
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    try {
      const s = await snapshot();
      if (origin) {
        if (!s.config.origins.includes(origin))
          fail(403, "Nepovolený původ požadavku.");
        headers = {
          ...headers,
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
          "Access-Control-Allow-Headers":
            "authorization, content-type, x-report-token, x-bootstrap-token, apikey",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        };
      }
      if (req.method === "OPTIONS")
        return new Response(null, { status: 204, headers });
      const pathname = new URL(req.url).pathname;
      const path = pathname.includes("/api/")
        ? pathname.slice(pathname.indexOf("/api/") + 4)
        : pathname;
      if (req.method === "GET" && path === "/health")
        return json({ ok: true, mode: "cloud" });
      let body: any;
      if (req.method === "POST") {
        if (Number(req.headers.get("content-length") ?? 0) > 8 * 1024 * 1024)
          fail(413, "Příloha je příliš velká.");
        const raw = await req.text();
        if (raw.length > 8 * 1024 * 1024) fail(413, "Příloha je příliš velká.");
        try {
          body = JSON.parse(raw);
        } catch {
          fail(400, "Neplatný požadavek.");
        }
      }
      // One-use administrator initialization; no invitation e-mail is sent.
      if (req.method === "POST" && path === "/bootstrap") {
        const token = req.headers.get("x-bootstrap-token") ?? "";
        if (
          !s.config.bootstrapHash ||
          !same(hash(token), s.config.bootstrapHash)
        )
          fail(403, "Inicializace není dostupná.");
        const b = z
          .object({
            email: z.string().email(),
            redirectTo: z.string().url(),
            state: z.unknown(),
          })
          .parse(body);
        if (!s.config.origins.includes(new URL(b.redirectTo).origin))
          fail(400, "Nepovolená adresa.");
        if (
          !s.config.importHash ||
          hash(JSON.stringify(b.state)) !== s.config.importHash
        )
          fail(400, "Import neodpovídá připravené záloze.");
        s.body = b.state as State;
        const { data, error } = await db.auth.admin.createUser({
          email: b.email,
          password: crypto.randomUUID() + crypto.randomUUID(),
          email_confirm: true,
        });
        if (error || !data.user)
          fail(
            400,
            "Administrátora nelze vytvořit. Ověřte, zda už účet neexistuje.",
          );
        const admin: User = {
          id: data.user!.id,
          email: b.email.toLowerCase(),
          name: "Jakub Abraham",
          role: "admin",
          active: true,
        };
        const bootstrapFiles: string[] = [];
        try {
          bootstrapFiles.push(...(await saveFiles(s.body)));
          s.body.users.push(admin);
          s.body.audit.push({
            id: crypto.randomUUID(),
            actor: admin.id,
            at: new Date().toISOString(),
            entity: "user",
            entityId: admin.id,
            before: null,
            after: admin,
          });
          await rpc("fleet_commit", { p_version: s.version, p_body: s.body });
        } catch (e) {
          if (bootstrapFiles.length)
            await db.storage.from("fleet-private").remove(bootstrapFiles);
          await db.auth.admin.deleteUser(admin.id);
          throw e;
        }
        // The secret is disabled in SQL atomically by fleet_finish_bootstrap.
        await rpc("fleet_finish_bootstrap", { p_hash: hash(token) });
        const recovery = await db.auth.admin.generateLink({
          type: "recovery",
          email: admin.email,
          options: { redirectTo: b.redirectTo },
        });
        if (recovery.error || !recovery.data.properties)
          fail(
            503,
            "Účet vytvořen, odkaz pro nastavení hesla nyní nelze vytvořit.",
          );
        return json({
          setupLink: recovery.data.properties!.action_link,
          userId: admin.id,
        });
      }
      if (path.startsWith("/reporting/")) {
        link(req, s);
        const ip =
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        const ipKey = hash(s.config.ipSalt + ip);
        // Supabase gateway supplies x-forwarded-for. The shared key quota also bounds spoofing/IP churn.
        if (req.method === "GET" && path === "/reporting/vehicles") {
          if (
            !(await rpc("fleet_limit", {
              p_key: "options:" + ipKey,
              p_max: 120,
              p_seconds: 60,
            }))
          )
            fail(429, "Příliš mnoho požadavků.");
          return json({
            vehicles: s.body.vehicles
              .filter((v) => v.active)
              .map((v) => ({
                id: v.id,
                label: [v.brand, v.model].filter(Boolean).join(" "),
                plate: v.plate,
                kind: v.kind,
              })),
          });
        }
        if (req.method === "POST" && path === "/reporting/submit") {
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
            .parse(body);
          if (b.website) fail(400, "Hlášení nelze přijmout.");
          if (b.immobilize && b.severity !== "serious")
            fail(400, "Odstavení vyžaduje vážnou závadu.");
          const photo = b.photo ? parseAttachment(b.photo) : null;
          if (photo?.mime === "application/pdf")
            fail(400, "Přiložte fotografii JPG nebo PNG.");
          const fingerprint = hash(JSON.stringify({ ...b, photo }));
          const previous = await rpc("fleet_receipt", { p_key: b.requestKey });
          if (previous) {
            if (previous.fingerprint !== fingerprint)
              fail(409, "Stejný požadavek už byl uložen s jinými údaji.");
            return json({ receipt: previous.receipt });
          }
          if (
            !(await rpc("fleet_limit", {
              p_key: "all-reports:" + hash(s.config.reportToken),
              p_max: 200,
              p_seconds: 3600,
            }))
          )
            fail(429, "Byl dosažen limit formuláře. Kontaktujte správce.");
          return json(
            await mutate(
              req,
              async (snap) => {
                const state = snap.body,
                  v = state.vehicles.find(
                    (x) => x.id === b.vehicleId && x.active,
                  );
                if (!v) fail(400, "Vozidlo není aktivní.");
                const id = crypto.randomUUID(),
                  attachmentId = photo ? crypto.randomUUID() : null,
                  receipt = "H-" + id.toUpperCase();
                if (photo)
                  state.attachments.push({
                    id: attachmentId!,
                    owner: null,
                    ...photo,
                  });
                const issue = {
                  id,
                  owner: null,
                  vehicleId: v!.id,
                  date: today(),
                  kind: b.kind,
                  description: b.description,
                  severity: b.severity,
                  immobilize: b.immobilize,
                  status: "new" as const,
                  response: "",
                  supplement: "",
                  serviceId: null,
                  attachmentId,
                  reporterName: b.reporterName || null,
                  reporterChannel: "link" as const,
                };
                state.issues.push(issue);
                if (b.immobilize) {
                  const before = structuredClone(v);
                  v!.unavailable = true;
                  state.audit.push({
                    id: crypto.randomUUID(),
                    actor: null,
                    at: new Date().toISOString(),
                    entity: "vehicle",
                    entityId: v!.id,
                    before,
                    after: structuredClone(v),
                  });
                }
                state.audit.push({
                  id: crypto.randomUUID(),
                  actor: null,
                  at: new Date().toISOString(),
                  entity: "issue",
                  entityId: id,
                  before: null,
                  after: issue,
                });
                return {
                  result: { receipt },
                  commit: {
                    p_request_key: b.requestKey,
                    p_fingerprint: fingerprint,
                    p_receipt: receipt,
                    p_limit_key: "report:" + ipKey,
                  },
                };
              },
              true,
            ),
            201,
          );
        }
        fail(404, "Neznámý požadavek.");
      }
      const u = await current(req, s);
      if (req.method === "GET" && path === "/me") return json(u);
      if (req.method === "GET" && path === "/state")
        return json({ ...s.body, attachments: [] });
      if (req.method === "GET" && path === "/report-link")
        return json({ path: "/hlaseni#" + s.config.reportToken });
      if (req.method === "POST" && path === "/report-link/rotate") {
        if (u.role !== "admin") fail(403, "Pouze admin může změnit odkaz.");
        const token = Buffer.from(
          crypto.getRandomValues(new Uint8Array(32)),
        ).toString("base64url");
        await rpc("fleet_rotate_link", {
          p_version: s.version,
          p_token: token,
          p_actor: u.id,
        });
        return json({ path: "/hlaseni#" + token });
      }
      if (req.method === "GET" && path.startsWith("/attachments/")) {
        const a = s.body.attachments.find(
          (x) => x.id === path.split("/").pop(),
        );
        if (!a?.storagePath) fail(404, "Příloha nenalezena.");
        const { data, error } = await db.storage
          .from("fleet-private")
          .download(a!.storagePath!);
        if (error || !data) fail(404, "Příloha není dostupná.");
        return new Response(data!, {
          headers: {
            ...headers,
            "Content-Type": a!.mime,
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a!.name)}`,
          },
        });
      }
      if (req.method === "GET" && path.startsWith("/export/")) {
        const kind = path.split("/").pop();
        if (!["fuels", "services"].includes(kind!))
          fail(404, "Neznámý export.");
        const state = s.body,
          plate = (id: string) =>
            state.vehicles.find((v) => v.id === id)?.plate ?? "";
        const rows: unknown[][] =
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
                ],
                ...state.fuels.map((f) => [
                  f.source ? "Import Moje Autoškola" : "Evidence",
                  f.code,
                  plate(f.vehicleId),
                  f.date,
                  f.km,
                  f.liters,
                  f.amount ?? "neuvedena",
                  f.full,
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
                ...state.services.map((r) => [
                  r.source ? "Import Moje Autoškola" : "Evidence",
                  plate(r.vehicleId),
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
        const csv = (v: unknown) =>
          '"' +
          String(v ?? "")
            .replace(/^[=+@\-\t\r]/, "'$&")
            .replaceAll('"', '""') +
          '"';
        return new Response(
          "\ufeff" + rows.map((r) => r.map(csv).join(";")).join("\r\n"),
          {
            headers: {
              ...headers,
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="bubu-${kind}.csv"`,
            },
          },
        );
      }
      if (req.method === "POST" && path === "/command") {
        const { action, payload } = z
          .object({ action: z.string(), payload: z.any() })
          .parse(body);
        let createdUser: string | undefined;
        try {
          if (action === "user.save") {
            if (u.role !== "admin")
              fail(403, "Pouze admin může spravovat uživatele.");
            // Run all domain validation before creating an Auth identity.
            applyCommand(structuredClone(s.body), u, action, payload, {
              password: () => {},
            });
            const old = s.body.users.find((x) => x.id === payload.id);
            if (old && old.email !== payload.email.toLowerCase())
              fail(
                400,
                "E-mail existujícího účtu nelze změnit tímto formulářem. Vytvořte nový účet.",
              );
            if (!old) {
              const { data, error } = await db.auth.admin.createUser({
                email: payload.email,
                password: payload.password,
                email_confirm: true,
              });
              if (error || !data.user)
                fail(400, "Účet nelze vytvořit. Ověřte e-mail a sílu hesla.");
              createdUser = data.user!.id;
            }
          }
          return json(
            await mutate(req, async (snap, user) => ({
              result: applyCommand(snap.body, user!, action, payload, {
                password: () => {},
                newUserId: createdUser,
              }),
            })),
          );
        } catch (e) {
          if (createdUser) await db.auth.admin.deleteUser(createdUser);
          throw e;
        }
      }
      return fail(404, "Neznámý požadavek.");
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof ZodError)
        return json(
          {
            error: e.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          },
          400,
        );
      console.error("fleet-api failed", {
        code: (e as { code?: string }).code ?? "internal",
      });
      return json(
        {
          error:
            "Operaci se nepodařilo dokončit. Obnovte evidenci a ověřte výsledek před opakováním.",
        },
        500,
      );
    }
  };
}
