-- Elite Quote Flow Pro-value features. Run after a verified backup.
-- Adds referral codes, invoice balance checkout columns, and unique referral code index.

alter table public.profiles
  add column if not exists referral_code text,
  add column if not exists referred_by_code text,
  add column if not exists referral_credits_months integer not null default 0,
  add column if not exists referral_reward_status text not null default 'none';

alter table public.profiles drop constraint if exists profiles_referral_code_format;
alter table public.profiles add constraint profiles_referral_code_format
  check (referral_code is null or referral_code ~ '^EQF[A-Z0-9]{4,16}$') not valid;

alter table public.profiles drop constraint if exists profiles_referred_by_code_format;
alter table public.profiles add constraint profiles_referred_by_code_format
  check (referred_by_code is null or referred_by_code ~ '^EQF[A-Z0-9]{4,16}$') not valid;

alter table public.profiles drop constraint if exists profiles_referral_credits_check;
alter table public.profiles add constraint profiles_referral_credits_check
  check (referral_credits_months >= 0) not valid;

alter table public.profiles drop constraint if exists profiles_referral_reward_status_check;
alter table public.profiles add constraint profiles_referral_reward_status_check
  check (referral_reward_status in ('none', 'pending', 'credited', 'paid')) not valid;

create unique index if not exists profiles_referral_code_uidx
  on public.profiles (referral_code)
  where referral_code is not null;

alter table public.quotes
  add column if not exists stripe_invoice_checkout_session_id text,
  add column if not exists stripe_invoice_payment_url text;

-- Optional: validate deferred constraints after confirming no bad existing rows.
-- alter table public.profiles validate constraint profiles_referral_code_format;
-- alter table public.profiles validate constraint profiles_referred_by_code_format;
-- alter table public.profiles validate constraint profiles_referral_credits_check;
-- alter table public.profiles validate constraint profiles_referral_reward_status_check;
