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
  if (plan === 'solo_monthly') {
    if (!env.STRIPE_SECRET_KEY?.trim() || !env.STRIPE_SOLO_MONTHLY_PRICE_ID?.trim()) return json({ error: 'Solo Pro monthly checkout is not configured.' }, 503);
    const base = env.SUPABASE_URL.replace(/\/$/, '');
    const profileResponse = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_pro`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization }
    });
    if (!profileResponse.ok) return json({ error: 'Could not verify your current Pro status.' }, 502);
    const profiles = await readJsonSafely(profileResponse);
    if (profiles?.[0]?.is_pro) return json({ error: 'Your Pro subscription is already active.' }, 409);
    const priceId = env.STRIPE_SOLO_MONTHLY_PRICE_ID.trim();
    const priceResponse = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}` }
    });
    const price = await readJsonSafely(priceResponse);
    if (!priceResponse.ok || price?.currency !== 'usd' || price?.unit_amount !== 2900 || price?.recurring?.interval !== 'month' || price?.recurring?.interval_count !== 1) {
      return json({ error: 'Configured Solo Pro price must be USD $29/month.' }, 503);
    }
    const appUrl = env.PUBLIC_APP_URL || new URL(request.url).origin;
    const form = new URLSearchParams({
      mode: 'subscription',
      success_url: `${appUrl}/?checkout=complete`,
      cancel_url: `${appUrl}/#what-you-get`,
      client_reference_id: user.id,
      customer_email: user.email
    });
    form.set('line_items[0][price]', priceId);
    form.set('line_items[0][quantity]', '1');
    form.set('metadata[billing_plan]', 'solo_monthly');
    form.set('metadata[supabase_user_id]', user.id);
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    const session = await readJsonSafely(stripeResponse);
    if (!stripeResponse.ok || !session?.url) return json({ error: 'Stripe could not create the Solo Pro checkout.' }, 502);
    return json({ url: session.url });
  }
  if (plan === 'team_monthly') {
    if (!env.STRIPE_SECRET_KEY?.trim() || !env.STRIPE_TEAM_MONTHLY_PRICE_ID?.trim()) return json({ error: 'Crew & Team monthly checkout is not configured.' }, 503);
    const totalSeats = Number(payload?.totalSeats ?? 3);
    if (!Number.isInteger(totalSeats) || totalSeats < 3 || totalSeats > 50) return json({ error: 'Choose between 3 and 50 total seats.' }, 400);
    const extraSeats = totalSeats - 3;
    const base = env.SUPABASE_URL.replace(/\/$/, '');
    const profileResponse = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_pro`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization }
    });
    if (!profileResponse.ok) return json({ error: 'Could not verify your current Pro status.' }, 502);
    const profiles = await readJsonSafely(profileResponse);
    if (profiles?.[0]?.is_pro) return json({ error: 'Your Pro subscription is already active.' }, 409);
    const priceId = env.STRIPE_TEAM_MONTHLY_PRICE_ID.trim();
    const priceResponse = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}` }
    });
    const price = await readJsonSafely(priceResponse);
    if (!priceResponse.ok || price?.currency !== 'usd' || price?.unit_amount !== 5900 || price?.recurring?.interval !== 'month' || price?.recurring?.interval_count !== 1) {
      return json({ error: 'Configured Crew & Team price must be USD $59/month.' }, 503);
    }
    if (extraSeats > 0 && env.STRIPE_TEAM_EXTRA_SEAT_PRICE_ID?.trim()) {
      const extraPriceResponse = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(env.STRIPE_TEAM_EXTRA_SEAT_PRICE_ID.trim())}`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}` }
      });
      const extraPrice = await readJsonSafely(extraPriceResponse);
      if (!extraPriceResponse.ok || extraPrice?.currency !== 'usd' || extraPrice?.unit_amount !== 1500 || extraPrice?.recurring?.interval !== 'month' || extraPrice?.recurring?.interval_count !== 1) {
        return json({ error: 'Configured extra-seat price must be USD $15/month.' }, 503);
      }
    }
    const appUrl = env.PUBLIC_APP_URL || new URL(request.url).origin;
    const form = new URLSearchParams({
      mode: 'subscription',
      success_url: `${appUrl}/?checkout=complete`,
      cancel_url: `${appUrl}/#what-you-get`,
      client_reference_id: user.id,
      customer_email: user.email
    });
    form.set('line_items[0][price]', priceId);
    form.set('line_items[0][quantity]', '1');
    if (extraSeats > 0) {
      if (env.STRIPE_TEAM_EXTRA_SEAT_PRICE_ID?.trim()) {
        form.set('line_items[1][price]', env.STRIPE_TEAM_EXTRA_SEAT_PRICE_ID.trim());
      } else {
        form.set('line_items[1][price_data][currency]', 'usd');
        form.set('line_items[1][price_data][unit_amount]', '1500');
        form.set('line_items[1][price_data][recurring][interval]', 'month');
        form.set('line_items[1][price_data][product_data][name]', 'Crew & Team additional seat');

      }
      form.set('line_items[1][quantity]', String(extraSeats));
    }
    form.set('metadata[billing_plan]', 'team_monthly');
    form.set('metadata[supabase_user_id]', user.id);
    form.set('metadata[included_seats]', '3');
    form.set('metadata[extra_seats]', String(extraSeats));
    form.set('metadata[total_seats]', String(totalSeats));
    form.set('subscription_data[metadata][billing_plan]', 'team_monthly');
    form.set('subscription_data[metadata][supabase_user_id]', user.id);
    form.set('subscription_data[metadata][included_seats]', '3');
    form.set('subscription_data[metadata][extra_seats]', String(extraSeats));
    form.set('subscription_data[metadata][total_seats]', String(totalSeats));
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    const session = await readJsonSafely(stripeResponse);
    if (!stripeResponse.ok || !session?.url) return json({ error: 'Stripe could not create the Crew & Team checkout.' }, 502);
    return json({ url: session.url });
  }
  if (plan === 'solo_annual') {
    const priceId = plan === 'solo_monthly' ? env.STRIPE_SOLO_MONTHLY_PRICE_ID : env.STRIPE_SOLO_ANNUAL_PRICE_ID;
    const expectedAmount = plan === 'solo_monthly' ? 2900 : 24900;
    const expectedInterval = plan === 'solo_monthly' ? 'month' : 'year';
    if (!env.STRIPE_SECRET_KEY?.trim() || !priceId?.trim()) {
      return json({ error: `${plan === 'solo_monthly' ? 'Solo Pro monthly' : 'Solo Pro annual'} checkout is not configured.` }, 503);
    }
    const base = env.SUPABASE_URL.replace(/\/$/, '');
    const profileResponse = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_pro`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization }
    });
    if (!profileResponse.ok) return json({ error: 'Could not verify your current Pro status.' }, 502);
    const profiles = await readJsonSafely(profileResponse);
    if (profiles?.[0]?.is_pro) return json({ error: 'Your Pro subscription is already active.' }, 409);
    const priceResponse = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId.trim())}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}` }
    });
    const price = await readJsonSafely(priceResponse);
    if (!priceResponse.ok || price?.currency !== 'usd' || price?.unit_amount !== expectedAmount || price?.recurring?.interval !== expectedInterval || price?.recurring?.interval_count !== 1) {
      return json({ error: `Configured ${plan === 'solo_monthly' ? 'monthly' : 'annual'} price has an unexpected amount or billing interval.` }, 503);
    }
    const appUrl = env.PUBLIC_APP_URL || new URL(request.url).origin;
    const form = new URLSearchParams({
      mode: 'subscription',
      success_url: `${appUrl}/?checkout=complete`,
      cancel_url: `${appUrl}/#what-you-get`,
      client_reference_id: user.id,
      customer_email: user.email
    });
    form.set('line_items[0][price]', priceId.trim());
    form.set('line_items[0][quantity]', '1');
    form.set('metadata[billing_plan]', plan);
    form.set('metadata[supabase_user_id]', user.id);
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    const session = await readJsonSafely(stripeResponse);
    if (!stripeResponse.ok || !session?.url) {
      console.error('Solo Pro Checkout Session creation failed', stripeResponse.status, session?.error?.type || 'unknown Stripe error', session?.error?.code || 'no_code');
      return json({ error: 'Stripe could not create the Solo Pro checkout.' }, 502);
    }
    return json({ url: session.url });
  }
  if (plan === 'solo_trial') {
    if (!env.STRIPE_SECRET_KEY?.trim() || !env.STRIPE_SOLO_MONTHLY_PRICE_ID?.trim() || !env.STRIPE_SOLO_TRIAL_FEE_PRICE_ID?.trim()) {
      return json({ error: 'Paid Pro trial checkout is not configured. Set the Stripe secret, USD $4.99 trial Price ID, and USD $29/month Solo Pro Price ID.' }, 503);
    }
    const base = env.SUPABASE_URL.replace(/\/$/, '');
    const profileResponse = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_pro`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: authorization }
    });
    if (!profileResponse.ok) return json({ error: 'Could not verify your current Pro status.' }, 502);
    const profiles = await readJsonSafely(profileResponse);
    if (profiles?.[0]?.is_pro) return json({ error: 'Your Pro subscription is already active.' }, 409);

    stage = 'checking the configured $4.99 trial and $29 monthly Stripe prices';
    for (const [priceId, expected] of [
      [env.STRIPE_SOLO_TRIAL_FEE_PRICE_ID.trim(), { amount: 499, recurring: false }],
      [env.STRIPE_SOLO_MONTHLY_PRICE_ID.trim(), { amount: 2900, recurring: true }]
    ]) {
      const priceResponse = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}` }
      });
      const price = await readJsonSafely(priceResponse);
      if (!priceResponse.ok || price?.currency !== 'usd' || price?.unit_amount !== expected.amount || Boolean(price?.recurring) !== expected.recurring || (expected.recurring && (price.recurring.interval !== 'month' || price.recurring.interval_count !== 1))) {
        console.error('Configured paid-trial Stripe price validation failed', priceResponse.status, expected.recurring ? 'monthly_price_mismatch' : 'trial_fee_price_mismatch');
        return json({ error: 'Configured Stripe prices must be USD $4.99 one-time and USD $29/month recurring.' }, 503);
      }
    }

    stage = 'creating your secure $4.99 Pro trial checkout';
    const form = new URLSearchParams();
    const appUrl = env.PUBLIC_APP_URL || new URL(request.url).origin;
    form.set('mode', 'payment');
    form.set('success_url', `${appUrl}/?trial=started`);
    form.set('cancel_url', `${appUrl}/#what-you-get`);
    form.set('client_reference_id', user.id);
    form.set('customer_email', user.email);
    form.set('customer_creation', 'always');
    form.set('payment_method_types[0]', 'card');
    form.set('line_items[0][price]', env.STRIPE_SOLO_TRIAL_FEE_PRICE_ID.trim());
    form.set('line_items[0][quantity]', '1');
    form.set('payment_intent_data[setup_future_usage]', 'off_session');
    form.set('metadata[billing_plan]', 'solo_paid_trial_14d');
    form.set('metadata[supabase_user_id]', user.id);
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form
    });
    const session = await readJsonSafely(stripeResponse);
    if (!stripeResponse.ok || !session?.url) {
      console.error('Paid Pro trial Checkout Session creation failed', stripeResponse.status, session?.error?.type || 'unknown Stripe error', session?.error?.code || 'no_code');
      return json({ error: 'Stripe could not create the paid Pro trial checkout. Verify the configured $4.99 trial fee and $29 monthly Price IDs.' }, 502);
    }
    return json({ url: session.url });
  }
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
