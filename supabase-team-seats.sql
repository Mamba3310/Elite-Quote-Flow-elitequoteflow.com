-- Team seat subscriptions, atomic seat reservations, and membership entitlements.
-- Apply after supabase-growth-features.sql and before deploying the Worker changes.
begin;

alter table public.business_teams
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists seat_limit integer not null default 3,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists business_teams_stripe_subscription_id_uidx
  on public.business_teams (stripe_subscription_id) where stripe_subscription_id is not null;
alter table public.business_teams drop constraint if exists business_teams_subscription_status_check;
update public.business_teams set subscription_status = 'canceled' where subscription_status not in ('inactive','incomplete','incomplete_expired','trialing','active','past_due','unpaid','canceled','paused');
alter table public.business_teams add constraint business_teams_subscription_status_check
  check (subscription_status in ('inactive','incomplete','incomplete_expired','trialing','active','past_due','unpaid','canceled','paused'));
alter table public.business_teams drop constraint if exists business_teams_seat_limit_check;
update public.business_teams set seat_limit = greatest(3, least(50, seat_limit));
alter table public.business_teams add constraint business_teams_seat_limit_check check (seat_limit between 3 and 50);

-- Billing state and roster changes are service-role-only, including direct PostgREST writes.
drop policy if exists "Team owners manage teams" on public.business_teams;
drop policy if exists "Team owners read teams" on public.business_teams;
create policy "Team owners read teams" on public.business_teams for select to authenticated
  using ((select auth.uid()) = owner_id);
revoke insert, update, delete on public.business_teams from authenticated;
grant select on public.business_teams to authenticated;

drop policy if exists "Team owners manage invitations" on public.business_team_members;
drop policy if exists "Team owners read members" on public.business_team_members;
create policy "Team owners read members" on public.business_team_members for select to authenticated
  using (exists(select 1 from public.business_teams t where t.id = team_id and t.owner_id = (select auth.uid()))
    or user_id = (select auth.uid()));
revoke insert, update, delete on public.business_team_members from authenticated;
grant select on public.business_team_members to authenticated;

create or replace function public.guard_business_team_billing_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and (
    new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.subscription_status is distinct from old.subscription_status
    or new.seat_limit is distinct from old.seat_limit
  ) then
    raise exception 'Team billing and seat limits may only be changed by the billing service.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_business_team_billing_fields on public.business_teams;
create trigger guard_business_team_billing_fields before update on public.business_teams
  for each row execute function public.guard_business_team_billing_fields();

-- The owner consumes one seat; each pending or accepted teammate reservation consumes one more.
create or replace function public.reserve_team_seat(p_owner_id uuid, p_email text, p_role text default 'member')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target public.business_teams%rowtype; existing public.business_team_members%rowtype; created public.business_team_members%rowtype; active_count integer;
begin
  if p_email is null or length(trim(p_email)) not between 3 and 254 or trim(p_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid teammate email.' using errcode = '22023';
  end if;
  if p_role not in ('admin','member','read_only') then raise exception 'Invalid team role.' using errcode = '22023'; end if;
  select * into target from public.business_teams where owner_id = p_owner_id for update;
  if target.id is null or target.subscription_status not in ('active','trialing') then
    raise exception 'An active Crew & Team subscription is required.' using errcode = '42501';
  end if;
  if lower(trim(p_email)) = lower(coalesce((select email from auth.users where id = p_owner_id), '')) then
    raise exception 'The owner already occupies a team seat.' using errcode = '22023';
  end if;
  select * into existing from public.business_team_members
    where team_id = target.id and lower(invited_email) = lower(trim(p_email)) limit 1;
  if existing.id is not null and existing.invitation_status in ('pending','accepted') then
    return to_jsonb(existing);
  end if;
  select count(*)::integer into active_count from public.business_team_members
    where team_id = target.id and invitation_status in ('pending','accepted');
  if active_count >= target.seat_limit - 1 then raise exception 'All teammate seats are in use. Increase your seat count to invite more people.' using errcode = '23514'; end if;
  if existing.id is not null then
    update public.business_team_members set invited_email = lower(trim(p_email)), role = p_role,
      user_id = null, invitation_status = 'pending'
      where id = existing.id returning * into created;
  else
    insert into public.business_team_members(team_id, invited_email, role, invitation_status)
      values(target.id, lower(trim(p_email)), p_role, 'pending') returning * into created;
  end if;
  return to_jsonb(created);
end;
$$;

create or replace function public.accept_team_invite(p_invite_id uuid, p_user_id uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare invite public.business_team_members%rowtype; team public.business_teams%rowtype; active_count integer; updated public.business_team_members%rowtype; target_team_id uuid;
begin
  select team_id into target_team_id from public.business_team_members
    where id = p_invite_id and lower(invited_email) = lower(trim(p_email)) and invitation_status = 'pending';
  if target_team_id is null then return null; end if;
  select * into team from public.business_teams where id = target_team_id for update;
  select * into invite from public.business_team_members
    where id = p_invite_id and team_id = target_team_id and lower(invited_email) = lower(trim(p_email)) and invitation_status = 'pending' for update;
  if invite.id is null then return null; end if;
  if team.id is null or team.subscription_status not in ('active','trialing') then return null; end if;
  select count(*)::integer into active_count from public.business_team_members
    where team_id = team.id and invitation_status in ('pending','accepted');
  if active_count > team.seat_limit - 1 then
    update public.business_team_members set invitation_status = 'revoked' where id = invite.id;
    return null;
  end if;
  update public.business_team_members set invitation_status = 'accepted', user_id = p_user_id
    where id = invite.id returning * into updated;
  return to_jsonb(updated);
end;
$$;

create or replace function public.reconcile_team_seats(p_team_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.business_teams%rowtype; capacity integer;
begin
  select * into target from public.business_teams where id = p_team_id for update;
  if target.id is null then return; end if;
  capacity := greatest(0, target.seat_limit - 1);
  with ranked as (
    select id, row_number() over (order by case invitation_status when 'accepted' then 0 else 1 end, created_at asc) as position
    from public.business_team_members
    where team_id = target.id and invitation_status in ('pending','accepted')
  )
  update public.business_team_members m set invitation_status = 'revoked'
  from ranked r where m.id = r.id and r.position > capacity;
end;
$$;

create or replace function public.is_team_read_only(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id = auth.uid() and exists (
    select 1 from public.business_team_members m
    join public.business_teams t on t.id = m.team_id
    where m.user_id = p_user_id and m.invitation_status = 'accepted' and m.role = 'read_only'
      and t.subscription_status in ('active','trialing')
  );
$$;

-- Keep read-only seats from changing application data through direct Supabase calls.
drop policy if exists "Users can read their own quotes" on public.quotes;
drop policy if exists "Users can add their own quotes" on public.quotes;
drop policy if exists "Users can update their own quotes" on public.quotes;
drop policy if exists "Users can delete their own quotes" on public.quotes;
create policy "Users can read their own quotes" on public.quotes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can add their own quotes" on public.quotes for insert to authenticated
  with check ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));
create policy "Users can update their own quotes" on public.quotes for update to authenticated
  using ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())))
  with check ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));
