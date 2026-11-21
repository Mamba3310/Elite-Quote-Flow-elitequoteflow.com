-- Run in Supabase Dashboard → SQL Editor to enable multi-currency quotes.
-- Existing quotes default to USD; this migration also creates the templates table if absent.
alter table public.quotes add column if not exists currency text not null default 'USD';

create table if not exists public.quote_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 60),
  service text not null check (char_length(service) between 1 and 80),
  amount numeric(10, 2) not null check (amount > 0 and amount <= 99999999),
  currency text not null default 'USD',
  quote_terms text not null default '' check (char_length(quote_terms) <= 2000),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.quote_templates add column if not exists currency text not null default 'USD';
alter table public.quote_templates enable row level security;
drop policy if exists "Users manage their quote templates" on public.quote_templates;
create policy "Users manage their quote templates" on public.quote_templates
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.quote_templates to authenticated;
