-- REC-SEC: repeat on source and restored database. All behavioral writes roll back.
begin;
do $$
declare t text;
begin
 foreach t in array array['leads','tasks','notifications','vehicles',
 'lead_vehicle_interests','lead_trade_in_vehicles','imported_cars','sync_deleted'] loop
  if not (select relrowsecurity from pg_class where oid=format('public.%I',t)::regclass) then
   raise exception 'RLS disabled: %',t;
  end if;
  if has_table_privilege('anon',format('public.%I',t),'SELECT')
    or has_table_privilege('authenticated',format('public.%I',t),'TRUNCATE') then
   raise exception 'Unsafe grants: %',t;
  end if;
 end loop;
 if has_schema_privilege('authenticated','autotrack_backup','USAGE')
 or has_schema_privilege('anon','autotrack_backup','USAGE') then
  raise exception 'Backup schema exposed';
 end if;
 if exists(select 1 from pg_policies where policyname='legacy_allow_all') then
  raise exception 'Legacy policy survived';
 end if;
end $$;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
do $$
declare new_id bigint; child_id bigint; old_sync uuid; next_version bigint;
begin
 if (select count(*) from public.leads) <> 1 or (select count(*) from public.tasks) <> 1
    or exists(select 1 from public.notifications) or exists(select 1 from public.sync_deleted)
    or exists(select 1 from public.lead_vehicle_interests) then
  raise exception 'Other-owner data exposed or own data lost';
 end if;
 if (select count(*) from public.vehicles) <> 2 then raise exception 'Catalogue/own vehicle visibility incorrect'; end if;
 begin
  insert into public.tasks(lead_id,title) values (1,'Cross-owner attack');
  raise exception 'Cross-owner child insert accepted';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into public.leads(first_name,owner_id) values ('Forged owner','11111111-1111-4111-8111-111111111111');
  raise exception 'Forged owner accepted';
 exception when insufficient_privilege then null;
 end;
 update public.leads set notes='Attack' where owner_id='11111111-1111-4111-8111-111111111111';
 if found then raise exception 'Cross-owner update accepted'; end if;
 insert into public.leads(first_name) values ('Restored insert') returning lead_id,sync_id into new_id,old_sync;
 if new_id <= 1002 then raise exception 'Sequence did not recover'; end if;
 insert into public.tasks(lead_id,title) values (new_id,'Restored task') returning task_id into child_id;
 update public.leads set notes='Revision' where lead_id=new_id returning version into next_version;
 if next_version <> 2 then raise exception 'Revision trigger did not recover'; end if;
 begin
  update public.leads set owner_id='11111111-1111-4111-8111-111111111111' where lead_id=new_id;
  raise exception 'Owner mutation accepted';
 exception when raise_exception then
  if sqlerrm <> 'Record identity and owner are immutable.' then raise; end if;
 end;
 perform public.autotrack_delete_lead(new_id);
 if exists(select 1 from public.tasks where task_id=child_id)
 or not exists(select 1 from public.sync_deleted where sync_id=old_sync and version=3) then
  raise exception 'Delete RPC/trigger did not recover';
 end if;
 begin
  insert into public.sync_deleted(owner_id,entity,sync_id,version) values(auth.uid(),'leads',gen_random_uuid(),1);
  raise exception 'Tombstone forgery accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform 1 from public.leads;
  raise exception 'Anonymous data read accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
select 'PASS: RLS, grants, ownership, sequence, revision and deletion behavior';
