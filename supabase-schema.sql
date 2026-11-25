-- Run this script in Supabase Dashboard → SQL Editor.
-- Every quote is owned by its authenticated user; RLS is the security boundary.
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  customer text not null check (char_length(customer) between 1 and 70),
  service text not null check (char_length(service) between 1 and 80),
  email text not null default '' check (char_length(email) <= 120),
  phone text not null default '' check (char_length(phone) <= 30),
  referral_source text not null default '' check (char_length(referral_source) <= 100),
  amount numeric(10, 2) not null check (amount > 0 and amount <= 99999999),
  currency text not null default 'USD',
  follow_up date not null,
  status text not null default 'sent' check (status in ('sent', 'won', 'lost')),
  note text not null default '' check (char_length(note) <= 240),
  public_token uuid unique,
  quote_terms text not null default '' check (char_length(quote_terms) <= 2000),
  expires_at date,
  invoice_number text check (char_length(invoice_number) <= 40),
  invoice_status text not null default 'not_invoiced' check (invoice_status in ('not_invoiced', 'unpaid', 'paid')),
  invoice_due_date date,
  invoice_paid_at timestamptz,
  line_items jsonb not null default '[]'::jsonb,
  subtotal_amount numeric(12,2),
  tax_rate numeric(7,4) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  deposit_percent numeric(5,2) not null default 0,
  view_count integer not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  accepted_at timestamptz,
  accepted_by_name text,
  accepted_by_email text,
  accepted_signature text,
  rejected_reason text,
  stripe_checkout_session_id text,
  stripe_payment_url text,
  deposit_paid_at timestamptz,
  reminder_count integer not null default 0,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status_changed_at timestamptz
);

-- Add referral tracking to existing installations as well as fresh ones.
alter table public.quotes
  add column if not exists referral_source text not null default '',
  add column if not exists currency text not null default 'USD';
alter table public.quotes
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists subtotal_amount numeric(12,2),
  add column if not exists tax_rate numeric(7,4) not null default 0,
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists deposit_percent numeric(5,2) not null default 0,
  add column if not exists view_count integer not null default 0,
  add column if not exists first_viewed_at timestamptz,
  add column if not exists last_viewed_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by_name text,
  add column if not exists accepted_by_email text,
  add column if not exists accepted_signature text,
  add column if not exists rejected_reason text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_url text,
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists reminder_count integer not null default 0,
  add column if not exists last_reminder_at timestamptz,
  add column if not exists public_token uuid,
  add column if not exists quote_terms text not null default '',
  add column if not exists expires_at date,
  add column if not exists invoice_number text,
  add column if not exists invoice_status text not null default 'not_invoiced',
  add column if not exists invoice_due_date date,
  add column if not exists invoice_paid_at timestamptz;

alter table public.quotes drop constraint if exists quotes_quote_terms_length;
alter table public.quotes add constraint quotes_quote_terms_length check (char_length(quote_terms) <= 2000);
alter table public.quotes drop constraint if exists quotes_invoice_status_check;
alter table public.quotes add constraint quotes_invoice_status_check check (invoice_status in ('not_invoiced', 'unpaid', 'paid'));
alter table public.quotes drop constraint if exists quotes_invoice_number_length;
alter table public.quotes add constraint quotes_invoice_number_length check (invoice_number is null or char_length(invoice_number) <= 40);
create unique index if not exists quotes_public_token_uidx on public.quotes (public_token) where public_token is not null;

create table if not exists public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 60),
  service text not null check (char_length(service) between 1 and 80),
  amount numeric(10, 2) not null check (amount > 0 and amount <= 99999999),
  currency text not null default 'USD',
  quote_terms text not null default '' check (char_length(quote_terms) <= 2000),
  line_items jsonb not null default '[]'::jsonb,
  subtotal_amount numeric(12,2),
  tax_rate numeric(7,4) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  deposit_percent numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.quote_templates
  add column if not exists currency text not null default 'USD',
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists subtotal_amount numeric(12,2),
  add column if not exists tax_rate numeric(7,4) not null default 0,
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists deposit_percent numeric(5,2) not null default 0;

