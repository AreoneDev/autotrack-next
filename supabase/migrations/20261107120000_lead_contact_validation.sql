-- New writes only: retain legacy values and duplicates without rewriting rows.
begin;
create or replace function public.autotrack_email_key(value text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select lower(regexp_replace(coalesce(value, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'))
$$;
create or replace function public.autotrack_phone_key(value text)
returns text language plpgsql immutable parallel safe set search_path = '' as $$
declare compact text;
begin
  compact := regexp_replace(coalesce(value, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if compact = '' then return ''; end if;
  if compact !~ '^[+0-9[:space:]().-]+$' then return null; end if;
  compact := regexp_replace(compact, '[[:space:]().-]', '', 'g');
  if left(compact, 2) = '00' then compact := '+' || substr(compact, 3); end if;
  if compact ~ '^[0-9]{10}$' then compact := '+1' || compact;
  elsif compact ~ '^1[0-9]{10}$' then compact := '+' || compact; end if;
  if compact !~ '^\+[1-9][0-9]{7,14}$'
    or (left(compact, 2) = '+1' and length(compact) <> 12) then return null; end if;
  return compact;
end $$;

create or replace function public.autotrack_validate_lead()
returns trigger language plpgsql volatile security invoker set search_path = '' as $$
declare email_changed boolean; phone_changed boolean; budget_changed boolean;
  check_email boolean; check_phone boolean; matches jsonb; confirmation jsonb;
begin
  email_changed := TG_OP = 'INSERT';
  phone_changed := TG_OP = 'INSERT';
  budget_changed := TG_OP = 'INSERT';
  if TG_OP = 'UPDATE' then
    email_changed := new.lead_email is distinct from old.lead_email;
    phone_changed := new.phone is distinct from old.phone;
    budget_changed := new.budget is distinct from old.budget;
  end if;
  if email_changed then
    new.lead_email := public.autotrack_email_key(new.lead_email);
    if new.lead_email <> '' and (length(new.lead_email) > 254
      or new.lead_email !~ '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$') then
      raise exception using errcode = '22023', message = 'Enter a valid email address, or leave it blank.';
    end if;
  end if;
  if phone_changed then
    new.phone := public.autotrack_phone_key(new.phone);
    if new.phone is null then
      raise exception using errcode = '22023', message = 'Enter a 10-digit Canadian/US phone number or an international number starting with + (8–15 digits). Extensions are not supported.';
    end if;
  end if;
  if budget_changed then
    new.budget := coalesce(new.budget, 0);
    if new.budget::text in ('NaN', 'Infinity', '-Infinity') or new.budget < 0
      or new.budget > 9007199254740991 or round(new.budget::numeric, 2) <> new.budget::numeric then
      raise exception using errcode = '22023', message = 'Enter a non-negative budget with at most two decimal places, or leave it blank for 0.';
    end if;
  end if;
  check_email := email_changed and coalesce(new.lead_email, '') <> '';
  check_phone := phone_changed and coalesce(new.phone, '') <> '';
  if TG_OP = 'UPDATE' then
    check_email := check_email and new.lead_email is distinct from public.autotrack_email_key(old.lead_email);
    check_phone := check_phone and new.phone is distinct from public.autotrack_phone_key(old.phone);
  end if;
  if check_email or check_phone then
    -- The transaction lock also covers direct REST writes. VOLATILE obtains a
    -- fresh READ COMMITTED snapshot for the query after a concurrent save exits.
    if current_setting('transaction_isolation') <> 'read committed' then
      raise exception using errcode = '40001', message = 'Contact changes require a READ COMMITTED transaction. Please retry.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('autotrack.leads:' || new.owner_id::text, 0));
    select coalesce(jsonb_agg(jsonb_build_object(
      'leadID', l.lead_id, 'name', btrim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')),
      'email', check_email and public.autotrack_email_key(l.lead_email) = new.lead_email,
      'phone', coalesce(check_phone and public.autotrack_phone_key(l.phone) = new.phone, false)
    ) order by l.lead_id), '[]'::jsonb)
    into matches from public.leads l
    where l.owner_id = new.owner_id and l.lead_id <> new.lead_id
      and ((check_email and public.autotrack_email_key(l.lead_email) = new.lead_email)
        or (check_phone and public.autotrack_phone_key(l.phone) = new.phone));
    confirmation := coalesce(nullif(current_setting('autotrack.duplicate_confirmation', true), ''), '{}')::jsonb;
    if jsonb_array_length(matches) > 0 and (
      confirmation->>'operation' is distinct from TG_OP
      or (TG_OP = 'UPDATE' and confirmation->>'leadID' is distinct from new.lead_id::text)
      or confirmation->>'email' is distinct from public.autotrack_email_key(new.lead_email)
      or confirmation->>'phone' is distinct from coalesce(public.autotrack_phone_key(new.phone), '')
      or exists(select 1 from jsonb_array_elements(matches) m
        where not coalesce(confirmation->'ids', '[]'::jsonb) @> jsonb_build_array(m->'leadID'))
    ) then
      raise exception using errcode = 'P0001', message = 'AUTOTRACK_DUPLICATE_LEAD', detail = matches::text;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists autotrack_lead_validation on public.leads;
create trigger autotrack_lead_validation before insert or update on public.leads
for each row execute function public.autotrack_validate_lead();

-- Non-unique indexes include canonical keys from old rows; no backfill, merge,
-- unique constraint, or validation scan is imposed on existing records.
create index if not exists leads_owner_email_key_idx
  on public.leads(owner_id, public.autotrack_email_key(lead_email));
create index if not exists leads_owner_phone_key_idx
  on public.leads(owner_id, public.autotrack_phone_key(phone));

-- Full lead save, preserving the existing generated identity/sync defaults.
-- SECURITY INVOKER retains RLS. Owner, sync identity and revision are never taken
-- from the supplied JSON. Confirmations apply only to this call and these keys.
create or replace function public.save_lead_validated(p_lead jsonb, p_duplicate_ids bigint[] default '{}')
returns public.leads language plpgsql volatile security invoker set search_path = '' as $$
declare draft public.leads; saved public.leads; previous_confirmation text;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Authentication required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('autotrack.leads:' || auth.uid()::text, 0));
  draft := jsonb_populate_record(null::public.leads, p_lead);
  if draft.lead_id is not null and not exists(select 1 from public.leads where lead_id = draft.lead_id and owner_id = auth.uid()) then
    raise exception using errcode = 'P0002', message = 'Lead not found.';
  end if;
  previous_confirmation := current_setting('autotrack.duplicate_confirmation', true);
  perform set_config('autotrack.duplicate_confirmation', jsonb_build_object(
    'operation', case when draft.lead_id is null then 'INSERT' else 'UPDATE' end,
    'leadID', draft.lead_id, 'email', public.autotrack_email_key(draft.lead_email),
    'phone', coalesce(public.autotrack_phone_key(draft.phone), ''),
    'ids', to_jsonb(coalesce(p_duplicate_ids, '{}'::bigint[])))::text, true);
  if p_lead->>'lead_id' is null then
    insert into public.leads(first_name, last_name, phone, lead_email,
      lead_division, lead_address, lead_city, lead_province, lead_country, lead_postal_code,
      budget, stage, follow_up_date, score, notes, created_at, last_interaction_date, last_interaction_by, status)
    values(draft.first_name, draft.last_name, draft.phone, draft.lead_email,
      draft.lead_division, draft.lead_address, draft.lead_city, draft.lead_province, draft.lead_country, draft.lead_postal_code,
      draft.budget, draft.stage, draft.follow_up_date, draft.score, draft.notes, coalesce(draft.created_at, now()),
      draft.last_interaction_date, draft.last_interaction_by, coalesce(draft.status, true)) returning * into saved;
  else
    update public.leads set first_name = draft.first_name, last_name = draft.last_name,
      phone = draft.phone, lead_email = draft.lead_email, lead_division = draft.lead_division,
      lead_address = draft.lead_address, lead_city = draft.lead_city, lead_province = draft.lead_province,
      lead_country = draft.lead_country, lead_postal_code = draft.lead_postal_code,
      budget = draft.budget, stage = draft.stage, follow_up_date = draft.follow_up_date,
      score = draft.score, notes = draft.notes, created_at = draft.created_at,
      last_interaction_date = draft.last_interaction_date, last_interaction_by = draft.last_interaction_by,
      status = draft.status
    where lead_id = draft.lead_id and owner_id = auth.uid() returning * into saved;
    if not found then raise exception using errcode = 'P0002', message = 'Lead not found.'; end if;
  end if;
  perform set_config('autotrack.duplicate_confirmation', coalesce(previous_confirmation, ''), true);
  return saved;
end $$;
revoke all on function public.save_lead_validated(jsonb, bigint[]) from public, anon;
grant execute on function public.save_lead_validated(jsonb, bigint[]) to authenticated;
notify pgrst, 'reload schema';
commit;
