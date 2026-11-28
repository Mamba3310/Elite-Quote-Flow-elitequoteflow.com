-- Run once in the Supabase SQL editor before Pro users collect deposits.
-- Customer card payments are created on behalf of this connected account.
alter table public.profiles
  add column if not exists stripe_connect_account_id text not null default '';

revoke update (stripe_connect_account_id) on table public.profiles from anon, authenticated;