alter table public.quote_templates enable row level security;
drop policy if exists "Users manage their quote templates" on public.quote_templates;
create policy "Users manage their quote templates" on public.quote_templates
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.quote_templates to authenticated;

-- Private profile metadata for each account; email remains managed by Supabase Auth.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  business_name text not null default '' check (char_length(business_name) <= 100),
  phone text not null default '' check (char_length(phone) <= 30),
  is_pro boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_subscription_status text,
  company_logo_url text,
  brand_color text not null default '#426DDE',
  company_address text not null default '',
  default_currency text not null default 'USD',
  tax_id text not null default '',
  referral_credits_months integer not null default 0,
  referral_reward_status text not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add subscription fields to existing installations.
alter table public.profiles
  add column if not exists is_pro boolean not null default false,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_status text,
  add column if not exists company_logo_url text,
  add column if not exists brand_color text not null default '#426DDE',
  add column if not exists company_address text not null default '',
  add column if not exists tax_id text not null default '',
  add column if not exists default_currency text not null default 'USD',
  add column if not exists referral_credits_months integer not null default 0,
  add column if not exists referral_reward_status text not null default 'none',
  add column if not exists signup_ip_hash text;

alter table public.profiles drop constraint if exists profiles_brand_color_check;
alter table public.profiles add constraint profiles_brand_color_check check (brand_color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.profiles drop constraint if exists profiles_default_currency_check;
alter table public.profiles add constraint profiles_default_currency_check check (default_currency in ('USD','EUR','GBP','NGN','CAD','AUD','NZD','CHF','JPY','CNY','INR','MXN','BRL','ZAR','SGD','HKD','SEK','NOK','DKK','PLN'));
alter table public.profiles drop constraint if exists profiles_referral_credits_check;
alter table public.profiles add constraint profiles_referral_credits_check check (referral_credits_months >= 0);
alter table public.profiles drop constraint if exists profiles_referral_reward_status_check;
alter table public.profiles add constraint profiles_referral_reward_status_check check (referral_reward_status in ('none', 'pending', 'credited', 'paid'));

create unique index if not exists profiles_stripe_customer_id_uidx
  on public.profiles (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists profiles_stripe_subscription_id_uidx
  on public.profiles (stripe_subscription_id) where stripe_subscription_id is not null;

-- Only the trusted webhook service role may set subscription state.
create or replace function public.guard_profile_billing_fields()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'INSERT' then
      if new.is_pro or new.stripe_customer_id is not null or new.stripe_subscription_id is not null or new.stripe_subscription_status is not null then
        raise exception 'Billing fields may only be set by the billing service.' using errcode = '42501';
      end if;
    elsif new.is_pro is distinct from old.is_pro
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id
       or new.stripe_subscription_status is distinct from old.stripe_subscription_status then
      raise exception 'Billing fields may only be changed by the billing service.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_billing_fields on public.profiles;
create trigger guard_profile_billing_fields
  before insert or update on public.profiles
  for each row execute function public.guard_profile_billing_fields();

-- Backfill profile rows for accounts that already exist.
alter table public.profiles alter column full_name drop not null;
alter table public.profiles alter column business_name drop not null;
alter table public.profiles alter column phone drop not null;

insert into public.profiles (id, full_name, business_name, phone)
select
  id,
  coalesce(raw_user_meta_data ->> 'full_name', ''),
  coalesce(raw_user_meta_data ->> 'business_name', ''),
  coalesce(raw_user_meta_data ->> 'phone', '')
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Users can create their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Users can read their own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "Users can create their own profile"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

grant select, insert, update on public.profiles to authenticated;

-- Create a profile row automatically for future account signups.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, business_name, phone, company_address, default_currency)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80),
    left(coalesce(new.raw_user_meta_data ->> 'business_name', ''), 100),
    left(coalesce(new.raw_user_meta_data ->> 'phone', ''), 30),
    left(coalesce(new.raw_user_meta_data ->> 'company_address', ''), 300),
    case when coalesce(new.raw_user_meta_data ->> 'default_currency', 'USD') in ('USD','EUR','GBP','NGN','CAD','AUD','NZD','CHF','JPY','CNY','INR','MXN','BRL','ZAR','SGD','HKD','SEK','NOK','DKK','PLN')
      then coalesce(new.raw_user_meta_data ->> 'default_currency', 'USD') else 'USD' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create index if not exists quotes_user_follow_up_idx on public.quotes (user_id, follow_up);
