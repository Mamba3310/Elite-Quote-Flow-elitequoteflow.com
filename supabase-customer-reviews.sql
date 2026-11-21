-- Customer reviews are published automatically after server-side validation. Email remains private.
begin;
create table if not exists public.customer_reviews (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (char_length(customer_name) between 1 and 80),
  customer_email text not null check (char_length(customer_email) between 3 and 254),
  business_name text not null check (char_length(business_name) between 1 and 100),
  rating smallint not null check (rating between 1 and 5),
  review_text text not null check (char_length(review_text) between 1 and 1500),
  status text not null default 'published' check (status in ('published','hidden')),
  submitted_at timestamptz not null default now(),
  published_at timestamptz not null default now()
);
alter table public.customer_reviews add column if not exists published_at timestamptz;
alter table public.customer_reviews drop constraint if exists customer_reviews_status_check;
update public.customer_reviews set status=case when status in ('pending','approved','published') then 'published' else 'hidden' end, published_at=coalesce(published_at,submitted_at,now());
alter table public.customer_reviews alter column published_at set default now();
alter table public.customer_reviews alter column published_at set not null;
alter table public.customer_reviews add constraint customer_reviews_status_check check (status in ('published','hidden'));
alter table public.customer_reviews alter column status set default 'published';
create unique index if not exists customer_reviews_email_uidx on public.customer_reviews(customer_email);
create index if not exists customer_reviews_published_submitted_idx on public.customer_reviews(submitted_at desc) where status='published';
create or replace function public.submit_customer_review(
  p_customer_name text,p_customer_email text,p_business_name text,p_rating integer,p_review_text text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if length(trim(coalesce(p_customer_name,''))) not between 1 and 80
     or length(trim(coalesce(p_customer_email,''))) not between 3 and 254
     or trim(p_customer_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(trim(coalesce(p_business_name,''))) not between 1 and 100
     or p_rating not between 1 and 5
     or length(trim(coalesce(p_review_text,''))) not between 1 and 1500 then
    raise exception 'Invalid customer review.' using errcode='22023';
  end if;
  insert into public.customer_reviews(customer_name,customer_email,business_name,rating,review_text,status,published_at)
  values(left(trim(p_customer_name),80),lower(trim(p_customer_email)),left(trim(p_business_name),100),p_rating,left(trim(p_review_text),1500),'published',now())
  on conflict (customer_email) do nothing returning id into new_id;
  if new_id is null then return jsonb_build_object('received',false,'reason','duplicate'); end if;
  return jsonb_build_object('received',true,'message','Thank you. Your review is now published on the landing page.');
end;
$$;
create or replace function public.get_published_customer_reviews(p_limit integer default 12)
returns table(customer_name text,business_name text,rating smallint,review_text text,submitted_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select r.customer_name,r.business_name,r.rating,r.review_text,r.submitted_at
  from public.customer_reviews r where r.status='published'
  order by r.submitted_at desc limit greatest(1,least(coalesce(p_limit,12),30));
$$;
revoke all on function public.submit_customer_review(text,text,text,integer,text) from public,authenticated;
grant execute on function public.submit_customer_review(text,text,text,integer,text) to anon,authenticated,service_role;
revoke all on function public.get_published_customer_reviews(integer) from public,authenticated;
grant execute on function public.get_published_customer_reviews(integer) to anon,authenticated,service_role;
alter table public.customer_reviews enable row level security;
revoke all on public.customer_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.customer_reviews to service_role;
commit;
