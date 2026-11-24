import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createCloudHandler } from "../server/cloud-handler.ts";
import { seed } from "../server/store.ts";

async function setup() {
  const pg = new PGlite();
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  await pg.exec(
    readFileSync(
      "supabase/migrations/20261124091758_cloud_runtime.sql",
      "utf8",
    ),
  );
  const s = seed();
  await pg.query(
    "insert into private.fleet_runtime(body,config) values($1,$2)",
    [
      JSON.stringify(s),
      JSON.stringify({
        origins: ["https://fleet.example"],
        reportToken: "t".repeat(43),
        ipSalt: "test-salt",
      }),
    ],
  );
  const files = new Map<string, Uint8Array>();
  const client: any = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      try {
        const names = Object.keys(args),
          params = names.map((k, i) => `${k}=>$${i + 1}`).join(",");
        const r = await pg.query<{ value: any }>(
          `select public.${name}(${params}) as value`,
          names.map((k) =>
            typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k],
          ),
        );
        return { data: r.rows[0].value, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    auth: {
      getUser: async (token: string) => ({
        data: {
          user:
            token === "admin"
              ? { id: "admin" }
              : token === "teacher"
                ? { id: "teacher" }
                : null,
        },
        error: null,
      }),
    },
    storage: {
      from: () => ({
        upload: async (p: string, b: Uint8Array) => {
          files.set(p, b);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          paths.forEach((p) => files.delete(p));
          return { error: null };
        },
        download: async (p: string) => ({
          data: files.has(p) ? new Blob([new Uint8Array(files.get(p)!)]) : null,
          error: null,
        }),
      }),
    },
  };
  const handler = createCloudHandler(client);
  const req = (
    path: string,
    body?: unknown,
    token?: string,
    extra: Record<string, string> = {},
  ) =>
    handler(
      new Request("https://backend.example/functions/v1/fleet-api/api" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: "https://fleet.example",
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...extra,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  return { pg, client, req, files };
}
test("cloud: SQL role grants, private snapshot, stale writes, durable quota and receipt uniqueness", async () => {
  const { pg, client } = await setup();
  try {
    await pg.exec("set role anon");
    await assert.rejects(
      () => pg.query("select public.fleet_snapshot()"),
      /permission denied/,
    );
    await assert.rejects(
      () => pg.query("select * from private.fleet_runtime"),
      /permission denied/,
    );
    await pg.exec("reset role");
    const a = await client.rpc("fleet_snapshot");
    assert.equal(a.data.version, 0);
    const key = crypto.randomUUID();
    const args = {
      p_version: 0,
      p_body: a.data.body,
      p_request_key: key,
      p_fingerprint: "abc",
      p_receipt: "H-1",
      p_limit_key: "quota",
    };
    assert.equal((await client.rpc("fleet_commit", args)).data.version, 1);
    assert.equal((await client.rpc("fleet_commit", args)).data.duplicate, true);
    assert.equal(
      (await client.rpc("fleet_commit", { ...args, p_fingerprint: "changed" }))
        .error.code,
      "23505",
    );
    assert.equal(
      (await client.rpc("fleet_commit", { p_version: 0, p_body: a.data.body }))
        .error.code,
      "40001",
    );
    for (let i = 0; i < 19; i++)
      assert.equal(
        (
          await client.rpc("fleet_limit", {
            p_key: "quota",
            p_max: 20,
            p_seconds: 3600,
          })
        ).data,
        true,
      );
    assert.equal(
      (
        await client.rpc("fleet_limit", {
          p_key: "quota",
          p_max: 20,
          p_seconds: 3600,
        })
      ).data,
      false,
    );
    await pg.exec("set role service_role");
    assert.equal((await client.rpc("fleet_snapshot")).data.version, 1);
  } finally {
    await pg.close();
  }
});
test("cloud: accountless photo report, private storage, idempotency, manager roles, imports only", async () => {
  const { pg, req, files } = await setup();
  try {
    assert.equal((await req("/state")).status, 401);
    assert.equal((await req("/state", undefined, "teacher")).status, 403);
    assert.equal((await req("/reporting/vehicles")).status, 403);
    const headers = { "x-report-token": "t".repeat(43) };
    const options = await (
      await req("/reporting/vehicles", undefined, undefined, headers)
    ).json();
    assert.ok(options.vehicles.length > 0);
    assert.equal(options.vehicles[0].unavailable, undefined);
    const body = {
      requestKey: crypto.randomUUID(),
      vehicleId: "v1",
      kind: "accident",
      severity: "serious",
      immobilize: true,
      description: "TEST izolovaný, poškozené světlo",
      reporterName: "Testovací instruktor",
      photo: {
        name: "photo.png",
        mime: "image/png",
        data: Buffer.from("89504e470d0a1a0a", "hex").toString("base64"),
      },
    };
    for (const reporterName of [undefined, "", "   "]) {
      const invalid = await req(
        "/reporting/submit",
        { ...body, reporterName },
        undefined,
        headers,
      );
      assert.equal(invalid.status, 400);
    }
    const first = await req("/reporting/submit", body, undefined, headers);
    assert.equal(first.status, 201);
    const receipt = await first.json();
    const repeated = await req("/reporting/submit", body, undefined, headers);
    assert.deepEqual(await repeated.json(), receipt);
    assert.equal(
      (
        await req(
          "/reporting/submit",
          { ...body, description: "Změna těla" },
          undefined,
          headers,
        )
      ).status,
      409,
    );
    assert.equal(files.size, 1);
    const state = await (await req("/state", undefined, "admin")).json();
    const issue = state.issues.find(
      (i: any) => i.description === body.description,
    );
    assert.ok(issue);
    assert.equal(issue.owner, null);
    assert.deepEqual(state.attachments, []);
    assert.equal((await req("/attachments/" + issue.attachmentId)).status, 401);
    assert.equal(
      (await req("/attachments/" + issue.attachmentId, undefined, "teacher"))
        .status,
      403,
    );
    assert.equal(
      (await req("/attachments/" + issue.attachmentId, undefined, "admin"))
        .status,
      200,
    );
    assert.equal(
      (await req("/command", { action: "fuel.save", payload: {} }, "admin"))
        .status,
      403,
    );
    assert.equal(
      (
        await req(
          "/command",
          {
            action: "issue.review",
            payload: {
              id: issue.id,
              status: "resolved",
              response: "Opraveno",
              serviceId: null,
            },
          },
          "admin",
        )
      ).status,
      200,
    );
    const done = await (await req("/state", undefined, "admin")).json();
    assert.equal(
      done.issues.find((i: any) => i.id === issue.id).status,
      "resolved",
    );
    assert.equal(
      done.vehicles.find((v: any) => v.id === "v1").unavailable,
      true,
    );
    const service = done.services[0];
    const edit = {
      ...service,
      total: 5555,
      expectedRevision: service.revision ?? 0,
    };
    assert.equal(
      (
        await req(
          "/command",
          { action: "service.update", payload: edit },
          "admin",
        )
      ).status,
      200,
    );
    const corrected = await (await req("/state", undefined, "admin")).json();
    assert.equal(corrected.services[0].total, 5555);
    assert.equal(corrected.services.length, done.services.length);
    assert.equal(
      (
        await req(
          "/command",
          { action: "service.update", payload: edit },
          "admin",
        )
      ).status,
      409,
    );
    const readingId = corrected.readings[0].id;
    assert.equal(
      (
        await req(
          "/command",
          {
            action: "reading.delete",
            payload: { id: readingId, reason: "Test chybných km" },
          },
          "admin",
        )
      ).status,
      200,
    );
    const withoutReading = await (
      await req("/state", undefined, "admin")
    ).json();
    assert.equal(
      withoutReading.readings.some((r: any) => r.id === readingId),
      false,
    );
    assert.equal(withoutReading.fuels.length, corrected.fuels.length);
    assert.equal(
      (
        await req(
          "/command",
          { action: "reading.restore", payload: { id: readingId } },
          "admin",
        )
      ).status,
      200,
    );
    const planId = corrected.plans[0].id;
    assert.equal(
      (
        await req(
          "/command",
          {
            action: "plan.delete",
            payload: { id: planId, reason: "Zkušební plán" },
          },
          "admin",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await req(
          "/command",
          { action: "plan.restore", payload: { id: planId } },
          "admin",
        )
      ).status,
      200,
    );
    const bad = await req("/health", undefined, undefined, {
      Origin: "https://evil.example",
    });
    assert.equal(bad.status, 403);
  } finally {
    await pg.close();
  }
});
