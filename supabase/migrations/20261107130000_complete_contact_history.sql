-- Additive manual contact history. Existing notifications are intentionally unknown.
-- Apply after the ownership migration; this does not import inbox data or infer replies.
begin;

alter table public.notifications
  add column if not exists contact_direction text,
  add column if not exists contact_channel text,
  add column if not exists contact_outcome text,
  add column if not exists contact_notes text,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists contact_request_id uuid;

alter table public.notifications add constraint notifications_contact_details_check check (
  (contact_direction is null and contact_channel is null and contact_outcome is null
    and contact_notes is null and next_follow_up_at is null and contact_request_id is null)
  or (lead_id is not null and date is not null and contact_direction is not null
    and contact_channel is not null and contact_outcome is not null
    and contact_direction in ('outbound', 'inbound')
    and contact_channel in ('call', 'email', 'message', 'in_person', 'other')
    and contact_outcome in ('connected', 'no_answer', 'voicemail', 'sent', 'received', 'other')
    and (contact_direction <> 'inbound' or contact_outcome in ('connected', 'received', 'other'))
    and (contact_direction <> 'outbound' or contact_outcome <> 'received')
    and (next_follow_up_at is null or next_follow_up_at > date)
    and (contact_notes is null or char_length(contact_notes) <= 10000))
);
create unique index notifications_contact_request_idx
  on public.notifications(owner_id, contact_request_id) where contact_request_id is not null;
create index notifications_lead_history_idx
  on public.notifications(owner_id, lead_id, date desc, notification_id desc);

-- SECURITY INVOKER retains the existing owner and parent-lead RLS checks.
-- Locking the lead serializes writers and the version check protects calculated score.
create function public.autotrack_record_contact(
  p_lead_id bigint, p_request_id uuid, p_direction text, p_channel text,
  p_outcome text, p_occurred_at timestamptz, p_notes text,
  p_next_follow_up_at timestamptz, p_time_zone text,
  p_expected_version bigint, p_score integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_lead public.leads%rowtype;
  saved public.notifications%rowtype;
  task_local_time timestamp;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode = '42501'; end if;
  select * into current_lead from public.leads
    where lead_id = p_lead_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Lead not found.' using errcode = '42501'; end if;

  -- Return the committed row before checking version; a lost HTTP response is safe to retry.
  select * into saved from public.notifications
    where owner_id = auth.uid() and contact_request_id = p_request_id;
  if found then
    if saved.lead_id is distinct from p_lead_id
      or saved.contact_direction is distinct from p_direction
      or saved.contact_channel is distinct from p_channel
      or saved.contact_outcome is distinct from p_outcome
      or saved.date is distinct from p_occurred_at
      or saved.contact_notes is distinct from coalesce(btrim(p_notes), '')
      or saved.next_follow_up_at is distinct from p_next_follow_up_at then
      raise exception 'This request ID was already used for different contact details.' using errcode = '22023';
    end if;
    return to_jsonb(saved);
  end if;
  if p_request_id is null or p_occurred_at is null or not isfinite(p_occurred_at)
    or p_occurred_at > clock_timestamp() + interval '1 minute'
    or p_direction is null or p_direction not in ('inbound', 'outbound')
    or p_channel is null or p_channel not in ('call', 'email', 'message', 'in_person', 'other')
    or p_outcome is null or p_outcome not in ('connected', 'no_answer', 'voicemail', 'sent', 'received', 'other')
    or (p_direction = 'inbound' and p_outcome not in ('connected', 'received', 'other'))
    or (p_direction = 'outbound' and p_outcome = 'received')
    or char_length(coalesce(p_notes, '')) > 10000
    or (p_next_follow_up_at is not null and (not isfinite(p_next_follow_up_at) or p_next_follow_up_at <= p_occurred_at))
    or p_score is null or p_score < 0 then
    raise exception 'Invalid contact details.' using errcode = '22023';
  end if;
  if p_expected_version is distinct from current_lead.version then
    raise exception 'Lead changed while saving.' using errcode = '40001';
  end if;
  if p_next_follow_up_at is not null then
    if not coalesce(current_lead.status, true) or upper(coalesce(current_lead.stage, '')) = 'CLOSED' then
      raise exception 'Closed leads cannot receive a new follow-up. Reopen the lead first.' using errcode = '22023';
    end if;
    if p_time_zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
      raise exception 'Invalid follow-up time zone.' using errcode = '22023';
    end if;
    -- Existing tasks use local wall-clock timestamps; notifications retain the exact instant.
    task_local_time := p_next_follow_up_at at time zone p_time_zone;
  end if;

  insert into public.notifications(lead_id, title, date, contact_direction, contact_channel,
    contact_outcome, contact_notes, next_follow_up_at, contact_request_id)
  values(p_lead_id,
    case when p_direction = 'inbound' then 'Received ' else 'Outgoing ' end ||
      replace(p_channel, '_', ' ') || ': ' || replace(p_outcome, '_', ' '),
    p_occurred_at, p_direction, p_channel, p_outcome, coalesce(btrim(p_notes), ''),
    p_next_follow_up_at, p_request_id)
  returning * into saved;

  -- Backdated history must not move the current contact summary backwards.
  if current_lead.last_interaction_date is null or p_occurred_at >= current_lead.last_interaction_date then
    update public.leads set last_interaction_date = p_occurred_at,
      last_interaction_by = case when p_direction = 'inbound' then 'LEAD' else 'USER' end,
      score = p_score, follow_up_date = coalesce(p_next_follow_up_at, follow_up_date)
    where lead_id = p_lead_id;
  end if;
  if p_next_follow_up_at is not null then
    insert into public.tasks(lead_id, title, task_date, task_type, notes, completed)
    values(p_lead_id, 'Contact follow-up #' || saved.notification_id, task_local_time, 'Follow-up', coalesce(btrim(p_notes), ''), false);
  end if;
  return to_jsonb(saved);
end $$;
revoke all on function public.autotrack_record_contact(bigint,uuid,text,text,text,timestamptz,text,timestamptz,text,bigint,integer) from public, anon;
grant execute on function public.autotrack_record_contact(bigint,uuid,text,text,text,timestamptz,text,timestamptz,text,bigint,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
