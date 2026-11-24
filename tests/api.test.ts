import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { today } from "../src/domain.ts";
async function harness(
  fn: (h: {
    call: (
      p: string,
      b?: unknown,
      c?: string,
      t?: string,
    ) => Promise<{ status: number; data: any; cookie: string }>;
    store: Store;
    admin: string;
    token: string;
  }) => Promise<void>,
) {
  const store = new Store(":memory:"),
    server = createApp(store).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const call = async (p: string, b?: unknown, c = "", t = "") => {
    const r = await fetch(`http://127.0.0.1:${address.port}/api${p}`, {
      method: b ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: c,
        "X-Report-Token": t,
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    });
    const txt = await r.text();
    return {
      status: r.status,
      data: r.headers.get("content-type")?.includes("json")
        ? JSON.parse(txt)
        : txt,
      cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  try {
    const admin = (
      await call("/login", {
        email: "admin@bubu.local",
        password: "BubuDemo2026!",
      })
    ).cookie;
    const link = (await call("/report-link", undefined, admin)).data.path;
    await fn({ call, store, admin, token: link.split("#")[1] });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
  }
}
const report = () => ({
  requestKey: randomUUID(),
  vehicleId: "v1",
  kind: "fault",
  description: "Při brzdění slyším neobvyklý zvuk.",
  severity: "minor",
  immobilize: false,
  reporterName: "Jan",
  website: "",
});
test("správa vyžaduje účet správce; instruktor se nepřihlašuje a odkaz nedává přístup do správy", () =>
  harness(async ({ call, token }) => {
    assert.equal((await call("/state")).status, 401);
    assert.equal((await call("/report-link")).status, 401);
    assert.equal((await call("/state", undefined, "", token)).status, 401);
    assert.equal(
      (
        await call("/login", {
          email: "ucitel@bubu.local",
          password: "BubuDemo2026!",
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("/login", { email: "admin@bubu.local", password: "wrong" }))
        .status,
      401,
    );
  }));
test("formulář vyžaduje platný odkaz a zveřejní jen výběr aktivních vozidel", () =>
  harness(async ({ call, store, token }) => {
    const s = store.load();
    s.vehicles[0].active = false;
    store.save(s);
    assert.equal((await call("/reporting/vehicles")).status, 403);
    assert.equal(
      (await call("/reporting/vehicles", undefined, "", "é".repeat(43))).status,
      403,
    );
    const r = await call("/reporting/vehicles", undefined, "", token);
    assert.equal(r.status, 200);
    assert.equal(r.data.vehicles.length, 4);
    assert.deepEqual(Object.keys(r.data.vehicles[0]).sort(), [
      "id",
      "kind",
      "label",
      "plate",
    ]);
    assert.equal(r.data.issues, undefined);
  }));
test("hlášení bez účtu přijde správci bez vytvoření uživatelského profilu", () =>
  harness(async ({ call, store, token, admin }) => {
    const users = store.load().users.length,
      r = await call("/reporting/submit", report(), "", token);
    assert.equal(r.status, 201);
    assert.match(r.data.receipt, /^H-/);
    const s = store.load(),
      i = s.issues.at(-1)!;
    assert.equal(i.owner, null);
    assert.equal(i.reporterName, "Jan");
    assert.equal(i.reporterChannel, "link");
    assert.equal(i.status, "new");
    assert.equal(s.users.length, users);
    assert.equal(s.audit.at(-1)?.actor, null);
    const visible = (await call("/state", undefined, admin)).data;
    assert(visible.issues.some((v: any) => v.id === i.id));
  }));
test("jméno je povinné; falešný vlastník nebo stav z těla se nepřijme", () =>
  harness(async ({ call, store, token }) => {
    for (const reporterName of [undefined, "", "   "]) {
      const invalid = await call(
        "/reporting/submit",
        { ...report(), reporterName },
        "",
        token,
      );
      assert.equal(invalid.status, 400);
    }
    const r = await call(
      "/reporting/submit",
      {
        ...report(),
        reporterName: " Jan ",
        owner: "admin",
        status: "resolved",
      },
      "",
      token,
    );
    assert.equal(r.status, 201);
    const i = store.load().issues.at(-1)!;
    assert.equal(i.reporterName, "Jan");
    assert.equal(i.owner, null);
    assert.equal(i.status, "new");
  }));
test("paralelní opakování formuláře vytvoří jediné hlášení, změněné tělo se stejným klíčem je odmítnuto", () =>
  harness(async ({ call, store, token }) => {
    const b = report(),
      rs = await Promise.all(
        Array.from({ length: 8 }, () =>
          call("/reporting/submit", b, "", token),
        ),
      );
    assert(rs.every((r) => r.status === 201));
    assert.equal(new Set(rs.map((r) => r.data.receipt)).size, 1);
    assert.equal(store.load().issues.length, 2);
    assert.equal(
      (
        await call(
          "/reporting/submit",
          { ...b, description: "Jiné hlášení se stejným klíčem." },
          "",
          token,
        )
      ).status,
      409,
    );
  }));
test("nehoda s fotografií se uloží atomicky; fotografie není dostupná přes veřejný odkaz", () =>
  harness(async ({ call, store, token, admin }) => {
    const photo = {
      name: "nehoda.png",
      mime: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV9kAAAAASUVORK5CYII=",
    };
    assert.equal(
      (
        await call(
          "/reporting/submit",
          {
            ...report(),
            kind: "accident",
            severity: "serious",
            immobilize: true,
            photo,
          },
          "",
          token,
        )
      ).status,
      201,
    );
    const s = store.load(),
      i = s.issues.at(-1)!;
    assert.equal(i.kind, "accident");
    assert.equal(s.vehicles[0].unavailable, true);
    assert.equal(s.attachments[0].owner, null);
    assert.equal(
      (await call("/attachments/" + i.attachmentId, undefined, "", token))
        .status,
      401,
    );
    assert.equal(
      (await call("/attachments/" + i.attachmentId, undefined, admin)).status,
      200,
    );
  }));
test("neplatná fotografie, vyřazené vozidlo a honeypot nezanechají hlášení ani přílohu", () =>
  harness(async ({ call, store, token }) => {
    assert.equal(
      (
        await call(
          "/reporting/submit",
          {
            ...report(),
            photo: { name: "x.png", mime: "image/png", data: "YmFk" },
          },
          "",
          token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          "/reporting/submit",
          { ...report(), website: "bot" },
          "",
          token,
        )
      ).status,
      400,
    );
    const s = store.load();
    s.vehicles[0].active = false;
    store.save(s);
    assert.equal(
      (await call("/reporting/submit", report(), "", token)).status,
      400,
    );
    assert.equal(store.load().issues.length, 1);
    assert.equal(store.load().attachments.length, 0);
  }));
test("lokální omezení počtu hlášení a idempotentní opakování fungují společně", () =>
  harness(async ({ call, token, store }) => {
    const first = report();
    assert.equal(
      (await call("/reporting/submit", first, "", token)).status,
      201,
    );
    for (let n = 1; n < 20; n++)
      assert.equal(
        (await call("/reporting/submit", report(), "", token)).status,
        201,
      );
    assert.equal(
      (await call("/reporting/submit", report(), "", token)).status,
      429,
    );
    assert.equal(
      (await call("/reporting/submit", first, "", token)).status,
      201,
    );
    assert.equal(store.load().issues.length, 21);
  }));
test("ruční tankování a samostatné provozní odečty jsou uzavřené i pro správce", () =>
  harness(async ({ call, admin, store }) => {
    for (const action of [
      "fuel.save",
      "fuel.review",
      "fuel.correction",
      "reading.save",
    ])
      assert.equal(
        (await call("/command", { action, payload: {} }, admin)).status,
        403,
      );
    assert.equal(store.load().fuels.length, 4);
  }));
test("správce zpracuje hlášení, doplní servis a ochrání správu rolí", () =>
  harness(async ({ call, store, admin }) => {
    const m = (
      await call("/login", {
        email: "spravce@bubu.local",
        password: "BubuDemo2026!",
      })
    ).cookie;
    assert.equal(
      (
        await call(
          "/command",
          {
            action: "issue.review",
            payload: {
              id: "i1",
              status: "resolved",
              response: "Opraveno.",
              serviceId: null,
            },
          },
          m,
        )
      ).status,
      200,
    );
    assert.equal(
      (await call("/command", { action: "user.save", payload: {} }, m)).status,
      403,
    );
    assert.equal(
      (
        await call(
          "/command",
          {
            action: "user.save",
            payload: {
              name: "Instruktor",
              email: "test@bubu.local",
              role: "teacher",
              active: true,
              password: "DlouheHeslo123!",
            },
          },
          admin,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          "/command",
          {
            action: "user.save",
            payload: {
              id: "admin",
              name: "Admin",
              email: "admin@bubu.local",
              role: "manager",
              active: true,
            },
          },
          admin,
        )
      ).status,
      400,
    );
    assert.equal(store.load().issues[0].status, "resolved");
  }));
test("vyřazení vozidla zachová historii a odmítne nové hlášení na vyřazené vozidlo", () =>
  harness(async ({ call, store, admin, token }) => {
    const before = store.load();
    assert.equal(
      (
        await call(
          "/command",
          {
            action: "vehicle.retire",
            payload: { id: "v1", date: today(), reason: "Prodej vozidla" },
          },
          admin,
        )
      ).status,
      200,
    );
    const after = store.load();
    assert.equal(after.vehicles[0].active, false);
    assert.equal(after.fuels.length, before.fuels.length);
    assert.equal(after.services.length, before.services.length);
    assert.equal(
      (await call("/reporting/submit", report(), "", token)).status,
      400,
    );
  }));
test("RZ se normalizuje a audit plánu zachová stav před změnou", () =>
  harness(async ({ call, store, admin }) => {
    const s = store.load();
    assert.equal(
      (
        await call(
          "/command",
          {
            action: "vehicle.save",
            payload: {
              ...s.vehicles[0],
              id: undefined,
              plate: "1 ab 2345",
              km: 10,
              date: today(),
            },
          },
          admin,
        )
      ).status,
      400,
    );
    const p = s.plans[0];
    assert.equal(
      (
        await call(
          "/command",
          {
            action: "plan.save",
            payload: { ...p, responsible: "Nová odpovědná osoba" },
          },
          admin,
        )
      ).status,
      200,
    );
    assert.equal(
      (store.load().audit.at(-1)?.before as any).responsible,
      p.responsible,
    );
  }));
test("servis navrhne jen příslušný plán a bez km neprovede potvrzení", () =>
  harness(async ({ call, store, admin }) => {
    const r = await call(
      "/command",
      {
        action: "service.save",
        payload: {
          vehicleId: "v1",
          date: today(),
          km: null,
          items: [
            {
              kind: "action",
              name: "Motorový olej a filtr",
              reason: "Preventivní výměna",
              price: 1500,
            },
          ],
          total: null,
          workshop: "Dílna",
          note: "",
          attachmentId: null,
        },
      },
      admin,
    );
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.pendingPlanIds, ["p1"]);
    const b = {
      serviceId: r.data.id,
      planId: "p1",
      lastDate: today(),
      lastKm: null,
    };
    assert.equal(
      (await call("/command", { action: "service.confirm", payload: b }, admin))
        .status,
      400,
    );
    assert.equal(
      (
        await call(
          "/command",
          { action: "service.confirm", payload: { ...b, lastKm: 148300 } },
          admin,
        )
      ).status,
      200,
    );
    assert.equal(store.load().plans[0].lastKm, 148300);
  }));
test("obnova správcovského hesla je jednorázová a zruší původní relace", () =>
  harness(async ({ call, admin }) => {
    const r = await call("/reset-request", { email: "admin@bubu.local" }),
      b = { token: r.data.demoToken, password: "ZcelaNoveHeslo123!" };
    assert.equal((await call("/reset-password", b)).status, 200);
    assert.equal((await call("/reset-password", b)).status, 400);
    assert.equal((await call("/state", undefined, admin)).status, 401);
  }));
