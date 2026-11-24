alter table public.issue_reports add column kind text not null default 'fault' check(kind in ('fault','accident'));
alter table public.vehicles add column retired_on date;
alter table public.vehicles add column retirement_reason text;
alter table public.vehicles add column retired_by uuid references public.profiles(id);
-- RLS and browser write restrictions remain unchanged. The future trusted API
-- must expose only a sanitized operational-alert projection to instructors.
