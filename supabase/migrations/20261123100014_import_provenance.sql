-- Offline support for authorized historical imports. Native API validation still
-- requires a price; imported unknown prices are explicit NULL, never zero.
alter table public.fuel_entries alter column amount drop not null;
alter table public.fuel_entries add column source_system text;
alter table public.fuel_entries add column source_id text;
alter table public.fuel_entries add column source_metadata jsonb;
create unique index fuel_source_identity on public.fuel_entries(source_system,source_id) where source_system is not null and source_id is not null;
alter table public.vehicles add column source_system text;
alter table public.vehicles add column source_id text;
alter table public.vehicles add column source_metadata jsonb;
create unique index vehicle_source_identity on public.vehicles(source_system,source_id) where source_system is not null and source_id is not null;
-- Keep this migration write-closed for browser roles; existing RLS still applies.