create index if not exists quotes_user_created_idx on public.quotes (user_id, created_at desc);

alter table public.quotes enable row level security;

-- Re-runnable per-action policies for owner-only access.
drop policy if exists "Users can read their own quotes" on public.quotes;
drop policy if exists "Users can add their own quotes" on public.quotes;
drop policy if exists "Users can update their own quotes" on public.quotes;
drop policy if exists "Users can delete their own quotes" on public.quotes;

create policy "Users can read their own quotes"
on public.quotes for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can add their own quotes"
on public.quotes for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own quotes"
on public.quotes for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own quotes"
on public.quotes for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.quotes to authenticated;

-- Enable cross-device realtime updates when the Supabase Realtime publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'quotes'
     ) then
    alter publication supabase_realtime add table public.quotes;
  end if;
end
$$;

-- Elite Quote Flow incremental migration. Take a Supabase backup and verify in staging first.
begin;

alter table public.quotes
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists subtotal_amount numeric(12,2),
  add column if not exists tax_rate numeric(7,4) not null default 0,
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists deposit_percent numeric(5,2) not null default 0,
  add column if not exists view_count integer not null default 0,
  add column if not exists first_viewed_at timestamptz,
  add column if not exists last_viewed_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by_name text,
  add column if not exists accepted_by_email text,
  add column if not exists accepted_signature text,
  add column if not exists rejected_reason text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_url text,
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists reminder_count integer not null default 0,
  add column if not exists last_reminder_at timestamptz;

alter table public.quote_templates
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists subtotal_amount numeric(12,2),
  add column if not exists tax_rate numeric(7,4) not null default 0,
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists deposit_percent numeric(5,2) not null default 0;

alter table public.profiles
  add column if not exists company_logo_url text,
  add column if not exists brand_color text not null default '#426DDE',
  add column if not exists company_address text not null default '',
  add column if not exists default_currency text not null default 'USD',
  add column if not exists referral_credits_months integer not null default 0,
  add column if not exists referral_reward_status text not null default 'none',
  add column if not exists signup_ip_hash text;

