-- Offline preparation only; browser mutation grants remain closed.
alter table public.service_records add column source_system text;
alter table public.service_records add column source_id text;
alter table public.service_records add column source_metadata jsonb;
create unique index service_source_identity on public.service_records(source_system,source_id)
 where source_system is not null and source_id is not null;
