-- Baseline for a future Supabase adapter. Not wired to the local demo API.
-- Browser writes are deliberately closed; writes require a trusted, validated API.
create schema if not exists private;
revoke all on schema private from public;
create type public.fleet_role as enum ('teacher','manager','admin');
create table public.profiles (
 id uuid primary key references auth.users(id), name text not null, role public.fleet_role not null default 'teacher', active boolean not null default true
);
create function private.is_manager() returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and active and role in ('manager','admin'))
$$;
create function private.is_member() returns boolean language sql stable security definer set search_path = '' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and active)
$$;
revoke all on function private.is_manager() from public;
revoke all on function private.is_member() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_manager(), private.is_member() to authenticated;
create table public.vehicles (
 id uuid primary key default gen_random_uuid(), brand text not null, model text not null, year integer not null check(year between 1900 and 2200),
 plate text not null, plate_normalized text generated always as (upper(regexp_replace(plate,'\s','','g'))) stored unique,
 kind text not null check(kind in ('car','motorcycle','trailer')), active boolean not null default true, unavailable boolean not null default false
);
create table public.attachments (
 id uuid primary key default gen_random_uuid(), owner uuid not null references public.profiles(id), name text not null,
 object_path text not null unique, mime text not null check(mime in ('image/jpeg','image/png','application/pdf')), size_bytes integer not null check(size_bytes between 1 and 5242880)
);
create table public.fuel_entries (
 id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references public.vehicles(id), owner uuid not null references public.profiles(id),
 date date not null, km integer not null check(km>=0), liters numeric(10,3) not null check(liters>0), amount numeric(12,2) not null check(amount>0), full_tank boolean not null,
 code text not null unique, request_key uuid not null, checked boolean not null default false, reliable boolean not null default false,
 receipt text not null default 'missing' check(receipt in ('missing','received','complete')), correction text not null default '', attachment_id uuid references public.attachments(id),
 unique(owner,request_key), check(not checked or reliable)
);
create sequence private.fuel_code_seq;
alter table public.fuel_entries alter column code set default ('B-' || lpad(nextval('private.fuel_code_seq')::text,6,'0'));
-- lpad's fixed width truncates at seven digits: reject exhaustion rather than reuse codes.
alter sequence private.fuel_code_seq maxvalue 999999 no cycle;
create table public.odometer_readings (
 id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references public.vehicles(id), date date not null, km integer not null check(km>=0),
 owner uuid not null references public.profiles(id), status text not null check(status in ('accepted','conflict')), source text not null unique
);
create index odometer_history on public.odometer_readings(vehicle_id,date);
create table public.service_plans (
 id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references public.vehicles(id), action text not null, responsible text not null,
 last_date date, last_km integer check(last_km>=0), next_date date, next_km integer check(next_km>=0),
 interval_km integer check(interval_km>0), interval_months integer check(interval_months>0), lead_km integer not null default 1000 check(lead_km>=0), lead_days integer not null default 30 check(lead_days>=0), booking date,
 check(interval_km is not null or interval_months is not null or next_date is not null or next_km is not null)
);
create table public.service_records (
 id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references public.vehicles(id), date date not null, km integer check(km>=0), total numeric(12,2) check(total>=0),
 workshop text not null, note text not null default '', attachment_id uuid references public.attachments(id)
);
create table public.service_items (
 id uuid primary key default gen_random_uuid(), service_id uuid not null references public.service_records(id), kind text not null check(kind in ('action','part')),
 name text not null, reason text not null, price numeric(12,2) check(price>=0)
);
create table public.plan_proposals (
 service_id uuid not null references public.service_records(id), plan_id uuid not null references public.service_plans(id), status text not null default 'pending' check(status in ('pending','confirmed')),
 confirmed_by uuid references public.profiles(id), confirmed_at timestamptz, primary key(service_id,plan_id)
);
create table public.issue_reports (
 id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references public.vehicles(id), owner uuid not null references public.profiles(id), date date not null,
 description text not null, severity text not null check(severity in ('minor','serious')), immobilize boolean not null default false,
 status text not null default 'new' check(status in ('new','in_progress','needs_info','resolved')), response text not null default '', supplement text not null default '',
 service_id uuid references public.service_records(id), attachment_id uuid references public.attachments(id), check(not immobilize or severity='serious')
);
create table public.audit_log (
 id uuid primary key default gen_random_uuid(), actor uuid references public.profiles(id), at timestamptz not null default now(), entity text not null, entity_id uuid not null,
 before_data jsonb, after_data jsonb
);
create index fuel_by_vehicle_date on public.fuel_entries(vehicle_id,date);
create index service_by_vehicle_date on public.service_records(vehicle_id,date);
-- All exposed tables have RLS. No authenticated mutation grants/policies.
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.attachments enable row level security;
alter table public.fuel_entries enable row level security;
alter table public.odometer_readings enable row level security;
alter table public.service_plans enable row level security;
alter table public.service_records enable row level security;
alter table public.service_items enable row level security;
alter table public.plan_proposals enable row level security;
alter table public.issue_reports enable row level security;
alter table public.audit_log enable row level security;
revoke all on public.profiles,public.vehicles,public.attachments,public.fuel_entries,public.odometer_readings,public.service_plans,public.service_records,public.service_items,public.plan_proposals,public.issue_reports,public.audit_log from anon,authenticated;
grant select on public.profiles,public.vehicles,public.attachments,public.fuel_entries,public.odometer_readings,public.service_plans,public.service_records,public.service_items,public.plan_proposals,public.issue_reports,public.audit_log to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(private.is_member() and (id=auth.uid() or private.is_manager()));
create policy vehicles_read on public.vehicles for select to authenticated using(private.is_member() and (active or private.is_manager()));
create policy readings_read on public.odometer_readings for select to authenticated using(private.is_member() and (private.is_manager() or owner=auth.uid() or (status='accepted' and exists(select 1 from public.vehicles v where v.id=vehicle_id and v.active))));
create policy plans_read on public.service_plans for select to authenticated using(private.is_member() and (private.is_manager() or exists(select 1 from public.vehicles v where v.id=vehicle_id and v.active)));
create policy fuel_read on public.fuel_entries for select to authenticated using(private.is_member() and (owner=auth.uid() or private.is_manager()));
create policy issues_read on public.issue_reports for select to authenticated using(private.is_member() and (owner=auth.uid() or private.is_manager()));
create policy service_read on public.service_records for select to authenticated using(private.is_manager());
create policy items_read on public.service_items for select to authenticated using(private.is_manager());
create policy proposals_read on public.plan_proposals for select to authenticated using(private.is_manager());
create policy audit_read on public.audit_log for select to authenticated using(private.is_manager());
create policy attachments_read on public.attachments for select to authenticated using(private.is_member() and (private.is_manager() or exists(select 1 from public.fuel_entries f where f.attachment_id=attachments.id and f.owner=auth.uid()) or exists(select 1 from public.issue_reports i where i.attachment_id=attachments.id and i.owner=auth.uid())));
-- Protected bucket; no public URLs, no client upsert/delete. Trusted API supplies metadata.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fleet-documents','fleet-documents',false,5242880,array['image/jpeg','image/png','application/pdf']) on conflict(id) do nothing;
create policy fleet_documents_read on storage.objects for select to authenticated using(bucket_id='fleet-documents' and private.is_member() and exists(select 1 from public.attachments a where a.object_path=storage.objects.name));
