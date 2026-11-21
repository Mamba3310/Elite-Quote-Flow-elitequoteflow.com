-- Phase 2/3: constraints only. They are NOT VALID to avoid scanning old rows at creation.
alter table public.quotes drop constraint if exists quotes_line_items_array_check;
alter table public.quotes add constraint quotes_line_items_array_check check (case when jsonb_typeof(line_items) = 'array' then jsonb_array_length(line_items) <= 100 else false end) not valid;
alter table public.quote_templates drop constraint if exists quote_templates_line_items_array_check;
alter table public.quote_templates add constraint quote_templates_line_items_array_check check (case when jsonb_typeof(line_items) = 'array' then jsonb_array_length(line_items) <= 100 else false end) not valid;
alter table public.quotes drop constraint if exists quotes_pricing_ranges_check;
alter table public.quotes add constraint quotes_pricing_ranges_check check (tax_rate between 0 and 100 and discount_amount >= 0 and deposit_percent between 0 and 100 and view_count >= 0 and reminder_count >= 0) not valid;
alter table public.quote_templates drop constraint if exists quote_templates_pricing_ranges_check;
alter table public.quote_templates add constraint quote_templates_pricing_ranges_check check (tax_rate between 0 and 100 and discount_amount >= 0 and deposit_percent between 0 and 100) not valid;
alter table public.profiles drop constraint if exists profiles_brand_color_check;
alter table public.profiles add constraint profiles_brand_color_check check (brand_color ~ '^#[0-9A-Fa-f]{6}$') not valid;
alter table public.profiles drop constraint if exists profiles_referral_credits_check;
alter table public.profiles add constraint profiles_referral_credits_check check (referral_credits_months >= 0) not valid;
alter table public.profiles drop constraint if exists profiles_referral_reward_status_check;
alter table public.profiles add constraint profiles_referral_reward_status_check check (referral_reward_status in ('none', 'pending', 'credited', 'paid')) not valid;
