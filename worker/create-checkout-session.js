const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

async function readJsonSafely(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function onRequestPost({ request, env }) {
  let stage = 'validating configuration';
  try {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return json({ error: 'Pro checkout is not configured on this deployment.' }, 503);
  }
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Sign in to continue.' }, 401);

  stage = 'validating your sign-in';
  const supabaseResponse = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization }
  });
  if (!supabaseResponse.ok) return json({ error: 'Your sign-in session is invalid or expired.' }, 401);
  const user = await readJsonSafely(supabaseResponse);
  if (!user?.id || !user?.email) return json({ error: 'Could not verify your Supabase session. Sign in again and retry.' }, 401);

  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const plan = payload?.plan === 'pro' ? 'lifetime' : payload?.plan;
  if (!['lifetime', 'monthly'].includes(plan)) return json({ error: 'Unsupported plan.' }, 400);
  const checkoutLink = plan === 'monthly' ? env.STRIPE_PRO_MONTHLY_PAYMENT_LINK : env.STRIPE_PRO_PAYMENT_LINK;
  if (!checkoutLink) return json({ error: `${plan === 'monthly' ? 'Monthly' : 'Lifetime'} Pro checkout is not configured on this deployment.` }, 503);

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  stage = 'checking your Pro subscription';
  const profileResponse = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_pro,stripe_customer_id`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: authorization
    }
  });
  if (!profileResponse.ok) {
    const profileError = await readJsonSafely(profileResponse);
    console.error('Checkout profile lookup failed', profileResponse.status, profileError?.code || profileError?.message || 'unknown Supabase error');
    return json({ error: `Could not verify your subscription status (Supabase HTTP ${profileResponse.status}).` }, 502);
  }
  const profiles = await readJsonSafely(profileResponse);
  if (profiles?.[0]?.is_pro) return json({ error: 'Your Pro subscription is already active.' }, 409);

  stage = 'preparing your secure Stripe Payment Link';
  const paymentUrl = new URL(checkoutLink);
  if (paymentUrl.protocol !== 'https:' || paymentUrl.hostname !== 'buy.stripe.com') {
    return json({ error: 'Pro checkout must be configured with an https://buy.stripe.com Payment Link.' }, 503);
  }
  paymentUrl.searchParams.set('client_reference_id', user.id);
  return json({ url: paymentUrl.toString() });
  } catch (error) {
    const detail = error?.message || String(error);
    console.error('Pro checkout request failed', stage, detail);
    return json({ error: `Checkout failed while ${stage}: ${detail}.` }, 502);
  }
}
