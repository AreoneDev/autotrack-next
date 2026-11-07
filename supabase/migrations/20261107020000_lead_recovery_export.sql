-- Additive customer recovery and consistent owner-scoped export.
-- Apply after the ownership/security migrations. No existing rows are rewritten.
begin;
create table public.lead_recovery_snapshots (
  recovery_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  lead_id bigint not null,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz,
  format_version integer not null default 1 check(format_version = 1),
  snapshot jsonb not null
);
create unique index lead_recovery_pending_idx on public.lead_recovery_snapshots(owner_id,lead_id) where restored_at is null;
alter table public.lead_recovery_snapshots enable row level security;
revoke all on public.lead_recovery_snapshots from public, anon, authenticated;
grant select on public.lead_recovery_snapshots to authenticated;
create policy read_own_recovery on public.lead_recovery_snapshots for select to authenticated
  using(owner_id = (select auth.uid()) and (restored_at is not null or not exists(
    select 1 from public.leads l where l.lead_id = lead_recovery_snapshots.lead_id)));

-- A narrow definer helper accepts only an owned ID, never supplied snapshot JSON.
-- Parent locking also blocks new FK children until the delete transaction ends.
create function public.autotrack_capture_lead(p_lead_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare account uuid := auth.uid(); lead_row public.leads; payload jsonb;
begin
  if account is null then raise exception 'Sign in required.'; end if;
  select * into lead_row from public.leads where lead_id = p_lead_id and owner_id = account for update;
  if not found then raise exception 'Lead not found.'; end if;
  perform 1 from public.tasks where lead_id = p_lead_id for update;
  perform 1 from public.notifications where lead_id = p_lead_id for update;
  perform 1 from public.lead_vehicle_interests where lead_id = p_lead_id for update;
  perform 1 from public.lead_trade_in_vehicles where lead_id = p_lead_id for update;
  if exists(select 1 from public.tasks where lead_id = p_lead_id and owner_id <> account)
    or exists(select 1 from public.notifications where lead_id = p_lead_id and owner_id <> account)
    or exists(select 1 from (
      select vehicle_id from public.lead_vehicle_interests where lead_id = p_lead_id
      union select vehicle_id from public.lead_trade_in_vehicles where lead_id = p_lead_id
    ) a left join public.vehicles v using(vehicle_id)
      where v.vehicle_id is null or (v.owner_id is not null and v.owner_id <> account)) then
    raise exception 'Inconsistent customer relationships. Nothing deleted.';
  end if;
  select jsonb_build_object(
    'lead', to_jsonb(lead_row),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by task_id) from public.tasks t where lead_id = p_lead_id), '[]'),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n) order by notification_id) from public.notifications n where lead_id = p_lead_id), '[]'),
    'interests', coalesce((select jsonb_agg(to_jsonb(i)) from public.lead_vehicle_interests i where lead_id = p_lead_id), '[]'),
    'trade_ins', coalesce((select jsonb_agg(to_jsonb(i)) from public.lead_trade_in_vehicles i where lead_id = p_lead_id), '[]')
  ) into payload;
  insert into public.lead_recovery_snapshots(owner_id,lead_id,snapshot) values(account,p_lead_id,payload)
    on conflict(owner_id,lead_id) where restored_at is null do update set snapshot=excluded.snapshot,deleted_at=now();
end $$;
revoke all on function public.autotrack_capture_lead(bigint) from public, anon;
grant execute on function public.autotrack_capture_lead(bigint) to authenticated;

-- Same public deletion signature, invoker RLS, history and retained vehicles.
create or replace function public.autotrack_delete_lead(p_lead_id bigint)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  perform 1 from public.leads where lead_id=p_lead_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Lead not found.'; end if;
  perform public.autotrack_capture_lead(p_lead_id);
  delete from public.lead_vehicle_interests where lead_id=p_lead_id;
  delete from public.lead_trade_in_vehicles where lead_id=p_lead_id;
  delete from public.tasks where lead_id=p_lead_id;
  delete from public.notifications where lead_id=p_lead_id;
  delete from public.leads where lead_id=p_lead_id;
end $$;
revoke all on function public.autotrack_delete_lead(bigint) from public, anon;
grant execute on function public.autotrack_delete_lead(bigint) to authenticated;

