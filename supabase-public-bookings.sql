-- Standalone public booking requests from /booking, stored for the configured owner.
begin;
create table if not exists public.public_booking_requests (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (char_length(customer_name) between 1 and 80),
  customer_email text not null check (char_length(customer_email) between 3 and 254),
  phone text not null default '' check (char_length(phone) <= 30),
  service text not null check (char_length(service) between 1 and 120),
  preferred_date date not null,
  customer_note text not null default '' check (char_length(customer_note) <= 1000),
  status text not null default 'requested' check (status in ('requested','contacted','confirmed','completed','cancelled')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists public_booking_requests_submitted_idx on public.public_booking_requests(submitted_at desc);
create index if not exists public_booking_requests_date_idx on public.public_booking_requests(preferred_date) where status in ('requested','contacted','confirmed');
alter table public.public_booking_requests enable row level security;
revoke all on public.public_booking_requests from public, anon, authenticated;
grant select, insert, update, delete on public.public_booking_requests to service_role;

create or replace function public.submit_public_booking_request(
  p_customer_name text,p_customer_email text,p_phone text,p_service text,p_preferred_date date,p_customer_note text default ''
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare request_id uuid;
begin
  if length(trim(coalesce(p_customer_name,''))) not between 1 and 80
     or length(trim(coalesce(p_customer_email,''))) not between 3 and 254
     or trim(p_customer_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(coalesce(p_phone,'')) > 30
     or length(trim(coalesce(p_service,''))) not between 1 and 120
     or p_preferred_date < current_date or p_preferred_date > current_date + 366
     or length(coalesce(p_customer_note,'')) > 1000 then
    raise exception 'Invalid booking request.' using errcode='22023';
  end if;
  insert into public.public_booking_requests(customer_name,customer_email,phone,service,preferred_date,customer_note)
  values(left(trim(p_customer_name),80),lower(trim(p_customer_email)),trim(coalesce(p_phone,'')),left(trim(p_service),120),p_preferred_date,left(trim(coalesce(p_customer_note,'')),1000))
  returning id into request_id;
  return jsonb_build_object('received',true,'request_id',request_id);
end;
$$;
revoke all on function public.submit_public_booking_request(text,text,text,text,date,text) from public,authenticated;
grant execute on function public.submit_public_booking_request(text,text,text,text,date,text) to anon,authenticated,service_role;
commit;
