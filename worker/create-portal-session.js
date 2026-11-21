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
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY'];
  const missing = required.filter(name => !env[name]?.trim?.());
  if (missing.length) {
    console.error('Billing portal configuration missing', missing.join(','));
    return json({ error: 'Subscription management is not configured on this deployment.' }, 503);
  }

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    console.warn('Billing portal rejected request: bearer token missing');
    return json({ error: 'Sign in to continue.' }, 401);
  }

  const base = env.SUPABASE_URL.trim().replace(/\/$/, '');
  const bearerToken = authorization.slice('Bearer '.length).trim();
  let browserKeyMatchesWorkerKey = null;
  try {
    if (env.ASSETS?.fetch) {
      const configResponse = await env.ASSETS.fetch(new Request('https://worker.local/supabase-config.js'));
      const configText = await configResponse.text();
      const browserKey = configText.match(/anonKey:\s*'([^']+)'/)?.[1];
      if (browserKey) browserKeyMatchesWorkerKey = browserKey === env.SUPABASE_ANON_KEY.trim();
    }
  } catch {}
  const tokenParts = bearerToken.split('.');
  console.log('Billing portal request preflight', JSON.stringify({
    supabase_host: new URL(base).host,
    browser_key_matches_worker_key: browserKeyMatchesWorkerKey,
    worker_anon_key_format: env.SUPABASE_ANON_KEY.trim().startsWith('sb_publishable_') ? 'publishable' : env.SUPABASE_ANON_KEY.trim().startsWith('eyJ') ? 'jwt' : 'other',
    bearer_length: bearerToken.length,
    bearer_starts_with_eyJ: bearerToken.startsWith('eyJ'),
    bearer_jwt_segments: tokenParts.length
  }));
  const userResponse = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY.trim(), Authorization: authorization }
  });
  if (!userResponse.ok) {
    const authError = await readJsonSafely(userResponse);
    const code = authError?.code || authError?.error_code || 'no_code';
    const message = String(authError?.message || authError?.msg || 'No response detail').slice(0, 240);
    const responseHeaders = ['content-type', 'server', 'sb-error-code', 'sb-project-ref', 'cf-ray', 'www-authenticate']
      .map(name => `${name}=${userResponse.headers.get(name) || 'none'}`)
      .join(', ');
    console.warn('Billing portal Supabase auth rejected session', userResponse.status, code, message, responseHeaders);
    return json({ error: `Supabase rejected the current sign-in session (HTTP ${userResponse.status}${code !== 'no_code' ? `, ${code}` : ''}). Sign out, sign back in, then retry.` }, 401);
  }
  const user = await readJsonSafely(userResponse);
  if (!user?.id) {
    console.error('Billing portal auth returned no user ID');
    return json({ error: 'Could not verify your Supabase account.' }, 401);
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const profileResponse = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_pro,stripe_subscription_status,stripe_customer_id`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  if (!profileResponse.ok) {
    const details = (await profileResponse.text()).slice(0, 300);
    const responseHeaders = ['content-type', 'server', 'sb-error-code', 'sb-project-ref', 'cf-ray']
      .map(name => `${name}=${profileResponse.headers.get(name) || 'none'}`)
      .join(', ');
    console.error('Billing portal profile lookup failed', profileResponse.status, details || 'empty response', responseHeaders);
    return json({ error: `Could not load subscription details from the account database (HTTP ${profileResponse.status}).` }, 502);
  }
  const profiles = await readJsonSafely(profileResponse);
  if (!profiles?.[0]?.is_pro) return json({ error: 'No active Pro plan is linked to this account.' }, 409);
  if (profiles[0].stripe_subscription_status === 'lifetime') return json({ error: 'Lifetime Pro access does not have a recurring subscription to manage.' }, 409);
  const customerId = profiles?.[0]?.stripe_customer_id;
  if (!customerId) {
    console.warn('Billing portal has no Stripe customer linked for authenticated user');
    return json({ error: 'No Stripe customer is linked to this account. Contact support to link an existing subscription.' }, 409);
  }

  const form = new URLSearchParams({ customer: customerId, return_url: new URL(request.url).origin });
  const portalConfiguration = env.STRIPE_BILLING_PORTAL_CONFIGURATION?.trim();
  if (portalConfiguration) form.set('configuration', portalConfiguration);
  const stripeResponse = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY.trim()}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form
  });
  const stripeContentType = stripeResponse.headers.get('content-type') || 'none';
  const stripeBodyText = await stripeResponse.text();
  let session = null;
  try { session = stripeBodyText ? JSON.parse(stripeBodyText) : null; } catch {}
  if (!stripeResponse.ok || !session?.url) {
    const stripeCode = session?.error?.code || 'no_code';
    const stripeType = session?.error?.type || 'unknown_type';
    const stripeMessage = String(session?.error?.message || stripeBodyText || `HTTP ${stripeResponse.status}`)
      .replace(/sk_(?:live|test|restricted)_[A-Za-z0-9]+/g, '[REDACTED_STRIPE_KEY]')
      .replace(/rk_(?:live|test)_[A-Za-z0-9]+/g, '[REDACTED_STRIPE_KEY]')
      .slice(0, 400);
    console.error('Stripe billing portal session failed', JSON.stringify({
      status: stripeResponse.status,
      type: stripeType,
      code: stripeCode,
      request_id: stripeResponse.headers.get('request-id'),
      server: stripeResponse.headers.get('server'),
      cf_ray: stripeResponse.headers.get('cf-ray'),
      content_type: stripeContentType,
      response_bytes: new TextEncoder().encode(stripeBodyText).length,
      secret_key_mode: /^sk_live_/.test(env.STRIPE_SECRET_KEY.trim()) ? 'live' : /^sk_test_/.test(env.STRIPE_SECRET_KEY.trim()) ? 'test' : 'other',
      portal_configuration: portalConfiguration || 'default',
      message: stripeMessage || 'empty response'
    }));
    return json({ error: `Stripe could not open subscription settings (HTTP ${stripeResponse.status}): ${stripeMessage || 'Stripe returned an empty response.'}` }, 502);
  }
  console.log('Billing portal session created successfully');
  return json({ url: session.url });
}
