-- Read-only deployment review. No customer values or credentials are returned.
-- Run with administrator visibility on an approved staging clone of the target.
begin read only;
select p.oid::regprocedure as function, p.prosecdef as security_definer,
 p.proconfig as settings,
 has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
 has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p where p.oid = to_regprocedure('public.autotrack_delete_lead(bigint)');

select table_name, column_name, data_type, is_nullable, is_identity, identity_generation
from information_schema.columns
where table_schema='public' and table_name in
 ('leads','tasks','notifications','lead_vehicle_interests','lead_trade_in_vehicles','vehicles','sync_deleted','lead_recovery_snapshots')
order by table_name, ordinal_position;

-- Unexpected incoming FKs may block deletion or require additional handling.
select conrelid::regclass as child_table, confrelid::regclass as parent_table,
 conname, pg_get_constraintdef(oid) as definition
from pg_constraint where contype='f' and confrelid in
 (to_regclass('public.leads'),to_regclass('public.tasks'),to_regclass('public.notifications'),
  to_regclass('public.lead_vehicle_interests'),to_regclass('public.lead_trade_in_vehicles'))
order by confrelid::regclass::text, conrelid::regclass::text, conname;

select c.oid::regclass as table_name, c.relrowsecurity as rls,
 t.tgname, pg_get_triggerdef(t.oid) as trigger_definition
from pg_class c left join pg_trigger t on t.tgrelid=c.oid and not t.tgisinternal
where c.oid in (to_regclass('public.leads'),to_regclass('public.tasks'),to_regclass('public.notifications'))
order by c.relname, t.tgname;
rollback;
