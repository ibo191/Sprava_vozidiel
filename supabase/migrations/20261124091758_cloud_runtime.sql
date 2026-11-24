-- Pilot persistence: a versioned aggregate preserves imported IDs and domain rules.
-- All access is through the authenticated Edge API; never expose the document to clients.
create schema if not exists private;
create table private.fleet_runtime (
  id boolean primary key default true check(id),
  version bigint not null default 0,
  body jsonb not null,
  config jsonb not null,
  updated_at timestamptz not null default now()
);
create table private.fleet_requests (
  request_key uuid primary key,
  fingerprint text not null,
  receipt text not null unique,
  created_at timestamptz not null default now()
);
create table private.fleet_limits (
  key text primary key,
  count integer not null,
  expires_at timestamptz not null
);
alter table private.fleet_runtime enable row level security;
alter table private.fleet_requests enable row level security;
alter table private.fleet_limits enable row level security;
revoke all on private.fleet_runtime,private.fleet_requests,private.fleet_limits from public,anon,authenticated;
grant usage on schema private to service_role;
grant all on private.fleet_runtime,private.fleet_requests,private.fleet_limits to service_role;

create function public.fleet_snapshot() returns jsonb language sql security invoker
set search_path='' as $$
  select jsonb_build_object('version',version,'body',body,'config',config)
  from private.fleet_runtime where id=true;
$$;

create function public.fleet_receipt(p_key uuid) returns jsonb language sql security invoker
set search_path='' as $$
  select jsonb_build_object('fingerprint',fingerprint,'receipt',receipt)
  from private.fleet_requests where request_key=p_key;
$$;

create function public.fleet_limit(p_key text,p_max integer,p_seconds integer) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
  insert into private.fleet_limits(key,count,expires_at) values(p_key,1,now()+make_interval(secs=>p_seconds))
  on conflict(key) do update set
    count=case when fleet_limits.expires_at<=now() then 1 else fleet_limits.count+1 end,
    expires_at=case when fleet_limits.expires_at<=now() then now()+make_interval(secs=>p_seconds) else fleet_limits.expires_at end
  returning count into n;
  delete from private.fleet_limits where expires_at < now()-interval '1 day';
  return n<=p_max;
end; $$;

create function public.fleet_commit(p_version bigint,p_body jsonb,p_request_key uuid default null,
 p_fingerprint text default null,p_receipt text default null,p_limit_key text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_version bigint; previous private.fleet_requests%rowtype;
begin
  select version into current_version from private.fleet_runtime where id=true for update;
  if p_request_key is not null then
    select * into previous from private.fleet_requests where request_key=p_request_key;
    if found then
      if previous.fingerprint<>p_fingerprint then raise exception 'request_conflict' using errcode='23505'; end if;
      return jsonb_build_object('duplicate',true,'receipt',previous.receipt);
    end if;
  end if;
  if current_version is distinct from p_version then raise exception 'version_conflict' using errcode='40001'; end if;
  if p_limit_key is not null and not public.fleet_limit(p_limit_key,20,3600) then
    raise exception 'rate_limit' using errcode='P0001';
  end if;
  update private.fleet_runtime set body=p_body,version=version+1,updated_at=now() where id=true;
  if p_request_key is not null then
    insert into private.fleet_requests(request_key,fingerprint,receipt) values(p_request_key,p_fingerprint,p_receipt);
  end if;
  return jsonb_build_object('version',current_version+1,'receipt',p_receipt);
end; $$;

revoke all on function public.fleet_snapshot(),public.fleet_receipt(uuid),public.fleet_limit(text,integer,integer),public.fleet_commit(bigint,jsonb,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.fleet_snapshot(),public.fleet_receipt(uuid),public.fleet_limit(text,integer,integer),public.fleet_commit(bigint,jsonb,uuid,text,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fleet-private','fleet-private',false,5242880,array['image/jpeg','image/png','application/pdf'])
on conflict(id) do nothing;
-- No client policies for this bucket. Edge API verifies a current active manager.

create function public.fleet_finish_bootstrap(p_hash text) returns void language plpgsql security invoker set search_path='' as $$
begin
  update private.fleet_runtime set config=config-'bootstrapHash'
  where id=true and config->>'bootstrapHash'=p_hash;
  if not found then raise exception 'bootstrap_closed'; end if;
end; $$;
create function public.fleet_rotate_link(p_version bigint,p_token text,p_actor text) returns void language plpgsql security invoker set search_path='' as $$
begin
  update private.fleet_runtime set config=jsonb_set(config,'{reportToken}',to_jsonb(p_token)),
  body=jsonb_set(body,'{audit}',(body->'audit')||jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid()::text,'actor',p_actor,'at',now(),'entity','report-link','entityId','shared',
    'before','"Předchozí odkaz zneplatněn"'::jsonb,'after','"Nový odkaz vytvořen"'::jsonb))),
  version=version+1,updated_at=now() where id=true and version=p_version;
  if not found then raise exception 'version_conflict' using errcode='40001'; end if;
end; $$;
revoke all on function public.fleet_finish_bootstrap(text),public.fleet_rotate_link(bigint,text,text) from public,anon,authenticated;
grant execute on function public.fleet_finish_bootstrap(text),public.fleet_rotate_link(bigint,text,text) to service_role;
