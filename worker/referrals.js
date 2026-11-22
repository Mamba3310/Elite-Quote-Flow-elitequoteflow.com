import { json, requireAuthenticatedUser, readJson, supabaseBase } from './pro-access.js';

function serviceHeaders(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
}

function makeReferralCode(userId) {
  const compact = String(userId || '').replace(/-/g, '').slice(0, 10).toUpperCase();
  return `EQF${compact || Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function onReferralsRequest(request, env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return json({ error: 'Referral program is not configured.' }, 503);
  if (request.method === 'GET') return getReferralStatus(request, env);
  if (request.method === 'POST') return applyReferralCode(request, env);
  return json({ error: 'Method not allowed.' }, 405);
}

async function getReferralStatus(request, env) {
  const access = await requireAuthenticatedUser(request, env);
  if (access.error) return access.error;
  const base = supabaseBase(env);
  const profileResponse = await fetch(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(access.user.id)}&select=id,referral_code,referral_credits_months,referral_reward_status,referred_by_code,is_pro&limit=1`,
    { headers: serviceHeaders(env) }
  );
  if (!profileResponse.ok) {
    return json({ error: 'Apply the referral migration (supabase-pro-value.sql) to enable referral codes.' }, 503);
  }
  let [profile] = await profileResponse.json();
  if (!profile) return json({ error: 'Profile not found.' }, 404);
  if (!profile.referral_code) {
    const code = makeReferralCode(access.user.id);
    const update = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(access.user.id)}`, {
      method: 'PATCH',
      headers: serviceHeaders(env),
      body: JSON.stringify({ referral_code: code })
    });
    if (update.ok) {
      const [updated] = await update.json();
      profile = updated || { ...profile, referral_code: code };
    } else {
      profile.referral_code = code;
    }
  }
  const appUrl = (env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  return json({
    referralCode: profile.referral_code,
    referralLink: `${appUrl}/?ref=${encodeURIComponent(profile.referral_code)}`,
    creditsMonths: Number(profile.referral_credits_months || 0),
    rewardStatus: profile.referral_reward_status || 'none',
    referredByCode: profile.referred_by_code || '',
    isPro: Boolean(profile.is_pro)
  });
}

async function applyReferralCode(request, env) {
  const access = await requireAuthenticatedUser(request, env);
  if (access.error) return access.error;
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const code = String(payload?.code || '').trim().toUpperCase();
  if (!/^EQF[A-Z0-9]{4,16}$/.test(code)) return json({ error: 'Enter a valid referral code.' }, 400);
  const base = supabaseBase(env);
  const self = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(access.user.id)}&select=id,referral_code,referred_by_code&limit=1`, {
    headers: serviceHeaders(env)
  });
  if (!self.ok) return json({ error: 'Could not load your profile for referrals.' }, 502);
  const [profile] = await self.json();
  if (!profile) return json({ error: 'Profile not found.' }, 404);
  if (profile.referred_by_code) return json({ error: 'A referral code is already linked to this account.' }, 409);
  if (String(profile.referral_code || '').toUpperCase() === code) return json({ error: 'You cannot use your own referral code.' }, 400);

  const referrer = await fetch(`${base}/rest/v1/profiles?referral_code=eq.${encodeURIComponent(code)}&select=id,referral_code&limit=1`, {
    headers: serviceHeaders(env)
  });
  if (!referrer.ok) return json({ error: 'Could not verify that referral code.' }, 502);
  const [owner] = await referrer.json();
  if (!owner) return json({ error: 'Referral code not found.' }, 404);

  const update = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(access.user.id)}&referred_by_code=is.null`, {
    method: 'PATCH',
    headers: serviceHeaders(env),
    body: JSON.stringify({ referred_by_code: code, referral_reward_status: 'pending' })
  });
  if (!update.ok) return json({ error: 'Could not apply the referral code.' }, 502);
  const rows = await update.json();
  if (!rows.length) return json({ error: 'Referral code could not be applied.' }, 409);
  return json({ applied: true, referredByCode: code });
}

/** Credit the referrer when a referred user becomes Pro. */
export async function creditReferrerOnProActivation(env, userId) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim() || !userId) return;
  const base = supabaseBase(env);
  const profileResponse = await fetch(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,referred_by_code,referral_reward_status&limit=1`,
    { headers: serviceHeaders(env) }
  );
  if (!profileResponse.ok) return;
  const [profile] = await profileResponse.json();
  if (!profile?.referred_by_code || profile.referral_reward_status === 'credited') return;

  const referrerResponse = await fetch(
    `${base}/rest/v1/profiles?referral_code=eq.${encodeURIComponent(profile.referred_by_code)}&select=id,referral_credits_months&limit=1`,
    { headers: serviceHeaders(env) }
  );
  if (!referrerResponse.ok) return;
  const [referrer] = await referrerResponse.json();
  if (!referrer) return;

  await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(referrer.id)}`, {
    method: 'PATCH',
    headers: serviceHeaders(env),
    body: JSON.stringify({
      referral_credits_months: Number(referrer.referral_credits_months || 0) + 1,
      referral_reward_status: 'credited'
    })
  });
  await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: serviceHeaders(env),
    body: JSON.stringify({ referral_reward_status: 'credited' })
  });
}
