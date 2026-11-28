import { json, requireProUser, readJson } from './pro-access.js';

const COUNTRIES = new Set(['US', 'CA', 'GB', 'AU', 'NZ', 'IE', 'FR', 'ES', 'PT', 'BR', 'MX', 'NG', 'ZA', 'DE', 'NL']);

export async function onConnectOnboarding(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!env.STRIPE_SECRET_KEY?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return json({ error: 'Payout setup is not configured on this deployment.' }, 503);
  }
  const access = await requireProUser(request, env);
  if (access.error) return access.error;
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const country = String(payload?.country || '').trim().toUpperCase();
  if (!COUNTRIES.has(country)) return json({ error: 'Choose a supported payout country.' }, 400);

  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const existingResponse = await fetch(`${access.base}/rest/v1/profiles?id=eq.${encodeURIComponent(access.user.id)}&select=stripe_connect_account_id&limit=1`, { headers });
  if (!existingResponse.ok) return json({ error: 'Could not load the payout account.' }, 502);
  const [existing] = await existingResponse.json();
  let accountId = String(existing?.stripe_connect_account_id || '').trim();

  if (!accountId) {
    const form = new URLSearchParams({
      type: 'express',
      country,
      'capabilities[card_payments][requested]': 'true',
      'capabilities[transfers][requested]': 'true'
    });
    if (access.user.email) form.set('email', access.user.email);
    const created = await fetch('https://api.stripe.com/v1/accounts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    const account = await readJson(created);
    if (!created.ok || !/^acct_[A-Za-z0-9]+$/.test(account?.id || '')) {
      console.error('Stripe Connect account creation failed', created.status, account?.error?.code || 'unknown');
      return json({ error: 'Stripe could not start the payout account.' }, 502);
    }
    accountId = account.id;
    const save = await fetch(`${access.base}/rest/v1/profiles?id=eq.${encodeURIComponent(access.user.id)}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ stripe_connect_account_id: accountId, updated_at: new Date().toISOString() })
    });
    if (!save.ok) return json({ error: 'Stripe account was created but could not be saved. Retry before creating another.' }, 502);
  }

  const origin = new URL(request.url).origin;
  const linkForm = new URLSearchParams({
    account: accountId,
    refresh_url: `${origin}/?payout=refresh`,
    return_url: `${origin}/?payout=return`,
    type: 'account_onboarding'
  });
  const linkResponse = await fetch('https://api.stripe.com/v1/account_links', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: linkForm
  });
  const link = await readJson(linkResponse);
  if (!linkResponse.ok || !link?.url) return json({ error: 'Stripe could not open payout setup.' }, 502);
  return json({ url: link.url });
}
