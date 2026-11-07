-- Disposable database only. Every fixture and injected trigger rolls back.
-- Execute after the historical migrations and migration-checks.sql.
begin;

create temporary table deletion_fixture(label text primary key, lead_id bigint);
grant select on deletion_fixture to authenticated;
insert into auth.users(id, email) values
 ('dddddddd-0000-4000-8000-000000000001', 'delete-a@example.invalid'),
 ('dddddddd-0000-4000-8000-000000000002', 'delete-b@example.invalid');
with inserted as (
 insert into public.leads(first_name, owner_id) values
 ('Delete target', 'dddddddd-0000-4000-8000-000000000001'),
 ('Keep sibling', 'dddddddd-0000-4000-8000-000000000001'),
 ('Keep foreign', 'dddddddd-0000-4000-8000-000000000002')
 returning first_name, lead_id
) insert into deletion_fixture select first_name, lead_id from inserted;
insert into public.tasks(lead_id, owner_id, title)
 select l.lead_id, l.owner_id, 'Delete integrity task' from public.leads l
 join deletion_fixture f using(lead_id) cross join generate_series(1,2);
insert into public.notifications(lead_id, owner_id, title)
 select l.lead_id, l.owner_id, 'Delete integrity notification' from public.leads l
 join deletion_fixture f using(lead_id);
insert into public.tasks(owner_id, title) values
 ('dddddddd-0000-4000-8000-000000000001', 'Keep standalone task');
insert into public.notifications(owner_id, title) values
 ('dddddddd-0000-4000-8000-000000000001', 'Keep standalone notification');
insert into public.lead_vehicle_interests(lead_id, vehicle_id)
 select lead_id, 1 from deletion_fixture;
insert into public.lead_trade_in_vehicles(lead_id, vehicle_id)
 select lead_id, 1 from deletion_fixture;

insert into public.vehicles(make, model, year, owner_id) values
 ('Synthetic', 'Keep private vehicle', 2026, 'dddddddd-0000-4000-8000-000000000001');

-- Compare exact rows, including sync history, to detect partial commits.
create function pg_temp.deletion_state() returns jsonb language plpgsql as $$
declare state jsonb; snapshots jsonb;
begin
 select jsonb_build_object(
 'leads', (select jsonb_agg(to_jsonb(t) order by lead_id) from public.leads t),
 'tasks', (select jsonb_agg(to_jsonb(t) order by task_id) from public.tasks t),
 'notifications', (select jsonb_agg(to_jsonb(t) order by notification_id) from public.notifications t),
 'interests', (select jsonb_agg(to_jsonb(t) order by lead_id, vehicle_id) from public.lead_vehicle_interests t),
 'trade_ins', (select jsonb_agg(to_jsonb(t) order by lead_id, vehicle_id) from public.lead_trade_in_vehicles t),
 'vehicles', (select jsonb_agg(to_jsonb(t) order by vehicle_id) from public.vehicles t),
 'history', (select jsonb_agg(to_jsonb(t) order by owner_id, entity, sync_id) from public.sync_deleted t)) into state;
 if to_regclass('public.lead_recovery_snapshots') is not null then
  execute 'select jsonb_agg(to_jsonb(t) order by recovery_id) from public.lead_recovery_snapshots t' into snapshots;
  state := state || jsonb_build_object('recovery', snapshots);
 end if;
 return state;
end $$;
create temporary table deletion_before as select pg_temp.deletion_state() as state;

