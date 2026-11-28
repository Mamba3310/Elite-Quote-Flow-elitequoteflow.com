-- Run in Supabase SQL Editor to align account currency validation with the supported settings list.
-- Existing quote and template currency values remain untouched; unsupported profile default values are normalized.
begin;
update public.profiles set default_currency = 'USD'
where default_currency not in ('USD','EUR','GBP','CAD','AUD','NZD','CHF','JPY','CNY','INR','MXN','BRL','ZAR','SGD','HKD','SEK','NOK','DKK','PLN');
alter table public.profiles drop constraint if exists profiles_default_currency_check;
alter table public.profiles add constraint profiles_default_currency_check
  check (default_currency in ('USD','EUR','GBP','CAD','AUD','NZD','CHF','JPY','CNY','INR','MXN','BRL','ZAR','SGD','HKD','SEK','NOK','DKK','PLN'));
commit;
