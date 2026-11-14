-- Read-only deployment evidence. Does not select customer rows or invoke RPCs.
-- Run as a database administrator in the same project used by the application.
begin transaction read only;

select
  to_regclass('public.lead_recovery_snapshots') is not null as recovery_table_exists,
  to_regprocedure('public.autotrack_capture_lead(bigint)') is not null as capture_function_exists,
  to_regprocedure('public.autotrack_restore_lead(uuid)') is not null as restore_function_exists,
  to_regprocedure('public.autotrack_export_data()') is not null as export_function_exists;

select
  coalesce((select relrowsecurity from pg_class
    where oid = to_regclass('public.lead_recovery_snapshots')), false) as recovery_rls_enabled,
  exists(select 1 from pg_policies where schemaname = 'public'
    and tablename = 'lead_recovery_snapshots' and policyname = 'read_own_recovery'
    and cmd = 'SELECT' and 'authenticated' = any(roles)) as recovery_read_policy_exists,
  has_table_privilege('authenticated', to_regclass('public.lead_recovery_snapshots'), 'SELECT') as authenticated_can_select,
  has_table_privilege('authenticated', to_regclass('public.lead_recovery_snapshots'), 'INSERT, UPDATE, DELETE') as authenticated_can_write,
  has_table_privilege('anon', to_regclass('public.lead_recovery_snapshots'), 'SELECT') as anon_can_select;

rollback;
