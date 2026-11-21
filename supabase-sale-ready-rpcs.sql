-- Phase 3/4: install the public quote RPCs after columns exist. Safe to rerun.
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
