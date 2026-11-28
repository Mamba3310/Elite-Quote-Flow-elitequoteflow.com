import { json } from './pro-access.js';

const ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/;

export function payoutDestinationFields(accountId) {
  return {
    'payment_intent_data[on_behalf_of]': accountId,
    'payment_intent_data[transfer_data][destination]': accountId
  };
}

export async function requirePayoutAccount(access, env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return { error: json({ error: 'Payout accounts are not configured.' }, 503) };
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const response = await fetch(`${access.base}/rest/v1/profiles?id=eq.${encodeURIComponent(access.user.id)}&select=stripe_connect_account_id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!response.ok) {
    const detail = await response.text();
    if (/stripe_connect_account_id/i.test(detail)) return { error: json({ error: 'Payout accounts are not ready in the database yet.' }, 503) };
    return { error: json({ error: 'Could not load the payout account.' }, 502) };
  }
  const [row] = await response.json();
  const id = String(row?.stripe_connect_account_id || '').trim();
  if (!ACCOUNT_ID.test(id)) {
    return { error: json({ error: 'Set up payouts before collecting a customer payment. The money goes to your Stripe account, not Elite Quote Flow.' }, 409) };
  }
  return { id };
}
