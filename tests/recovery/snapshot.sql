-- Ordered complete row content, not just counts; include non-public backup and auth schemas.
select format(
 'select %L, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), ''[]''::jsonb) from %I.%I t;',
 n.nspname || '.' || c.relname,n.nspname,c.relname)
from pg_class c join pg_namespace n on c.relnamespace=n.oid
where c.relkind='r' and n.nspname in ('public','auth','autotrack_backup')
order by n.nspname,c.relname
\gexec
select format('select %L,last_value,is_called from %I.%I;',
 n.nspname || '.' || c.relname,n.nspname,c.relname)
from pg_class c join pg_namespace n on c.relnamespace=n.oid
where c.relkind='S' and n.nspname in ('public','auth','autotrack_backup')
order by n.nspname,c.relname
\gexec
