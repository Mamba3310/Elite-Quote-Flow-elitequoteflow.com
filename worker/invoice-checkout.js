import { json, requireProUser, readJson } from './pro-access.js';

export async function onInvoiceCheckout(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!env.STRIPE_SECRET_KEY?.trim()) return json({ error: 'Invoice checkout is not configured.' }, 503);
  const access = await requireProUser(request, env);
  if (access.error) return access.error;
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(payload?.quoteId || '')) return json({ error: 'Invalid quote.' }, 400);

  const quoteResponse = await fetch(
    `${access.base}/rest/v1/quotes?id=eq.${encodeURIComponent(payload.quoteId)}&user_id=eq.${encodeURIComponent(access.user.id)}&select=id,customer,email,service,amount,currency,status,invoice_status,deposit_percent,deposit_paid_at,stripe_invoice_checkout_session_id,stripe_invoice_payment_url,invoice_paid_at&limit=1`,
    { headers: { apikey: env.SUPABASE_ANON_KEY.trim(), Authorization: access.authorization } }
  );
  if (!quoteResponse.ok) {
    // Fallback without newer invoice checkout columns.
    const legacy = await fetch(
      `${access.base}/rest/v1/quotes?id=eq.${encodeURIComponent(payload.quoteId)}&user_id=eq.${encodeURIComponent(access.user.id)}&select=id,customer,email,service,amount,currency,status,invoice_status,deposit_percent,deposit_paid_at,invoice_paid_at&limit=1`,
      { headers: { apikey: env.SUPABASE_ANON_KEY.trim(), Authorization: access.authorization } }
    );
    if (!legacy.ok) return json({ error: 'Could not load this quote.' }, 502);
    const [legacyQuote] = await legacy.json();
    if (!legacyQuote) return json({ error: 'Quote not found.' }, 404);
    return createInvoiceSession(request, env, access, legacyQuote);
  }
  const [quote] = await quoteResponse.json();
  if (!quote) return json({ error: 'Quote not found.' }, 404);
  if (quote.stripe_invoice_payment_url && quote.stripe_invoice_checkout_session_id && quote.invoice_status !== 'paid') {
    return json({ url: quote.stripe_invoice_payment_url });
  }
  return createInvoiceSession(request, env, access, quote);
}

async function createInvoiceSession(request, env, access, quote) {
  if (quote.status !== 'won') return json({ error: 'Accept the quote before collecting the balance.' }, 409);
  if (quote.invoice_status === 'paid' || quote.invoice_paid_at) return json({ error: 'This invoice is already marked paid.' }, 409);

  let fractionDigits;
  try { fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency: quote.currency || 'USD' }).resolvedOptions().maximumFractionDigits; }
  catch { return json({ error: 'Quote currency is not supported by Stripe.' }, 400); }

  const total = Number(quote.amount) || 0;
  const depositFraction = Math.max(0, Math.min(100, Number(quote.deposit_percent) || 0)) / 100;
  const depositPaid = quote.deposit_paid_at ? total * depositFraction : 0;
  const balance = Math.max(0, Math.round((total - depositPaid) * (10 ** fractionDigits)));
  if (!Number.isSafeInteger(balance) || balance <= 0) return json({ error: 'There is no remaining balance to collect.' }, 400);

  const origin = new URL(request.url).origin;
  const form = new URLSearchParams({
    mode: 'payment',
    success_url: `${origin}/?invoice=success`,
    cancel_url: `${origin}/?invoice=cancelled`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': String(quote.currency || 'USD').toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(balance),
    'line_items[0][price_data][product_data][name]': `Invoice balance: ${quote.service}`,
    'metadata[quote_id]': quote.id,
    'metadata[supabase_user_id]': access.user.id,
    'metadata[payment_type]': 'invoice_balance'
  });
  if (quote.email) form.set('customer_email', quote.email);
  const idempotencyKey = `eqf-invoice-${quote.id}-${balance}`;
  const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey
    },
    body: form
  });
  const session = await readJson(stripeResponse);
  if (!stripeResponse.ok || !session?.id || !session?.url) {
    console.error('Stripe invoice session creation failed', stripeResponse.status, session?.error?.code || 'unknown');
    return json({ error: 'Could not create the Stripe invoice checkout.' }, 502);
  }

  const update = await fetch(
    `${access.base}/rest/v1/quotes?id=eq.${encodeURIComponent(quote.id)}&user_id=eq.${encodeURIComponent(access.user.id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_ANON_KEY.trim(),
        Authorization: access.authorization,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        stripe_invoice_checkout_session_id: session.id,
        stripe_invoice_payment_url: session.url,
        invoice_status: quote.invoice_status === 'not_invoiced' ? 'unpaid' : quote.invoice_status,
        updated_at: new Date().toISOString()
      })
    }
  );
  if (!update.ok) {
    // Columns may not exist yet; still return the Stripe URL for this session.
    console.warn('Could not persist invoice checkout columns; returning Stripe URL anyway.', update.status);
  }
  return json({ url: session.url });
}
