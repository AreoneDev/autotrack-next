-- Additive migration. Requires the existing ownership/revision migration.
-- One RPC call is one PostgreSQL transaction; any exception rolls it all back.
begin;

create table public.lead_save_requests (
  owner_id uuid not null default auth.uid() references auth.users(id),
  request_id uuid not null,
  lead_id bigint not null references public.leads(lead_id) on delete cascade,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, request_id)
);
create index lead_save_requests_lead_id_idx on public.lead_save_requests(lead_id);
alter table public.lead_save_requests enable row level security;
revoke all on public.lead_save_requests from public, anon, authenticated;
grant select, insert on public.lead_save_requests to authenticated;
create policy read_own_lead_saves on public.lead_save_requests for select to authenticated
  using (owner_id = (select auth.uid()));
create policy insert_own_lead_saves on public.lead_save_requests for insert to authenticated
  with check (owner_id = (select auth.uid()) and exists (
    select 1 from public.leads l where l.lead_id = lead_save_requests.lead_id
      and l.owner_id = (select auth.uid())
  ));

-- Resolve using caller-visible catalogue rows. Preserve custom trim overrides and
-- choose the smallest ID deterministically when a legacy catalogue has duplicates.
create function public.autotrack_resolve_vehicle(p_selection jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  selected public.vehicles;
  selected_year integer;
  selected_make text := btrim(p_selection->>'make');
  selected_model text := btrim(p_selection->>'model');
  selected_trim text := coalesce(btrim(p_selection->>'trim'), '');
begin
  if p_selection is null or p_selection = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_selection) <> 'object' then
    raise exception 'Invalid vehicle selection.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_selection->>'year'), '') = '' and coalesce(selected_make, '') = ''
    and coalesce(selected_model, '') = '' and selected_trim = '' then return null; end if;
  if coalesce(p_selection->>'year', '') !~ '^[0-9]{4}$'
    or coalesce(selected_make, '') = '' or coalesce(selected_model, '') = '' then
    raise exception 'Year, make, and model are required to save a vehicle.' using errcode = '22023';
  end if;
  selected_year := (p_selection->>'year')::integer;
  select * into selected from public.vehicles v
    where v.year = selected_year and lower(btrim(v.make)) = lower(selected_make)
      and lower(btrim(v.model)) = lower(selected_model)
    order by (selected_trim <> '' and lower(coalesce(v.trim, '')) = lower(selected_trim)) desc,
      v.vehicle_id asc limit 1;
  if not found then
    raise exception 'Selected vehicle was not found in the catalog.' using errcode = '22023';
  end if;
  return jsonb_build_object('vehicle_id', selected.vehicle_id, 'trim_override',
    case when selected_trim <> '' and selected_trim is distinct from selected.trim then selected_trim end);
end $$;
revoke all on function public.autotrack_resolve_vehicle(jsonb) from public, anon;
grant execute on function public.autotrack_resolve_vehicle(jsonb) to authenticated;

create function public.autotrack_save_lead_details(
  p_lead_id bigint, p_expected_version bigint, p_request_id uuid,
  p_details jsonb, p_interest jsonb, p_trade_in jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_lead public.leads;
  changes public.leads;
  receipt public.lead_save_requests;
  payload jsonb := jsonb_build_object('lead_id', p_lead_id, 'version', p_expected_version,
    'details', p_details, 'interest', p_interest, 'trade_in', p_trade_in);
  interest jsonb;
  trade_in jsonb;
  saved_version bigint;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  if p_request_id is null or p_expected_version is null then
    raise exception 'Request ID and expected version are required.' using errcode = '22023';
  end if;

  -- Lock before consulting the receipt/version: concurrent calls for this lead
  -- serialize, including two copies of the same request after a lost response.
  select * into current_lead from public.leads
    where lead_id = p_lead_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Lead not found.' using errcode = 'P0002'; end if;
  select * into receipt from public.lead_save_requests
    where owner_id = auth.uid() and request_id = p_request_id;
  if found then
    if receipt.payload is distinct from payload then
      raise exception 'Request ID was already used for different changes.' using errcode = '22023';
    end if;
    return receipt.result;
  end if;
  if current_lead.version <> p_expected_version then
    -- 40001 is reserved for retryable serialization failures in PostgREST.
    raise exception 'This lead changed in another session. Reload before saving again.' using errcode = 'PT409';
  end if;
  if jsonb_typeof(p_details) is distinct from 'object' or p_details - array[
    'first_name','last_name','phone','lead_email','lead_division','lead_address','lead_city',
    'lead_province','lead_country','lead_postal_code','budget','stage','follow_up_date','score','notes','status'
  ] <> '{}'::jsonb then
    raise exception 'Invalid lead fields.' using errcode = '22023';
  end if;
  changes := jsonb_populate_record(current_lead, p_details);
  if coalesce(btrim(changes.first_name), '') = '' and coalesce(btrim(changes.last_name), '') = '' then
    raise exception 'Lead must have at least a first name or last name.' using errcode = '22023';
  end if;
  interest := public.autotrack_resolve_vehicle(p_interest);
  trade_in := public.autotrack_resolve_vehicle(p_trade_in);

  update public.leads set
    first_name = changes.first_name, last_name = changes.last_name, phone = changes.phone,
    lead_email = changes.lead_email, lead_division = changes.lead_division,
    lead_address = changes.lead_address, lead_city = changes.lead_city,
    lead_province = changes.lead_province, lead_country = changes.lead_country,
    lead_postal_code = changes.lead_postal_code, budget = changes.budget,
    stage = changes.stage, follow_up_date = changes.follow_up_date, score = changes.score,
    notes = changes.notes, status = changes.status,
    -- Keep the atomic RPC's optimistic version contract explicit. The shared
    -- revision trigger sets the same old-version-plus-one value when present.
    version = p_expected_version + 1
    where lead_id = p_lead_id and version = p_expected_version
    returning version into saved_version;
  if not found then
    raise exception 'This lead changed in another session. Reload before saving again.' using errcode = 'PT409';
  end if;

  if interest is null then
    delete from public.lead_vehicle_interests where lead_id = p_lead_id;
  else
    insert into public.lead_vehicle_interests(lead_id, vehicle_id, trim_override, updated_at)
      values(p_lead_id, (interest->>'vehicle_id')::bigint, interest->>'trim_override', now())
      on conflict(lead_id) do update set vehicle_id = excluded.vehicle_id,
        trim_override = excluded.trim_override, updated_at = excluded.updated_at;
  end if;
  if trade_in is null then
    delete from public.lead_trade_in_vehicles where lead_id = p_lead_id;
  else
    insert into public.lead_trade_in_vehicles(lead_id, vehicle_id, trim_override, updated_at)
      values(p_lead_id, (trade_in->>'vehicle_id')::bigint, trade_in->>'trim_override', now())
      on conflict(lead_id) do update set vehicle_id = excluded.vehicle_id,
        trim_override = excluded.trim_override, updated_at = excluded.updated_at;
  end if;
  result := jsonb_build_object('version', saved_version,
    'vehicle_interest_id', interest->'vehicle_id', 'trade_in_vehicle_id', trade_in->'vehicle_id');
  insert into public.lead_save_requests(owner_id, request_id, lead_id, payload, result)
    values(auth.uid(), p_request_id, p_lead_id, payload, result);
  return result;
end $$;
revoke all on function public.autotrack_save_lead_details(bigint,bigint,uuid,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.autotrack_save_lead_details(bigint,bigint,uuid,jsonb,jsonb,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
