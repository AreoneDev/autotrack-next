-- Disposable test database only. Exercise the real RPC, RLS and revision trigger.
-- Every fixture and test-only trigger is rolled back.
begin;
insert into auth.users(id, email) values
 ('77777777-7777-4777-8777-777777777771', 'contact-a@example.invalid'),
 ('77777777-7777-4777-8777-777777777772', 'contact-b@example.invalid');

create function pg_temp.fail_contact_update() returns trigger language plpgsql as $$
begin
  if new.phone = '+14165550999' and new.last_interaction_date is distinct from old.last_interaction_date then
    raise exception 'Synthetic lead update failure';
  end if;
  return new;
end $$;
create trigger contact_test_failure before update on public.leads
  for each row execute function pg_temp.fail_contact_update();

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777771","role":"authenticated"}', true);
do $$
declare
  v_lead public.leads%rowtype;
  v_saved public.leads%rowtype;
  v_result jsonb;
  v_time timestamptz := clock_timestamp() - interval '1 minute';
  v_id uuid := '88888888-8888-4888-8888-888888888881';
  v_channel text;
begin
  insert into public.leads(first_name, last_name, stage, score, notes, follow_up_date,
                          last_interaction_date, last_interaction_by)
    values('Contact', 'Fixture', 'CONTACTED', 65, 'Keep my notes', v_time + interval '7 days',
           v_time - interval '2 days', 'LEAD') returning * into v_lead;
  perform set_config('autotrack.test_contact_lead', v_lead.lead_id::text, true);
  v_result := public.autotrack_log_communication(v_lead.lead_id, v_id, 'call', v_time, v_lead.version, 35);
  select * into v_saved from public.leads where lead_id = v_lead.lead_id;
  if v_saved.last_interaction_date <> v_time or v_saved.last_interaction_by <> 'USER'
     or v_saved.score <> 35 or v_saved.version <> v_lead.version + 1
     or v_saved.notes <> v_lead.notes or v_saved.follow_up_date <> v_lead.follow_up_date
     or v_result->'notification'->>'title' <> 'You called Contact Fixture' then
    raise exception 'Communication did not atomically synchronize the existing fields';
  end if;

  -- Lost-response replay uses the original version and must be read-only.
  perform public.autotrack_log_communication(v_lead.lead_id, v_id, 'call', v_time, v_lead.version, 999);
  if (select count(*) from public.notifications where sync_id = v_id) <> 1
     or (select version from public.leads where lead_id = v_lead.lead_id) <> v_saved.version
     or (select score from public.leads where lead_id = v_lead.lead_id) <> 35 then
    raise exception 'Replay repeated writes';
  end if;
  begin
    perform public.autotrack_log_communication(v_lead.lead_id, v_id, 'email', v_time, v_saved.version, 35);
    raise exception 'Retry identity mismatch was accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.autotrack_log_communication(v_lead.lead_id, gen_random_uuid(), 'email', v_time, v_lead.version, 35);
    raise exception 'Stale score was accepted';
  exception when serialization_failure then null;
  end;
  if (select count(*) from public.notifications where lead_id = v_lead.lead_id) <> 1 then
    raise exception 'Version conflict inserted a partial notification';
  end if;

  -- A delayed older event is recorded without regressing a newer inbound row.
  update public.leads set last_interaction_date = v_time + interval '1 second', last_interaction_by = 'LEAD', score = 65
    where lead_id = v_lead.lead_id returning * into v_saved;
  perform public.autotrack_log_communication(v_lead.lead_id, gen_random_uuid(), 'message', v_time, v_saved.version, 0);
  if (select row(last_interaction_date, last_interaction_by, score, version) from public.leads where lead_id = v_lead.lead_id)
      is distinct from row(v_saved.last_interaction_date, 'LEAD'::text, 65, v_saved.version) then
    raise exception 'Delayed outbound contact overwrote newer contact metadata';
  end if;

  foreach v_channel in array array['email', 'message'] loop
    v_time := v_time + interval '2 seconds';
    v_result := public.autotrack_log_communication(v_lead.lead_id, gen_random_uuid(), v_channel, v_time, v_saved.version, 35);
    select * into v_saved from public.leads where lead_id = v_lead.lead_id;
    if v_saved.last_interaction_date <> v_time or v_saved.last_interaction_by <> 'USER' then
      raise exception 'Channel did not synchronize';
    end if;
  end loop;

  -- Fail after notification insertion: the whole RPC must roll back.
  update public.leads set phone = '+14165550999' where lead_id = v_lead.lead_id returning * into v_saved;
  begin
    perform public.autotrack_log_communication(v_lead.lead_id, '88888888-8888-4888-8888-888888888889',
        'call', v_time + interval '1 second', v_saved.version, 35);
    raise exception 'Synthetic failure did not run';
  exception when others then
    if sqlerrm <> 'Synthetic lead update failure' then raise; end if;
  end;
  if exists(select 1 from public.notifications where sync_id = '88888888-8888-4888-8888-888888888889')
     or (select version from public.leads where lead_id = v_lead.lead_id) <> v_saved.version then
    raise exception 'Failed RPC left partial writes';
  end if;
end $$;

select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777772","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.autotrack_log_communication(current_setting('autotrack.test_contact_lead')::bigint,
      gen_random_uuid(), 'call', now(), 1, 35);
    raise exception 'Other owner could log a contact';
  exception when others then
    if sqlerrm <> 'Lead not found.' then raise; end if;
  end;
end $$;

set local role anon;
do $$
begin
  begin
    perform public.autotrack_log_communication(1, gen_random_uuid(), 'call', now(), 1, 35);
    raise exception 'Anonymous caller could log a contact';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
