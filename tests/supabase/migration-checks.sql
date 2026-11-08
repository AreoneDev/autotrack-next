-- Metadata checks and migration preservation; all failures are fatal to CI.
do $$
declare t text; priv text; invalid boolean; actual bigint;
begin
  foreach t in array array['leads','tasks','notifications','vehicles',
    'lead_vehicle_interests','lead_trade_in_vehicles','imported_cars','sync_deleted','lead_save_requests'] loop
    if not (select relrowsecurity from pg_class where oid = format('public.%I',t)::regclass) then
      raise exception 'RLS disabled on %', t;
    end if;
    foreach priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('anon', format('public.%I',t), priv) then
        raise exception 'Anonymous % grant on %', priv, t;
      end if;
    end loop;
    foreach priv in array array['TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('authenticated', format('public.%I',t), priv) then
        raise exception 'Administrative % grant on %', priv, t;
      end if;
    end loop;
  end loop;
  foreach t in array array['autotrack_resolve_vehicle(jsonb)',
    'autotrack_save_lead_details(bigint,bigint,uuid,jsonb,jsonb,jsonb,bigint[])'] loop
    if (select prosecdef from pg_proc where oid = ('public.' || t)::regprocedure)
      or has_function_privilege('anon', 'public.' || t, 'EXECUTE')
      or not has_function_privilege('authenticated', 'public.' || t, 'EXECUTE') then
      raise exception 'Atomic save function privileges are invalid for %', t;
    end if;
  end loop;
  if has_table_privilege('authenticated','public.lead_save_requests','UPDATE')
    or has_table_privilege('authenticated','public.lead_save_requests','DELETE') then
    raise exception 'Save receipts must be immutable for authenticated clients';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and policyname='legacy_allow_all') then
    raise exception 'Legacy permissive policies survived';
  end if;
  foreach t in array array['leads','tasks','notifications'] loop
    execute format('select count(*) <> 1 or bool_or(owner_id <> %L::uuid) or bool_or(version <> 1) from public.%I',
      '00000000-0000-4000-8000-000000000001', t) into invalid;
    if invalid then raise exception 'Legacy data/backfill not preserved on %', t; end if;
  end loop;
  foreach t in array array['vehicles','lead_vehicle_interests','lead_trade_in_vehicles','imported_cars'] loop
    execute format('select count(*) from public.%I', t) into actual;
    if actual <> 1 then raise exception 'Legacy count not preserved on %', t; end if;
  end loop;
  if exists(select 1 from public.vehicles where owner_id is not null) then
    raise exception 'Shared catalogue was assigned an owner';
  end if;
  if has_schema_privilege('anon','autotrack_backup','USAGE')
    or has_schema_privilege('authenticated','autotrack_backup','USAGE') then
    raise exception 'Backup schema exposed';
  end if;
  foreach t in array array['leads','tasks','notifications','vehicles',
    'lead_vehicle_interests','lead_trade_in_vehicles','imported_cars'] loop
    execute format('select count(*) from autotrack_backup.%I', t || '_20261030') into actual;
    if actual <> 1 then raise exception 'Legacy backup missing on %', t; end if;
    if has_table_privilege('anon', format('autotrack_backup.%I', t || '_20261030'), 'SELECT')
      or has_table_privilege('authenticated', format('autotrack_backup.%I', t || '_20261030'), 'SELECT') then
      raise exception 'Backup table exposed on %', t;
    end if;
  end loop;
end $$;
select 'PASS: RLS, grants, legacy backfill, counts, catalogue and backups' as result;
