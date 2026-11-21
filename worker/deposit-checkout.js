const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function readJson(response) { const text = await response.text(); try { return text ? JSON.parse(text) : null; } catch { return null; } }
export async function onDepositCheckout(request, env) {
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_ANON_KEY?.trim() || !env.STRIPE_SECRET_KEY?.trim()) return json({ error: 'Deposit checkout is not configured.' }, 503);
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ error: 'Sign in to create a deposit link.' }, 401);
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(payload?.quoteId || '') || !/^[0-9a-f-]{36}$/i.test(payload?.publicToken || '')) return json({ error: 'Invalid quote.' }, 400);
  const base = env.SUPABASE_URL.trim().replace(/\/$/, '');
  const userResponse = await fetch(`${base}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY.trim(), Authorization: authorization } });
  if (!userResponse.ok) return json({ error: 'Sign in again to create a deposit link.' }, 401);
  const user = await readJson(userResponse);
  if (!user?.id) return json({ error: 'Could not validate your account.' }, 401);
  const quoteResponse = await fetch(`${base}/rest/v1/quotes?id=eq.${encodeURIComponent(payload.quoteId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,public_token,customer,email,service,amount,currency,deposit_percent,status,deposit_paid_at,stripe_checkout_session_id,stripe_payment_url&limit=1`, { headers: { apikey: env.SUPABASE_ANON_KEY.trim(), Authorization: authorization } });
  if (!quoteResponse.ok) return json({ error: 'Could not load this quote.' }, 502);
  const [quote] = await quoteResponse.json();
  if (!quote || quote.public_token !== payload.publicToken || Number(quote.deposit_percent) <= 0) return json({ error: 'This quote has no deposit configured.' }, 404);
  if (quote.status !== 'sent' || quote.deposit_paid_at) return json({ error: 'Deposit checkout is unavailable for an answered or paid quote.' }, 409);
  if (quote.stripe_payment_url && quote.stripe_checkout_session_id) return json({ url: quote.stripe_payment_url });
  let fractionDigits;
  try { fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency: quote.currency || 'USD' }).resolvedOptions().maximumFractionDigits; }
  catch { return json({ error: 'Quote currency is not supported by Stripe.' }, 400); }
  const amount = Math.round(Number(quote.amount) * Number(quote.deposit_percent) / 100 * (10 ** fractionDigits));
  if (!Number.isSafeInteger(amount) || amount <= 0) return json({ error: 'Deposit amount is invalid.' }, 400);
  const origin = new URL(request.url).origin;
  const form = new URLSearchParams({ mode: 'payment', success_url: `${origin}/q/${payload.publicToken}?deposit=success`, cancel_url: `${origin}/q/${payload.publicToken}`, 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': String(quote.currency || 'USD').toLowerCase(), 'line_items[0][price_data][unit_amount]': String(amount), 'line_items[0][price_data][product_data][name]': `Deposit: ${quote.service}`, 'metadata[quote_id]': quote.id, 'metadata[supabase_user_id]': user.id });
  if (quote.email) form.set('customer_email', quote.email);
  const idempotencyKey = `eqf-deposit-${quote.id}-${amount}-${encodeURIComponent(payload.publicToken)}`;
  const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey }, body: form });
  const session = await readJson(stripeResponse);
  if (!stripeResponse.ok || !session?.id || !session?.url) {
    console.error('Stripe deposit session creation failed', stripeResponse.status, session?.error?.code || 'unknown');
    return json({ error: 'Could not create the Stripe deposit checkout.' }, 502);
  }
  const update = await fetch(`${base}/rest/v1/quotes?id=eq.${encodeURIComponent(quote.id)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: 'PATCH', headers: { apikey: env.SUPABASE_ANON_KEY.trim(), Authorization: authorization, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ stripe_checkout_session_id: session.id, stripe_payment_url: session.url, updated_at: new Date().toISOString() }) });
  if (!update.ok) return json({ error: 'Stripe link was created but could not be saved. Retry after checking the quote.' }, 502);
  return json({ url: session.url });
}
