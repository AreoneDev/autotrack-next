-- Requires 20261107130000_complete_contact_history.sql (contact_direction).
-- No legacy title-based backfill. Incoming contacts are explicitly recorded by the user.
begin;
alter table public.notifications add column if not exists replied_at timestamptz;
alter table public.notifications add constraint notifications_reply_state_valid
    check (replied_at is null or
        (contact_direction is not null and contact_direction = 'inbound'
         and lead_id is not null and date is not null and replied_at >= date));

create or replace function public.mark_notification_replied(p_notification_id bigint)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    contact public.notifications%rowtype;
begin
    select * into contact from public.notifications
    where notification_id = p_notification_id and owner_id = auth.uid()
    for update;
    if not found then
        raise exception 'Incoming contact not found';
    end if;
    if contact.contact_direction is distinct from 'inbound'
        or contact.lead_id is null or contact.date is null or contact.date > now() then
        raise exception 'Only recorded incoming contacts can be marked replied';
    end if;
    -- Preserve the first acknowledgement when the request is retried.
    update public.notifications set replied_at = coalesce(replied_at, now())
    where notification_id = contact.notification_id and owner_id = auth.uid();
end;
$$;
revoke all on function public.mark_notification_replied(bigint) from public, anon;
grant execute on function public.mark_notification_replied(bigint) to authenticated;
commit;

