-- Existing notification and lead fields only. A notification's existing sync_id
-- is the retry key; no second contact-history model is introduced here.
begin;

create or replace function public.autotrack_log_communication(
  p_lead_id bigint,
  p_operation_id uuid,
  p_channel text,
  p_occurred_at timestamptz,
  p_expected_version bigint,
  p_score integer
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_lead public.leads%rowtype;
  v_notification public.notifications%rowtype;
  v_prefix text;
begin
  if auth.uid() is null then raise exception 'Sign in required.'; end if;
  v_prefix := case p_channel
    when 'call' then 'You called '
    when 'email' then 'You sent an email to '
    when 'message' then 'You sent a message to '
    else null end;
  if p_operation_id is null or v_prefix is null
     or p_occurred_at is null or not isfinite(p_occurred_at)
     or p_expected_version is null or p_score is null or p_score < 0 then
    raise exception 'Invalid communication.' using errcode = '22023';
  end if;

  -- Serialize requests for a lead, including concurrent retries of one request.
  select * into v_lead from public.leads
    where lead_id = p_lead_id and owner_id = auth.uid() for update;
  if not found then raise exception 'Lead not found.'; end if;

  select * into v_notification from public.notifications
    where sync_id = p_operation_id and owner_id = auth.uid();
  if found then
    if v_notification.lead_id is distinct from p_lead_id
       or v_notification.date is distinct from p_occurred_at
       or left(v_notification.title, length(v_prefix)) is distinct from v_prefix then
      raise exception 'Communication retry key was already used.' using errcode = '22023';
    end if;
    -- Check replay before version: a lost response must not repeat any writes.
    return jsonb_build_object('lead', to_jsonb(v_lead), 'notification', to_jsonb(v_notification));
  end if;

  if v_lead.version <> p_expected_version then
    raise exception 'Lead changed while logging communication. Retry.' using errcode = '40001';
  end if;
  if p_occurred_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'Communication date is in the future.' using errcode = '22023';
  end if;

  insert into public.notifications(lead_id, title, date, sync_id)
    values(p_lead_id, v_prefix || coalesce(nullif(btrim(concat_ws(' ', v_lead.first_name, v_lead.last_name)), ''), 'this lead'),
           p_occurred_at, p_operation_id)
    returning * into v_notification;

  -- A delayed request still records its notification but cannot overwrite a
  -- newer inbound or outbound contact, its direction, or its score.
  if v_lead.last_interaction_date is null or p_occurred_at >= v_lead.last_interaction_date then
    update public.leads
      set last_interaction_date = p_occurred_at, last_interaction_by = 'USER', score = p_score
      where lead_id = p_lead_id and owner_id = auth.uid()
      returning * into v_lead;
  end if;

  return jsonb_build_object('lead', to_jsonb(v_lead), 'notification', to_jsonb(v_notification));
end $$;

revoke all on function public.autotrack_log_communication(bigint, uuid, text, timestamptz, bigint, integer) from public, anon;
grant execute on function public.autotrack_log_communication(bigint, uuid, text, timestamptz, bigint, integer) to authenticated;
commit;
