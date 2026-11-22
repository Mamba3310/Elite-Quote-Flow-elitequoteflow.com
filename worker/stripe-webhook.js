const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

import Stripe from 'stripe';
import { creditReferrerOnProActivation } from './referrals.js';

const supabaseBase = env => env.SUPABASE_URL.trim().replace(/\/$/, '');
const serviceRoleKey = env => env.SUPABASE_SERVICE_ROLE_KEY.trim();

async function profileExists(env, userId) {
  const base = supabaseBase(env);
  const key = serviceRoleKey(env);
  const response = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase profile lookup failed (${response.status}): ${details.slice(0, 300) || 'empty response'}`);
  }
  const profiles = await response.json();
  return Array.isArray(profiles) && profiles.some(profile => profile.id === userId);
}

async function resolveCheckoutUserId(env, object) {
  const checkoutUserId = object.metadata?.supabase_user_id || object.client_reference_id;
  if (checkoutUserId && await profileExists(env, checkoutUserId)) return checkoutUserId;

  const email = String(object.customer_details?.email || object.customer_email || '').trim().toLowerCase();
  if (!email) throw new Error('No profile exists for the Checkout account ID, and Checkout has no email for safe account matching.');

  const base = supabaseBase(env);
  const key = serviceRoleKey(env);
  const response = await fetch(`${base}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase confirmed-account lookup failed (${response.status}): ${details.slice(0, 300) || 'empty response'}`);
  }
  const result = await response.json();
  const users = Array.isArray(result) ? result : result?.users;
  const matches = (Array.isArray(users) ? users : []).filter(user =>
    String(user.email || '').trim().toLowerCase() === email && Boolean(user.email_confirmed_at)
  );
  if (matches.length !== 1) {
    throw new Error(`Checkout email matched ${matches.length} confirmed accounts; refusing to guess account ownership.`);
  }
  const matchedUserId = matches[0].id;
  if (!await profileExists(env, matchedUserId)) {
    throw new Error('The confirmed Supabase account matched by Checkout email has no profile row.');
  }
  console.log('Stripe Checkout account matched to confirmed Supabase user by exact email.');
  return matchedUserId;
}

async function setProStatus(env, userId, isPro, customerId, subscriptionId, status) {
  const base = supabaseBase(env);
  const key = serviceRoleKey(env);
  const response = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      is_pro: isPro,
      stripe_customer_id: customerId || null,
      stripe_subscription_id: subscriptionId || null,
      stripe_subscription_status: status || null,
      updated_at: new Date().toISOString()
    })
  });
  if (response.ok && isPro) {
    try { await creditReferrerOnProActivation(env, userId); }
    catch (error) { console.error('Referral credit failed after Pro activation', error?.message || String(error)); }
  }
  if (!response.ok) {
    const errorText = await response.text();
    let errorBody;
    try { errorBody = JSON.parse(errorText); } catch { errorBody = null; }
    const message = String(errorBody?.message || errorBody?.error || errorText || 'Empty response body')
      .replace(/sk_(?:live|test|restricted)_[A-Za-z0-9]+/g, '[REDACTED_STRIPE_KEY]')
      .replace(/rk_(?:live|test)_[A-Za-z0-9]+/g, '[REDACTED_STRIPE_KEY]')
      .slice(0, 400);
    const responseHeaders = ['content-type', 'server', 'cf-ray', 'x-request-id', 'x-supabase-api-version']
      .map(name => `${name}=${response.headers.get(name) || 'none'}`)
      .join(', ');
    throw new Error(`Supabase profile update failed (${response.status}, ${errorBody?.code || 'no_code'}): ${message}; ${responseHeaders}`);
  }
}

async function retrieveVerifiedStripeEvent(eventId, env) {
  if (!env.STRIPE_SECRET_KEY || !eventId) return null;
  const response = await fetch(`https://api.stripe.com/v1/events/${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
  });
  if (!response.ok) {
    const errorText = await response.text();
    const safeErrorText = errorText
      .replace(/sk_(?:live|test|restricted)_[A-Za-z0-9]+/g, '[REDACTED_STRIPE_KEY]')
      .replace(/rk_(?:live|test)_[A-Za-z0-9]+/g, '[REDACTED_STRIPE_KEY]')
      .slice(0, 500);
    let errorBody;
    try { errorBody = JSON.parse(errorText); } catch { errorBody = null; }
    console.error(
      'Stripe event API verification failed',
      response.status,
      errorBody?.error?.type || 'non_json_or_unknown_error',
      errorBody?.error?.code || 'no_code',
      errorBody?.error?.message || safeErrorText || 'Empty response body.'
    );
    return null;
  }
  const event = await response.json();
  return event?.id === eventId ? event : null;
}

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return json({ error: 'Webhook is not configured.' }, 503);
  }
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('Stripe-Signature');
  const stripe = new Stripe(env.STRIPE_SECRET_KEY || '[REDACTED]', {
    httpClient: Stripe.createFetchHttpClient()
  });
  let event;
  let signatureResult = 'invalid_configured_secret';
  if (env.STRIPE_WEBHOOK_SECRET) {
    try {
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        signatureHeader,
        env.STRIPE_WEBHOOK_SECRET.trim(),
        undefined,
        Stripe.createSubtleCryptoProvider()
      );
      signatureResult = 'valid';
    } catch (error) {
      signatureResult = signatureHeader ? 'signature_verification_failed' : 'missing_header';
      console.error('Stripe signature verification failed', signatureResult, error?.message || String(error));
    }
  }
  if (signatureResult !== 'valid') {
    // Fallback: independently retrieve the event from Stripe using the live secret key.
    // Parse only when fallback verification needs the posted event ID.
    let postedEvent;
    try { postedEvent = JSON.parse(rawBody); } catch { return json({ error: 'Invalid event payload.' }, 400); }
    let verifiedEvent = null;
    try { verifiedEvent = await retrieveVerifiedStripeEvent(postedEvent.id, env); }
    catch (error) { console.error('Stripe event API verification request failed', error?.message || String(error)); }
    if (!verifiedEvent || verifiedEvent.livemode !== postedEvent.livemode) {
      console.error('Stripe webhook rejected', signatureResult, verifiedEvent ? 'livemode_mismatch' : 'event_api_verification_failed');
      return json({ error: 'Webhook could not verify the signature or independently confirm this event with Stripe. Ensure STRIPE_SECRET_KEY is the live key for this Stripe account.' }, 400);
    }
    event = verifiedEvent;
    console.log('Stripe webhook event verified through Stripe API', event.id);
  }

  const object = event.data?.object;
  if (!object) return json({ received: true });

  try {
    if (event.type === 'checkout.session.completed' && object.mode === 'subscription' && ['paid', 'no_payment_required'].includes(object.payment_status)) {
      const userId = await resolveCheckoutUserId(env, object);
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
      await setProStatus(env, userId, true, object.customer, subscriptionId, 'active');
    } else if (event.type === 'checkout.session.completed' && object.mode === 'payment' && object.payment_status === 'paid' && object.metadata?.quote_id && object.metadata?.payment_type === 'invoice_balance') {
      const quoteId = object.metadata.quote_id;
      const base = supabaseBase(env);
      const key = serviceRoleKey(env);
      const sessionId = typeof object.id === 'string' ? object.id : '';
      const payment = await fetch(`${base}/rest/v1/quotes?id=eq.${encodeURIComponent(quoteId)}&select=id,user_id,invoice_paid_at,stripe_invoice_checkout_session_id,invoice_status`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      });
      if (!payment.ok) throw new Error('Invoice quote lookup failed.');
      const quotes = await payment.json();
      const quote = quotes.find(row => row.user_id === object.metadata.supabase_user_id);
      if (!quote || !sessionId) throw new Error('Invoice quote owner or Checkout Session could not be verified.');
      if (quote.invoice_paid_at || (quote.stripe_invoice_checkout_session_id && quote.stripe_invoice_checkout_session_id !== sessionId)) {
        console.log('Ignoring already processed or superseded invoice Checkout Session', sessionId);
      } else {
        const update = await fetch(`${base}/rest/v1/quotes?id=eq.${encodeURIComponent(quoteId)}&user_id=eq.${encodeURIComponent(quote.user_id)}`, {
          method: 'PATCH', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({
            invoice_paid_at: new Date().toISOString(),
            invoice_status: 'paid',
            stripe_invoice_checkout_session_id: sessionId,
            updated_at: new Date().toISOString()
          })
        });
        if (!update.ok) throw new Error('Invoice payment update failed.');
      }
    } else if (event.type === 'checkout.session.completed' && object.mode === 'payment' && object.payment_status === 'paid' && object.metadata?.quote_id) {
      const quoteId = object.metadata.quote_id;
      const base = supabaseBase(env);
      const key = serviceRoleKey(env);
      const sessionId = typeof object.id === 'string' ? object.id : '';
      const payment = await fetch(`${base}/rest/v1/quotes?id=eq.${encodeURIComponent(quoteId)}&select=id,user_id,deposit_paid_at,stripe_checkout_session_id`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      });
      if (!payment.ok) throw new Error('Deposit quote lookup failed.');
      const quotes = await payment.json();
      const quote = quotes.find(row => row.user_id === object.metadata.supabase_user_id);
      if (!quote || !sessionId) throw new Error('Deposit quote owner or Checkout Session could not be verified.');
      if (quote.deposit_paid_at || quote.stripe_checkout_session_id !== sessionId) {
        console.log('Ignoring already processed or superseded deposit Checkout Session', sessionId);
      } else {
        const update = await fetch(`${base}/rest/v1/quotes?id=eq.${encodeURIComponent(quoteId)}&user_id=eq.${encodeURIComponent(quote.user_id)}&stripe_checkout_session_id=eq.${encodeURIComponent(sessionId)}&deposit_paid_at=is.null`, {
          method: 'PATCH', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ deposit_paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        });
        if (!update.ok) throw new Error('Deposit payment update failed.');
      }
    } else if (event.type === 'checkout.session.completed' && object.mode === 'payment' && object.payment_status === 'paid' && object.client_reference_id) {
      if (!env.STRIPE_PRO_LIFETIME_PAYMENT_LINK_ID?.trim() || object.payment_link !== env.STRIPE_PRO_LIFETIME_PAYMENT_LINK_ID.trim()) {
        throw new Error('Paid Checkout did not come from the configured Lifetime Pro Payment Link.');
      }
      if (object.currency !== 'usd' || !Number.isInteger(object.amount_total)) throw new Error('Lifetime Pro Checkout total is missing or uses an unsupported currency.');
      if (object.amount_total < 14999) {
        console.log('Lifetime Pro payment below the USD 149.99 minimum; access not activated.', object.id);
        return json({ received: true });
      }
      const userId = object.client_reference_id;
      if (!await profileExists(env, userId)) throw new Error('Lifetime Pro checkout did not reference an existing account profile.');
      await setProStatus(env, userId, true, object.customer, null, 'lifetime');
    } else if (event.type === 'invoice.payment_succeeded') {
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
      if (subscriptionId) {
        const base = supabaseBase(env);
        const key = serviceRoleKey(env);
        const lookup = await fetch(`${base}/rest/v1/profiles?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` }
        });
        if (!lookup.ok) throw new Error('Subscription lookup failed.');
        const profiles = await lookup.json();
        for (const profile of profiles) await setProStatus(env, profile.id, true, object.customer, subscriptionId, 'active');
      }
    } else if (event.type === 'invoice.payment_failed') {
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
      if (subscriptionId) {
        const base = supabaseBase(env);
        const key = serviceRoleKey(env);
        const lookup = await fetch(`${base}/rest/v1/profiles?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` }
        });
        if (!lookup.ok) throw new Error('Subscription lookup failed.');
        const profiles = await lookup.json();
        for (const profile of profiles) await setProStatus(env, profile.id, false, object.customer, subscriptionId, 'past_due');
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.paused') {
      const subscriptionId = object.id;
      const base = supabaseBase(env);
      const key = serviceRoleKey(env);
      const lookup = await fetch(`${base}/rest/v1/profiles?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      });
      if (!lookup.ok) throw new Error('Subscription lookup failed.');
      const profiles = await lookup.json();
      const active = event.type === 'customer.subscription.updated' && ['active', 'trialing'].includes(object.status);
      for (const profile of profiles) await setProStatus(env, profile.id, active, object.customer, subscriptionId, object.status || 'inactive');
    }
  } catch (error) {
    console.error('Stripe webhook processing failed', error.message);
    return json({ error: 'Could not process this billing event.' }, 500);
  }
  return json({ received: true });
}
