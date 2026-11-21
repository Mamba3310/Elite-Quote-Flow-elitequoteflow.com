-- Elite Quote Flow growth features. Run in Supabase SQL Editor after a verified backup.
begin;

create table if not exists public.quote_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  customer text not null check (char_length(customer) between 1 and 70),
  customer_email text not null default '',
  service text not null check (char_length(service) between 1 and 120),
  scheduled_for timestamptz not null,
  status text not null default 'requested' check (status in ('requested','confirmed','completed','cancelled')),
  customer_note text not null default '' check (char_length(customer_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quote_bookings_owner_date_idx on public.quote_bookings(user_id, scheduled_for);
alter table public.quote_bookings enable row level security;
drop policy if exists "Users manage their bookings" on public.quote_bookings;
create policy "Users manage their bookings" on public.quote_bookings for all to authenticated using ((select auth.uid()) = user_id and exists(select 1 from public.quotes q where q.id=quote_id and q.user_id=(select auth.uid()))) with check ((select auth.uid()) = user_id and exists(select 1 from public.quotes q where q.id=quote_id and q.user_id=(select auth.uid())));
grant select, insert, update, delete on public.quote_bookings to authenticated;

create table if not exists public.recurring_service_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer text not null check (char_length(customer) between 1 and 70),
  email text not null default '',
  service text not null check (char_length(service) between 1 and 120),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'USD',
  frequency text not null check (frequency in ('weekly','monthly','quarterly','annually')),
  next_service_date date not null,
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  notes text not null default '' check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recurring_service_owner_date_idx on public.recurring_service_plans(user_id,next_service_date) where status='active';
alter table public.recurring_service_plans enable row level security;
drop policy if exists "Users manage their recurring services" on public.recurring_service_plans;
create policy "Users manage their recurring services" on public.recurring_service_plans for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.recurring_service_plans to authenticated;

create table if not exists public.business_teams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  unique(owner_id)
);
create table if not exists public.business_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.business_teams(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  invited_email text not null check (char_length(invited_email) between 3 and 254),
  role text not null default 'member' check (role in ('admin','member','read_only')),
  invitation_status text not null default 'pending' check (invitation_status in ('pending','accepted','revoked')),
  created_at timestamptz not null default now(),
  unique(team_id, invited_email)
);
alter table public.business_teams enable row level security;
alter table public.business_team_members enable row level security;
drop policy if exists "Team owners manage teams" on public.business_teams;
create policy "Team owners manage teams" on public.business_teams for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists "Team owners manage invitations" on public.business_team_members;
create policy "Team owners manage invitations" on public.business_team_members for all to authenticated using (exists(select 1 from public.business_teams t where t.id=team_id and t.owner_id=(select auth.uid()))) with check (exists(select 1 from public.business_teams t where t.id=team_id and t.owner_id=(select auth.uid())));
grant select,insert,update,delete on public.business_teams,public.business_team_members to authenticated;

create table if not exists public.accounting_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('quickbooks','xero')),
  external_account_id text not null,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  token_expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  unique(user_id,provider)
);
alter table public.accounting_connections enable row level security;
revoke all on public.accounting_connections from anon,authenticated;
grant all on public.accounting_connections to service_role;

create table if not exists public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer_email text not null default '',
  customer_name text not null check (char_length(customer_name) between 1 and 70),
  note text not null check (char_length(note) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists customer_notes_owner_email_idx on public.customer_notes(user_id,lower(customer_email));
alter table public.customer_notes enable row level security;
drop policy if exists "Users manage their customer notes" on public.customer_notes;
create policy "Users manage their customer notes" on public.customer_notes for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
grant select,insert,update,delete on public.customer_notes to authenticated;

create or replace function public.request_quote_booking(p_token uuid,p_name text,p_email text,p_scheduled_for timestamptz,p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target record; booking_id uuid;
begin
  if length(trim(coalesce(p_name,''))) not between 1 and 70 or length(trim(coalesce(p_email,''))) not between 3 and 254 or p_scheduled_for <= now() or p_scheduled_for > now()+interval '365 days' or length(coalesce(p_note,'')) > 1000 then
    raise exception 'Enter a valid name, email, future date, and note.' using errcode='22023';
  end if;
  select q.id,q.user_id,q.customer,q.service into target from public.quotes q where q.public_token=p_token and q.status='won' and (q.expires_at is null or q.expires_at>=current_date);
  if target.id is null then return jsonb_build_object('received',false); end if;
  insert into public.quote_bookings(user_id,quote_id,customer,customer_email,service,scheduled_for,customer_note) values(target.user_id,target.id,left(trim(p_name),70),left(trim(p_email),254),target.service,p_scheduled_for,left(trim(coalesce(p_note,'')),1000)) returning id into booking_id;
  return jsonb_build_object('received',true,'booking_id',booking_id);
end;
$$;
revoke all on function public.request_quote_booking(uuid,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.request_quote_booking(uuid,text,text,timestamptz,text) to service_role;

commit;
