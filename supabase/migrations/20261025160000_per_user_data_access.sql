-- AutoTrack: require a signed-in owner for customer data.
--
-- This migration is intentionally kept with the application source. Apply it
-- only after the web and Android clients both send a Supabase Auth session.
-- Existing production tables were verified empty before this migration was
-- prepared. For a non-empty environment, assign each existing lead to an
-- auth.users record before setting owner_id to NOT NULL.

begin;

-- Each application record belongs to one authenticated user. Tasks and
-- notifications may exist without a lead, so they keep their own ownership.
alter table public.leads
    add column if not exists owner_id uuid
    references auth.users(id)
    default auth.uid();

alter table public.vehicles
    add column if not exists owner_id uuid
    references auth.users(id)
    default auth.uid();

alter table public.tasks
    add column if not exists owner_id uuid
    references auth.users(id)
    default auth.uid();

alter table public.notifications
    add column if not exists owner_id uuid
    references auth.users(id)
    default auth.uid();

alter table public.leads
    alter column owner_id set not null;

alter table public.vehicles
    alter column owner_id set not null;

alter table public.tasks
    alter column owner_id set not null;

alter table public.notifications
    alter column owner_id set not null;

create index if not exists leads_owner_id_idx on public.leads(owner_id);
create index if not exists vehicles_owner_id_idx on public.vehicles(owner_id);
create index if not exists tasks_owner_id_idx on public.tasks(owner_id);
create index if not exists notifications_owner_id_idx on public.notifications(owner_id);

-- Do not expose application data to anonymous visitors. Revoke the policy
-- names currently visible in the dashboard as well as any earlier variants.
drop policy if exists "Allow read access to leads" on public.leads;
drop policy if exists "Allow read access to tasks" on public.tasks;
drop policy if exists "Allow read access to notifications" on public.notifications;
drop policy if exists "Allow read access to vehicles" on public.vehicles;
drop policy if exists "Allow public select access to vehicles" on public.vehicles;
drop policy if exists "Allow public insert access to vehicles" on public.vehicles;
drop policy if exists "Allow public update access to vehicles" on public.vehicles;
drop policy if exists "Allow public delete access to vehicles" on public.vehicles;
drop policy if exists "Allow public select access to notifications" on public.notifications;
drop policy if exists "Allow public insert access to notifications" on public.notifications;
drop policy if exists "Allow public update access to notifications" on public.notifications;
drop policy if exists "Allow public delete access to notifications" on public.notifications;

-- Remove permissive policies on the relationship tables. Their policy names
-- are kept explicit so the migration remains safe to rerun.
drop policy if exists "Allow app read lead vehicle interests" on public.lead_vehicle_interests;
drop policy if exists "Allow app insert lead vehicle interests" on public.lead_vehicle_interests;
drop policy if exists "Allow app update lead vehicle interests" on public.lead_vehicle_interests;
drop policy if exists "Allow app delete lead vehicle interests" on public.lead_vehicle_interests;
drop policy if exists "Allow app read lead trade in vehicles" on public.lead_trade_in_vehicles;
drop policy if exists "Allow app insert lead trade in vehicles" on public.lead_trade_in_vehicles;
drop policy if exists "Allow app update lead trade in vehicles" on public.lead_trade_in_vehicles;
drop policy if exists "Allow app delete lead trade in vehicles" on public.lead_trade_in_vehicles;

-- Customer records can only be read and changed by their owner.
create policy "Users manage their own leads"
on public.leads
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

-- Tasks and notifications can be personal or associated with a lead.
create policy "Users manage their own tasks"
on public.tasks
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users manage their own notifications"
on public.notifications
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

-- Private vehicles and their lead relationships must belong to the same user.
create policy "Users manage their own vehicles"
on public.vehicles
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "Users manage vehicle interests for their own leads"
on public.lead_vehicle_interests
for all
to authenticated
using (
    exists (
        select 1 from public.leads
        where leads.lead_id = lead_vehicle_interests.lead_id
          and leads.owner_id = (select auth.uid())
    )
    and exists (
        select 1 from public.vehicles
        where vehicles.vehicle_id = lead_vehicle_interests.vehicle_id
          and vehicles.owner_id = (select auth.uid())
    )
)
with check (
    exists (
        select 1 from public.leads
        where leads.lead_id = lead_vehicle_interests.lead_id
          and leads.owner_id = (select auth.uid())
    )
    and exists (
        select 1 from public.vehicles
        where vehicles.vehicle_id = lead_vehicle_interests.vehicle_id
          and vehicles.owner_id = (select auth.uid())
    )
);

create policy "Users manage trade-ins for their own leads"
on public.lead_trade_in_vehicles
for all
to authenticated
using (
    exists (
        select 1 from public.leads
        where leads.lead_id = lead_trade_in_vehicles.lead_id
          and leads.owner_id = (select auth.uid())
    )
    and exists (
        select 1 from public.vehicles
        where vehicles.vehicle_id = lead_trade_in_vehicles.vehicle_id
          and vehicles.owner_id = (select auth.uid())
    )
)
with check (
    exists (
        select 1 from public.leads
        where leads.lead_id = lead_trade_in_vehicles.lead_id
          and leads.owner_id = (select auth.uid())
    )
    and exists (
        select 1 from public.vehicles
        where vehicles.vehicle_id = lead_trade_in_vehicles.vehicle_id
          and vehicles.owner_id = (select auth.uid())
    )
);

-- The imported vehicle catalogue is read-only reference data. It contains no
-- customer information and remains available only after sign-in.
drop policy if exists "Authenticated users read imported cars" on public.imported_cars;
create policy "Authenticated users read imported cars"
on public.imported_cars
for select
to authenticated
using (true);

commit;