-- Audit function execution privileges and invoker mode, without relaxing RLS.
do $$ begin
 if has_function_privilege('anon', 'public.autotrack_delete_lead(bigint)', 'EXECUTE')
 or not has_function_privilege('authenticated', 'public.autotrack_delete_lead(bigint)', 'EXECUTE')
 or (select prosecdef from pg_proc where oid = 'public.autotrack_delete_lead(bigint)'::regprocedure)
 or not coalesce((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.autotrack_delete_lead(bigint)'::regprocedure), false) then
  raise exception 'Unsafe delete RPC permissions or search_path';
 end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-4000-8000-000000000002"}', true);
do $$ begin
 begin
  perform public.autotrack_delete_lead((select lead_id from deletion_fixture where label='Delete target'));
  raise exception 'Foreign lead deletion unexpectedly succeeded';
 exception when sqlstate 'P0001' then
  if sqlerrm <> 'Lead not found.' then raise; end if;
 end;
 begin
  perform public.autotrack_delete_lead(-1);
  raise exception 'Missing lead deletion unexpectedly succeeded';
 exception when sqlstate 'P0001' then
  if sqlerrm <> 'Lead not found.' then raise; end if;
 end;
end $$;
select set_config('request.jwt.claims', '{}', true);
do $$ begin
 begin
  perform public.autotrack_delete_lead((select lead_id from deletion_fixture where label='Delete target'));
  raise exception 'Signed-out deletion unexpectedly succeeded';
 exception when sqlstate 'P0001' then
  if sqlerrm <> 'Sign in required.' then raise; end if;
 end;
end $$;
reset role;
do $$ begin
 if pg_temp.deletion_state() <> (select state from deletion_before) then
  raise exception 'Rejected delete changed data';
 end if;
end $$;

-- Fail after links and tasks were deleted. Everything, including their
-- tombstones, must be restored by PostgreSQL's statement transaction.
create function pg_temp.reject_notification_delete() returns trigger language plpgsql as $$
begin raise exception 'Synthetic delete rejection'; end $$;
create trigger test_reject_delete before delete on public.notifications
 for each row execute function pg_temp.reject_notification_delete();
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-0000-4000-8000-000000000001"}', true);
do $$ begin
 begin
  perform public.autotrack_delete_lead((select lead_id from deletion_fixture where label='Delete target'));
  raise exception 'Injected deletion failure did not fire';
 exception when sqlstate 'P0001' then
  if sqlerrm <> 'Synthetic delete rejection' then raise; end if;
 end;
end $$;
reset role;
do $$ begin
 if pg_temp.deletion_state() <> (select state from deletion_before) then
  raise exception 'Failed child delete left partial changes';
 end if;
end $$;
drop trigger test_reject_delete on public.notifications;

-- Simulate a corrupt legacy cross-account child. Invoker RLS must not erase
-- another owner's row; the FK (or recovery integrity guard) must reject atomically.
insert into public.tasks(lead_id, owner_id, title)
 select lead_id, 'dddddddd-0000-4000-8000-000000000002', 'Corrupt legacy child'
 from deletion_fixture where label='Delete target';
update deletion_before set state = pg_temp.deletion_state() where true;
set local role authenticated;
do $$ declare rejected boolean := false; begin
 begin
  perform public.autotrack_delete_lead((select lead_id from deletion_fixture where label='Delete target'));
 exception when foreign_key_violation or sqlstate 'P0001' then rejected := true;
 end;
 if not rejected then raise exception 'Corrupt cross-account relationship was deleted'; end if;
end $$;
reset role;
do $$ begin
 if pg_temp.deletion_state() <> (select state from deletion_before) then
  raise exception 'Corrupt relationship rejection left partial changes';
 end if;
end $$;
delete from public.tasks where title='Corrupt legacy child';

-- A legacy link to another owner's private vehicle is hidden by association
-- RLS. Deletion must fail closed rather than skip it and leave a partial graph.
create temporary table deletion_private_vehicle as
 with inserted as (
  insert into public.vehicles(make, model, year, owner_id) values
   ('Synthetic', 'Foreign private vehicle', 2026, 'dddddddd-0000-4000-8000-000000000002')
  returning vehicle_id
 ) select vehicle_id from inserted;
update public.lead_vehicle_interests set vehicle_id=(select vehicle_id from deletion_private_vehicle)
 where lead_id=(select lead_id from deletion_fixture where label='Delete target');
update deletion_before set state = pg_temp.deletion_state() where true;
set local role authenticated;
do $$ declare rejected boolean := false; begin
 begin
  perform public.autotrack_delete_lead((select lead_id from deletion_fixture where label='Delete target'));
 exception when foreign_key_violation or sqlstate 'P0001' then rejected := true;
 end;
 if not rejected then raise exception 'Foreign private vehicle link was deleted'; end if;
end $$;
reset role;
do $$ begin
 if pg_temp.deletion_state() <> (select state from deletion_before) then
  raise exception 'Hidden vehicle relationship rejection left partial changes';
 end if;
end $$;
update public.lead_vehicle_interests set vehicle_id=1
 where lead_id=(select lead_id from deletion_fixture where label='Delete target');
update deletion_before set state = pg_temp.deletion_state() where true;

set local role authenticated;
select public.autotrack_delete_lead(lead_id) from deletion_fixture where label='Delete target';
do $$ begin
 begin
  perform public.autotrack_delete_lead((select lead_id from deletion_fixture where label='Delete target'));
  raise exception 'Repeated deletion unexpectedly succeeded';
 exception when sqlstate 'P0001' then
  if sqlerrm <> 'Lead not found.' then raise; end if;
 end;
end $$;
reset role;
do $$ declare target bigint; t text; before_state jsonb; before_rows jsonb; after_rows jsonb; remaining boolean;
begin
 select lead_id into target from deletion_fixture where label='Delete target';
 foreach t in array array['leads','tasks','notifications','lead_vehicle_interests','lead_trade_in_vehicles'] loop
  execute format('select exists(select 1 from public.%I where lead_id=$1)', t) into remaining using target;
  if remaining then raise exception 'Dependent rows remain in %', t; end if;
 end loop;
 select state into before_state from deletion_before;
 -- Only the target and its children may disappear. Standalone/sibling/foreign
 -- rows and all shared/private vehicles must remain byte-for-byte identical.
 foreach t in array array['leads','tasks','notifications','interests','trade_ins','vehicles'] loop
  select coalesce(jsonb_agg(value), '[]'::jsonb) into before_rows
   from jsonb_array_elements(before_state->t) where (value->>'lead_id')::bigint is distinct from target;
  select coalesce(jsonb_agg(value), '[]'::jsonb) into after_rows
   from jsonb_array_elements(pg_temp.deletion_state()->t) where (value->>'lead_id')::bigint is distinct from target;
  if before_rows <> after_rows then raise exception 'Unrelated rows changed in %',t; end if;
 end loop;
 if (select count(*) from public.sync_deleted s where s.owner_id='dddddddd-0000-4000-8000-000000000001'
   and exists(select 1 from (
    select value->>'sync_id' as id from jsonb_array_elements(before_state->'leads') where (value->>'lead_id')::bigint=target
    union all select value->>'sync_id' from jsonb_array_elements(before_state->'tasks') where (value->>'lead_id')::bigint=target
    union all select value->>'sync_id' from jsonb_array_elements(before_state->'notifications') where (value->>'lead_id')::bigint=target
   ) ids where ids.id=s.sync_id::text)) <> 4 then
  raise exception 'Deletion history missing';
 end if;
end $$;
select 'PASS: delete permissions, account isolation, exact rollback, dependencies, unrelated rows and history' as result;
rollback;
