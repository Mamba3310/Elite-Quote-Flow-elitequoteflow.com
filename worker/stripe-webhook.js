const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

import Stripe from 'stripe';
import { creditReferrerOnProActivation } from './referrals.js';

const supabaseBase = env => env.SUPABASE_URL.trim().replace(/\/$/, '');
const serviceRoleKey = env => env.SUPABASE_SERVICE_ROLE_KEY.trim();

export function lifetimeIntegrationCents(object) {
  const conversion = object?.currency_conversion;
  if (conversion && String(conversion.source_currency || '').toLowerCase() === 'usd' && Number.isInteger(conversion.amount_total)) {
    return conversion.amount_total;
  }
  if (String(object?.currency || '').toLowerCase() === 'usd' && Number.isInteger(object.amount_total)) return object.amount_total;
  return null;
}

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
    if (event.type === 'checkout.session.completed' && object.mode === 'payment' && object.payment_status === 'paid' && object.metadata?.billing_plan === 'solo_paid_trial_14d') {
      if (!Number.isInteger(object.amount_total) || object.amount_total !== 499 || String(object.currency || '').toLowerCase() !== 'usd' || !object.payment_method_types?.includes('card') || !object.payment_intent) {
        throw new Error('Paid trial checkout did not confirm exactly USD $4.99 and card payment.');
      }
      const userId = await resolveCheckoutUserId(env, object);
      const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
      const paymentIntentId = typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id;
      if (!customerId || !paymentIntentId || !env.STRIPE_SOLO_MONTHLY_PRICE_ID?.trim()) throw new Error('Paid trial checkout is missing a customer, payment, or configured monthly plan.');
      const stripe = new Stripe(env.STRIPE_SECRET_KEY || '[REDACTED]', { httpClient: Stripe.createFetchHttpClient() });
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const paymentMethodId = typeof paymentIntent.payment_method === 'string' ? paymentIntent.payment_method : paymentIntent.payment_method?.id;
      if (!paymentMethodId) throw new Error('The paid trial card could not be verified for subscription billing.');
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: env.STRIPE_SOLO_MONTHLY_PRICE_ID.trim() }],
        trial_period_days: 14,
        default_payment_method: paymentMethodId,
        metadata: { billing_plan: 'solo_paid_trial_14d', supabase_user_id: userId }
      }, { idempotencyKey: `solo-paid-trial-${object.id}` });
      if (!subscription?.id || !['trialing', 'active'].includes(subscription.status)) throw new Error('Stripe did not activate the paid trial subscription.');
      await setProStatus(env, userId, true, customerId, subscription.id, subscription.status);
    } else if (event.type === 'checkout.session.completed' && object.mode === 'subscription' && ['paid', 'no_payment_required'].includes(object.payment_status)) {
      const userId = await resolveCheckoutUserId(env, object);
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
      if (object.metadata?.billing_plan === 'team_monthly') {
        if (object.subscription_data?.metadata?.billing_plan && object.subscription_data.metadata.billing_plan !== 'team_monthly') throw new Error('Team subscription metadata mismatch.');
        const totalSeats = Number(object.metadata.total_seats);
        const includedSeats = Number(object.metadata.included_seats);
        const extraSeats = Number(object.metadata.extra_seats);
        if (!subscriptionId || includedSeats !== 3 || !Number.isInteger(totalSeats) || totalSeats < 3 || totalSeats > 50 || extraSeats !== totalSeats - includedSeats) {
          throw new Error('Team Checkout Session has invalid subscription or seat metadata.');
        }
        const base = supabaseBase(env);
        const key = serviceRoleKey(env);
        const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
        const teamResponse = await fetch(`${base}/rest/v1/business_teams?owner_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`, { headers });
        if (!teamResponse.ok) throw new Error('Team lookup failed while activating subscription. Apply supabase-growth-features.sql and supabase-team-seats.sql.');
        let [team] = await teamResponse.json();
        if (!team) {
          const created = await fetch(`${base}/rest/v1/business_teams`, {
            method: 'POST', headers,
            body: JSON.stringify({ owner_id: userId, name: 'My team', stripe_customer_id: object.customer || null,
              stripe_subscription_id: subscriptionId, subscription_status: 'active', seat_limit: totalSeats })
          });
          if (!created.ok) throw new Error('Could not provision the Team subscription.');
          [team] = await created.json();
        } else {
          const updated = await fetch(`${base}/rest/v1/business_teams?id=eq.${encodeURIComponent(team.id)}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ stripe_customer_id: object.customer || null, stripe_subscription_id: subscriptionId,
              subscription_status: 'active', seat_limit: totalSeats, updated_at: new Date().toISOString() })
          });
          if (!updated.ok) throw new Error('Could not update Team subscription entitlements.');
        }
        if (!team?.id) throw new Error('Team subscription provisioning returned no team.');
        if (object.metadata?.supabase_user_id !== userId) throw new Error('Team Checkout Session owner metadata mismatch.');
        const reconcile = await fetch(`${base}/rest/v1/rpc/reconcile_team_seats`, {
          method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_team_id: team.id })
        });
        if (!reconcile.ok) throw new Error('Could not reconcile Team seats during provisioning.');
        await setProStatus(env, userId, true, object.customer, subscriptionId, 'active');
      } else {
        await setProStatus(env, userId, true, object.customer, subscriptionId, 'active');
      }
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
      const usdCents = lifetimeIntegrationCents(object);
      if (usdCents === null) throw new Error('Lifetime Pro Checkout total is missing or uses an unsupported currency.');
      if (usdCents < 14999) {
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
        const teamsResponse = await fetch(`${base}/rest/v1/business_teams?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
        if (!teamsResponse.ok) throw new Error('Team subscription lookup failed after successful invoice.');
        for (const team of await teamsResponse.json()) {
          const update = await fetch(`${base}/rest/v1/business_teams?id=eq.${encodeURIComponent(team.id)}`, { method: 'PATCH', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ subscription_status: 'active', updated_at: new Date().toISOString() }) });
          if (!update.ok) throw new Error('Could not restore Team subscription after successful invoice.');
        }
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
        const teamsResponse = await fetch(`${base}/rest/v1/business_teams?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
        if (!teamsResponse.ok) throw new Error('Team subscription lookup failed while handling failed invoice.');
        for (const team of await teamsResponse.json()) {
          const update = await fetch(`${base}/rest/v1/business_teams?id=eq.${encodeURIComponent(team.id)}`, {
            method: 'PATCH', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ subscription_status: 'past_due', updated_at: new Date().toISOString() })
          });
          if (!update.ok) throw new Error('Could not update Team subscription after failed invoice.');
          const reconcile = await fetch(`${base}/rest/v1/rpc/reconcile_team_seats`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_team_id: team.id }) });
          if (!reconcile.ok) throw new Error('Could not revoke Team seats after failed invoice.');
        }
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
      const teamLookup = await fetch(`${base}/rest/v1/business_teams?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id,owner_id`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!teamLookup.ok) throw new Error('Team subscription lookup failed. Apply supabase-team-seats.sql.');
      for (const team of await teamLookup.json()) {
        const items = Array.isArray(object.items?.data) ? object.items.data : [];
        const metadataTotal = Number(object.metadata?.total_seats);
        const calculatedTotal = items.length > 1 ? 3 * (Number(items[0]?.quantity) || 1) + (Number(items[1]?.quantity) || 0) : 3;
        const seatLimit = Number.isInteger(metadataTotal) && metadataTotal >= 3 && metadataTotal <= 50 ? metadataTotal : calculatedTotal;
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : object.status || 'inactive';
        const update = await fetch(`${base}/rest/v1/business_teams?id=eq.${encodeURIComponent(team.id)}`, {
          method: 'PATCH', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ subscription_status: status, seat_limit: Math.max(3, Math.min(50, seatLimit)), updated_at: new Date().toISOString() })
        });
        if (!update.ok) throw new Error('Team subscription entitlement update failed.');
        const reconcile = await fetch(`${base}/rest/v1/rpc/reconcile_team_seats`, {
          method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_team_id: team.id })
        });
        if (!reconcile.ok) throw new Error('Could not reconcile member seats after subscription change.');
      }
    }
  } catch (error) {
    console.error('Stripe webhook processing failed', error.message);
    return json({ error: 'Could not process this billing event.' }, 500);
  }
  return json({ received: true });
}
