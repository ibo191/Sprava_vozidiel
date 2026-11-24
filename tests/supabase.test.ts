import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("Supabase SQL baseline: migrace, RLS, vlastnictví, uzavřené zápisy a soukromé přílohy", async () => {
  const db = new PGlite();
  try {
    // Minimal auth/storage contracts for actual PostgreSQL execution; not a Supabase runtime.
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth, storage to authenticated; grant execute on function auth.uid() to authenticated;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key,bucket_id text,name text); alter table storage.objects enable row level security; grant select on storage.objects to authenticated;`);
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/20261119211442_fleet_schema.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/20261123100014_import_provenance.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const admin = "00000000-0000-0000-0000-000000000001",
      teacher = "00000000-0000-0000-0000-000000000002",
      other = "00000000-0000-0000-0000-000000000003",
      vid = "00000000-0000-0000-0000-000000000004",
      aid = "00000000-0000-0000-0000-000000000005";
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/20261123115043_instructor_reports_and_retirement.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/20261123101255_service_import_provenance.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/20261124085252_link_reporting_scope.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(`insert into auth.users values('${admin}'),('${teacher}'),('${other}'); insert into public.profiles values('${admin}','Admin','admin',true),('${teacher}','Učitel','teacher',true),('${other}','Další','teacher',true);
   insert into public.vehicles(id,brand,model,year,plate,kind) values('${vid}','Škoda','Fabia',2020,'1 ab 2345','car');
   insert into public.attachments values('${aid}','${other}','doklad.pdf','private.pdf','application/pdf',200);
   insert into storage.objects values(gen_random_uuid(),'fleet-documents','private.pdf');
   insert into public.fuel_entries(vehicle_id,owner,date,km,liters,amount,full_tank,request_key,attachment_id) values('${vid}','${other}',current_date,100,10,400,true,gen_random_uuid(),'${aid}');
   insert into public.fuel_entries(vehicle_id,owner,date,km,liters,amount,full_tank,request_key) values('${vid}','${teacher}',current_date,100,20,800,true,gen_random_uuid());`);
    await db.exec(
      `update public.fuel_entries set amount=null,source_system='moje-autoskola',source_id='source-1' where owner='${other}'`,
    );
    assert.equal(
      (await db.query("select * from public.fuel_entries where amount is null"))
        .rows.length,
      1,
    );
    await assert.rejects(
      db.exec(
        `update public.fuel_entries set source_system='moje-autoskola',source_id='source-1' where owner='${teacher}'`,
      ),
    );
    await assert.rejects(
      db.exec(
        `insert into public.vehicles(brand,model,year,plate,kind) values('A','B',2020,'1AB2345','car')`,
      ),
    );
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${teacher}',false);`,
    );
    assert.equal(
      (await db.query("select * from public.fuel_entries")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.attachments")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.profiles")).rows.length,
      0,
    );
    await assert.rejects(
      db.exec(`update public.profiles set role='admin' where id='${teacher}'`),
    );
    await assert.rejects(db.exec("delete from public.fuel_entries"));
    await db.exec(
      `select set_config('request.jwt.claim.sub','${admin}',false)`,
    );
    assert.equal(
      (await db.query("select * from public.fuel_entries")).rows.length,
      2,
    );
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      1,
    );
    await db.exec(
      `reset role; update public.profiles set active=false where id='${teacher}'; set role authenticated; select set_config('request.jwt.claim.sub','${teacher}',false);`,
    );
    assert.equal(
      (await db.query("select * from public.vehicles")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
