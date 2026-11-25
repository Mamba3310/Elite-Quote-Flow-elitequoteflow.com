-- Phase 1/4: add new columns only. Run this first in Supabase SQL Editor.
-- Safe to rerun after a timeout: every addition uses IF NOT EXISTS.
-- The additions use constant defaults; subtotal_amount remains nullable to avoid a table-wide backfill.
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
  add column if not exists tax_id text not null default '',
  add column if not exists referral_credits_months integer not null default 0,
  add column if not exists referral_reward_status text not null default 'none',
  add column if not exists signup_ip_hash text;
