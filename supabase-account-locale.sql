-- Save each account address with the profile, and remember the currency chosen for that account.
-- Safe to run more than once on an existing Elite Quote Flow database.

alter table public.profiles
  add column if not exists company_address text not null default '',
  add column if not exists default_currency text not null default 'USD';

alter table public.profiles drop constraint if exists profiles_default_currency_check;
alter table public.profiles add constraint profiles_default_currency_check
  check (default_currency in ('USD','EUR','GBP','CAD','AUD','NZD','CHF','JPY','CNY','INR','MXN','BRL','ZAR','SGD','HKD','SEK','NOK','DKK','PLN'));

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
    case when coalesce(new.raw_user_meta_data ->> 'default_currency', 'USD') in ('USD','EUR','GBP','CAD','AUD','NZD','CHF','JPY','CNY','INR','MXN','BRL','ZAR','SGD','HKD','SEK','NOK','DKK','PLN')
      then coalesce(new.raw_user_meta_data ->> 'default_currency', 'USD') else 'USD' end
  );
  return new;
end;
$$;
