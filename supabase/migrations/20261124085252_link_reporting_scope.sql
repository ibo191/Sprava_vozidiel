-- Anonymous report ingestion happens only through a trusted server endpoint.
-- No anonymous browser access to tables or private photos is granted.
alter table public.issue_reports alter column owner drop not null;
alter table public.attachments alter column owner drop not null;
alter table public.issue_reports add column reporter_name text;
alter table public.issue_reports add column reporter_channel text not null default 'account' check(reporter_channel in ('account','link'));
create table private.report_submissions(request_key uuid primary key,issue_id uuid not null unique references public.issue_reports(id),fingerprint text not null,receipt text not null unique);
alter table private.report_submissions enable row level security;
revoke all on private.report_submissions from public,anon,authenticated;
create or replace function private.is_member() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and active and role in ('manager','admin'))
$$;
revoke all on function private.is_member() from public;
grant execute on function private.is_member() to authenticated;