alter table public.quotes drop constraint if exists quotes_line_items_array_check;
alter table public.quotes add constraint quotes_line_items_array_check check (case when jsonb_typeof(line_items) = 'array' then jsonb_array_length(line_items) <= 100 else false end);
alter table public.quote_templates drop constraint if exists quote_templates_line_items_array_check;
alter table public.quote_templates add constraint quote_templates_line_items_array_check check (case when jsonb_typeof(line_items) = 'array' then jsonb_array_length(line_items) <= 100 else false end);
alter table public.quotes drop constraint if exists quotes_pricing_ranges_check;
alter table public.quotes add constraint quotes_pricing_ranges_check check (tax_rate between 0 and 100 and discount_amount >= 0 and deposit_percent between 0 and 100 and view_count >= 0 and reminder_count >= 0);
alter table public.quote_templates drop constraint if exists quote_templates_pricing_ranges_check;
alter table public.quote_templates add constraint quote_templates_pricing_ranges_check check (tax_rate between 0 and 100 and discount_amount >= 0 and deposit_percent between 0 and 100);
alter table public.profiles drop constraint if exists profiles_brand_color_check;
alter table public.profiles add constraint profiles_brand_color_check check (brand_color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.profiles drop constraint if exists profiles_default_currency_check;
alter table public.profiles add constraint profiles_default_currency_check check (default_currency in ('USD','EUR','GBP','NGN','CAD','AUD','NZD','CHF','JPY','CNY','INR','MXN','BRL','ZAR','SGD','HKD','SEK','NOK','DKK','PLN'));
alter table public.profiles drop constraint if exists profiles_referral_credits_check;
alter table public.profiles add constraint profiles_referral_credits_check check (referral_credits_months >= 0);
alter table public.profiles drop constraint if exists profiles_referral_reward_status_check;
alter table public.profiles add constraint profiles_referral_reward_status_check check (referral_reward_status in ('none', 'pending', 'credited', 'paid'));
create index if not exists quotes_reminder_due_idx on public.quotes (follow_up, last_reminder_at) where status = 'sent';

create or replace function public.get_public_quote_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare quote_id uuid; result jsonb;
begin
  update public.quotes q set view_count = q.view_count + 1,
    first_viewed_at = coalesce(q.first_viewed_at, now()), last_viewed_at = now()
  where q.public_token = p_token and (q.expires_at is null or q.expires_at >= current_date)
  returning q.id into quote_id;
  if quote_id is null then return null; end if;
  select jsonb_build_object(
    'id', q.id, 'customer', q.customer, 'service', q.service, 'amount', q.amount,
    'currency', q.currency, 'quote_terms', q.quote_terms, 'expires_at', q.expires_at,
    'status', q.status, 'invoice_status', q.invoice_status, 'line_items', q.line_items,
    'subtotal_amount', q.subtotal_amount, 'tax_rate', q.tax_rate,
    'discount_amount', q.discount_amount, 'deposit_percent', q.deposit_percent,
    'stripe_payment_url', q.stripe_payment_url, 'deposit_paid_at', q.deposit_paid_at,
    'brand', jsonb_build_object('business_name', p.business_name, 'company_logo_url', p.company_logo_url,
      'brand_color', p.brand_color, 'company_address', p.company_address)
  ) into result from public.quotes q join public.profiles p on p.id = q.user_id where q.id = quote_id;
  return result;
end;
$$;

create or replace function public.respond_to_public_quote(
  p_token uuid, p_action text, p_name text default '', p_email text default '',
  p_signature text default '', p_reason text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare changed_id uuid;
begin
  if p_action not in ('accept', 'decline') then raise exception 'Invalid quote response.' using errcode = '22023'; end if;
  if p_action = 'accept' and (length(trim(coalesce(p_name, ''))) not between 1 and 120 or length(trim(coalesce(p_signature, ''))) not between 1 and 30000) then
    raise exception 'Name and signature are required to accept.' using errcode = '22023';
  end if;
  if p_action = 'decline' and length(trim(coalesce(p_reason, ''))) > 1000 then raise exception 'Decline reason is too long.' using errcode = '22023'; end if;
  update public.quotes q set
    status = case when p_action = 'accept' then 'won' else 'lost' end,
    status_changed_at = now(), updated_at = now(),
    accepted_at = case when p_action = 'accept' then now() else null end,
    accepted_by_name = case when p_action = 'accept' then trim(p_name) else null end,
    accepted_by_email = case when p_action = 'accept' then nullif(trim(p_email), '') else null end,
    accepted_signature = case when p_action = 'accept' then p_signature else null end,
    rejected_reason = case when p_action = 'decline' then nullif(trim(p_reason), '') else null end
  where q.public_token = p_token and q.status = 'sent' and (q.expires_at is null or q.expires_at >= current_date)
  returning q.id into changed_id;
  if changed_id is null then return jsonb_build_object('received', false); end if;
  return jsonb_build_object('received', true, 'status', case when p_action = 'accept' then 'accepted' else 'declined' end);
end;
$$;
revoke all on function public.get_public_quote_by_token(uuid) from public, anon, authenticated;
revoke all on function public.respond_to_public_quote(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.get_public_quote_by_token(uuid) to service_role;
grant execute on function public.respond_to_public_quote(uuid, text, text, text, text, text) to service_role;
commit;
