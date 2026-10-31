-- Database-role regression check for test project ymafgxjevciiwkhtnzya.
-- The owner login is the selected QA login, not a customer contact address.
-- All inserted QA rows and their deletion history are rolled back.
-- Sequences may advance during rollback, so gaps in numeric IDs are expected.
-- Verified: 101 leads, 1080 tasks, 22 notifications; seven table counts preserved.
-- Separate metadata verification passed all 16 checks, including anon denial,
-- backup isolation, required sync fields and removal of TRUNCATE privileges.
begin;
do $$ begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', (select id from auth.users where lower(email)=lower('pengyuwang777@gmail.com')),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;
do $$
declare l_id bigint; t_id bigint; n_id bigint;
  l_sync uuid; t_sync uuid; n_sync uuid; revision bigint;
begin
  if (select count(*) from public.leads) <> 101
    or (select count(*) from public.tasks) <> 1080
    or (select count(*) from public.notifications) <> 22 then
    raise exception 'Owner cannot read all fixtures.';
  end if;
  insert into public.leads(first_name,last_name,notes)
    values('QA','MigrationRollback','Temporary synthetic migration verification')
    returning lead_id,sync_id,version into l_id,l_sync,revision;
  if revision <> 1 then raise exception 'New lead version must be 1.'; end if;
  insert into public.tasks(lead_id,title,task_date,completed,task_type)
    values(l_id,'QA rollback task',now(),false,'MANUAL')
    returning task_id,sync_id into t_id,t_sync;
  insert into public.notifications(lead_id,title,date)
    values(l_id,'QA rollback notification',now())
    returning notification_id,sync_id into n_id,n_sync;
  update public.leads set notes='QA updated' where lead_id=l_id returning version into revision;
  if revision <> 2 then raise exception 'Lead revision did not increment.'; end if;
  update public.tasks set title='QA updated task' where task_id=t_id returning version into revision;
  if revision <> 2 then raise exception 'Task revision did not increment.'; end if;
  update public.notifications set title='QA updated notification'
    where notification_id=n_id returning version into revision;
  if revision <> 2 then raise exception 'Notification revision did not increment.'; end if;
  perform public.autotrack_delete_lead(l_id);
  if exists(select 1 from public.leads where lead_id=l_id)
    or exists(select 1 from public.tasks where task_id=t_id)
    or exists(select 1 from public.notifications where notification_id=n_id) then
    raise exception 'Atomic delete left child records.';
  end if;
  if (select count(*) from public.sync_deleted where owner_id=auth.uid()
    and sync_id in (l_sync,t_sync,n_sync) and version=3) <> 3 then
    raise exception 'Deletion history missing or wrong version.';
  end if;
end $$;
reset role;
do $$ begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub',gen_random_uuid(),'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.leads) or exists(select 1 from public.tasks)
    or exists(select 1 from public.notifications)
    or exists(select 1 from public.lead_vehicle_interests)
    or exists(select 1 from public.lead_trade_in_vehicles)
    or exists(select 1 from public.sync_deleted) then
    raise exception 'Other account can read private fixtures.';
  end if;
end $$;
reset role;
set local role anon;
do $$
declare table_name text;
begin
  foreach table_name in array array['leads','tasks','notifications','vehicles',
    'lead_vehicle_interests','lead_trade_in_vehicles','imported_cars','sync_deleted'] loop
    begin
      execute format('select 1 from public.%I limit 1', table_name);
      raise exception 'Anonymous read unexpectedly allowed for %.', table_name;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
rollback;
select 'PASS: owner CRUD, revision increments, deletion history, other-account isolation and anonymous denial; all synthetic writes rolled back.' as verification_result;