create policy "Users can delete their own quotes" on public.quotes for delete to authenticated
  using ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));

-- Read-only seats may view their own templates, bookings, recurring services, and notes, but cannot mutate them.
drop policy if exists "Users manage their quote templates" on public.quote_templates;
create policy "Users read their quote templates" on public.quote_templates for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add their quote templates" on public.quote_templates for insert to authenticated with check ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));
create policy "Users update their quote templates" on public.quote_templates for update to authenticated using ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid()))) with check ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));
create policy "Users delete their quote templates" on public.quote_templates for delete to authenticated using ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));

drop policy if exists "Users manage their bookings" on public.quote_bookings;
create policy "Users read their bookings" on public.quote_bookings for select to authenticated using ((select auth.uid()) = user_id and exists(select 1 from public.quotes q where q.id = quote_id and q.user_id = (select auth.uid())));
create policy "Users add their bookings" on public.quote_bookings for insert to authenticated with check ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())) and exists(select 1 from public.quotes q where q.id = quote_id and q.user_id = (select auth.uid())));
create policy "Users update their bookings" on public.quote_bookings for update to authenticated using ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())) and exists(select 1 from public.quotes q where q.id = quote_id and q.user_id = (select auth.uid()))) with check ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())) and exists(select 1 from public.quotes q where q.id = quote_id and q.user_id = (select auth.uid())));
create policy "Users delete their bookings" on public.quote_bookings for delete to authenticated using ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())) and exists(select 1 from public.quotes q where q.id = quote_id and q.user_id = (select auth.uid())));

drop policy if exists "Users manage their recurring services" on public.recurring_service_plans;
create policy "Users read their recurring services" on public.recurring_service_plans for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add their recurring services" on public.recurring_service_plans for insert to authenticated with check ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));
create policy "Users update their recurring services" on public.recurring_service_plans for update to authenticated using ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid()))) with check ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));
create policy "Users delete their recurring services" on public.recurring_service_plans for delete to authenticated using ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));

drop policy if exists "Users manage their customer notes" on public.customer_notes;
create policy "Users read their customer notes" on public.customer_notes for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users add their customer notes" on public.customer_notes for insert to authenticated with check ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));
create policy "Users update their customer notes" on public.customer_notes for update to authenticated using ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid()))) with check ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));
create policy "Users delete their customer notes" on public.customer_notes for delete to authenticated using ((select auth.uid()) = user_id and not public.is_team_read_only((select auth.uid())));

grant select, insert, update, delete on public.quote_templates, public.quote_bookings, public.recurring_service_plans, public.customer_notes to authenticated;
revoke all on function public.is_team_read_only(uuid) from public, anon;
grant execute on function public.is_team_read_only(uuid) to authenticated, service_role;

create or replace function public.get_team_entitlement(p_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'team_id', t.id,
    'owner_id', t.owner_id,
    'role', m.role,
    'seat_limit', t.seat_limit,
    'subscription_status', t.subscription_status
  )
  from public.business_team_members m
  join public.business_teams t on t.id = m.team_id
  where m.user_id = p_user_id
    and m.invitation_status = 'accepted'
    and t.subscription_status in ('active','trialing')
  order by m.created_at asc
  limit 1;
$$;

revoke all on function public.reserve_team_seat(uuid,text,text) from public, anon, authenticated;
revoke all on function public.accept_team_invite(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.reconcile_team_seats(uuid) from public, anon, authenticated;
revoke all on function public.get_team_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.reserve_team_seat(uuid,text,text) to service_role;
grant execute on function public.accept_team_invite(uuid,uuid,text) to service_role;
grant execute on function public.reconcile_team_seats(uuid) to service_role;
grant execute on function public.get_team_entitlement(uuid) to service_role;

commit;