create function public.autotrack_restore_lead(p_recovery_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare account uuid := auth.uid(); archive public.lead_recovery_snapshots;
  restored_lead public.leads; child jsonb; entity_name text; restored_row jsonb;
begin
  if account is null then raise exception 'Sign in required.'; end if;
  select * into archive from public.lead_recovery_snapshots
    where recovery_id=p_recovery_id and owner_id=account for update;
  if not found then raise exception 'Recovery snapshot not found.'; end if;
  -- Retry after a lost response is safe, including concurrent attempts.
  if archive.restored_at is not null then
    if exists(select 1 from public.leads where lead_id=archive.lead_id and owner_id=account
      and sync_id=(archive.snapshot->'lead'->>'sync_id')::uuid) then return archive.lead_id::text; end if;
    raise exception 'Snapshot already restored. Reload to select the latest deletion.';
  end if;
  if archive.format_version <> 1 then raise exception 'Unsupported recovery format.'; end if;
  if exists(select 1 from public.leads where lead_id=archive.lead_id) then
    raise exception 'Customer ID is already in use. Nothing restored.';
  end if;
  if exists(select 1 from (
    select x->>'vehicle_id' as vehicle_id from jsonb_array_elements(archive.snapshot->'interests') x
    union select x->>'vehicle_id' from jsonb_array_elements(archive.snapshot->'trade_ins') x
  ) a left join public.vehicles v on v.vehicle_id=a.vehicle_id::bigint
    where v.vehicle_id is null or (v.owner_id is not null and v.owner_id <> account)) then
    raise exception 'A linked vehicle is missing or unavailable. Nothing restored.';
  end if;
  restored_lead := jsonb_populate_record(null::public.leads,archive.snapshot->'lead');
  if restored_lead.owner_id is distinct from account or restored_lead.lead_id <> archive.lead_id then
    raise exception 'Invalid recovery ownership.';
  end if;
  restored_lead.version := greatest(restored_lead.version,coalesce((select version from public.sync_deleted
    where owner_id=account and entity='leads' and sync_id=restored_lead.sync_id),0))+1;
  restored_lead.updated_at := clock_timestamp();
  insert into public.leads select (restored_lead).*;
  foreach entity_name in array array['tasks','notifications'] loop
    for child in select value from jsonb_array_elements(archive.snapshot->entity_name) loop
      if (child->>'owner_id')::uuid is distinct from account or (child->>'lead_id')::bigint <> archive.lead_id then
        raise exception 'Invalid recovery ownership.';
      end if;
      restored_row := child || jsonb_build_object('updated_at',clock_timestamp(),'version',greatest(
        (child->>'version')::bigint,coalesce((select version from public.sync_deleted
          where owner_id=account and entity=entity_name and sync_id=(child->>'sync_id')::uuid),0))+1);
      -- Only fixed table names; JSON is passed as a bound parameter, never SQL text.
      execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',entity_name,entity_name)
        using restored_row;
    end loop;
  end loop;
  insert into public.lead_vehicle_interests select * from jsonb_populate_recordset(null::public.lead_vehicle_interests,archive.snapshot->'interests');
  insert into public.lead_trade_in_vehicles select * from jsonb_populate_recordset(null::public.lead_trade_in_vehicles,archive.snapshot->'trade_ins');
  update public.lead_recovery_snapshots set restored_at=clock_timestamp() where recovery_id=archive.recovery_id;
  return archive.lead_id::text;
end $$;
revoke all on function public.autotrack_restore_lead(uuid) from public, anon;
grant execute on function public.autotrack_restore_lead(uuid) to authenticated;

-- Convert JSON numbers to exact text before JS parsing (including nested IDs).
create function public.autotrack_export_safe_json(p_value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
begin
  case jsonb_typeof(p_value)
    when 'number' then return to_jsonb(p_value #>> '{}');
    when 'object' then return coalesce((select jsonb_object_agg(key,public.autotrack_export_safe_json(value)) from jsonb_each(p_value)), '{}'::jsonb);
    when 'array' then return coalesce((select jsonb_agg(public.autotrack_export_safe_json(value) order by ord)
      from jsonb_array_elements(p_value) with ordinality a(value,ord)), '[]'::jsonb);
    else return p_value;
  end case;
end $$;
revoke all on function public.autotrack_export_safe_json(jsonb) from public, anon;
grant execute on function public.autotrack_export_safe_json(jsonb) to authenticated;

-- One SQL statement: consistent MVCC snapshot, invoker RLS, no REST row cap.
create function public.autotrack_export_data()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select public.autotrack_export_safe_json(jsonb_build_object(
    'format_version',1,'exported_at',now(),
    'leads',coalesce((select jsonb_agg(to_jsonb(l) order by lead_id) from public.leads l where owner_id=auth.uid()),'[]'),
    'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by task_id) from public.tasks t where owner_id=auth.uid()),'[]'),
    'notifications',coalesce((select jsonb_agg(to_jsonb(n) order by notification_id) from public.notifications n where owner_id=auth.uid()),'[]'),
    'lead_vehicle_interests',coalesce((select jsonb_agg(to_jsonb(i) order by lead_id,vehicle_id) from public.lead_vehicle_interests i
      join public.leads l using(lead_id) where l.owner_id=auth.uid()),'[]'),
    'lead_trade_in_vehicles',coalesce((select jsonb_agg(to_jsonb(i) order by lead_id,vehicle_id) from public.lead_trade_in_vehicles i
      join public.leads l using(lead_id) where l.owner_id=auth.uid()),'[]'),
    'vehicles',coalesce((select jsonb_agg(to_jsonb(v) order by vehicle_id) from public.vehicles v where owner_id=auth.uid()
      or vehicle_id in(select vehicle_id from public.lead_vehicle_interests union select vehicle_id from public.lead_trade_in_vehicles)),'[]'),
    'recovery_snapshots',coalesce((select jsonb_agg(to_jsonb(r) order by deleted_at,recovery_id) from public.lead_recovery_snapshots r where owner_id=auth.uid()),'[]'),
    'sync_deleted',coalesce((select jsonb_agg(to_jsonb(d) order by entity,sync_id) from public.sync_deleted d where owner_id=auth.uid()),'[]')
  )) || jsonb_build_object('format_version',1) where auth.uid() is not null
$$;
revoke all on function public.autotrack_export_data() from public, anon;
grant execute on function public.autotrack_export_data() to authenticated;
notify pgrst,'reload schema';
commit;
