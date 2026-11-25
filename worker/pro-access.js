const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

export function supabaseBase(env) {
  return env.SUPABASE_URL.trim().replace(/\/$/, '');
}

export async function requireAuthenticatedUser(request, env) {
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_ANON_KEY?.trim()) return { error: json({ error: 'Account services are not configured.' }, 503) };
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return { error: json({ error: 'Sign in to continue.' }, 401) };
  const base = supabaseBase(env);
  const userResponse = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY.trim(), Authorization: authorization }
  });
  if (!userResponse.ok) return { error: json({ error: 'Sign in again to continue.' }, 401) };
  const user = await readJson(userResponse);
  if (!user?.id) return { error: json({ error: 'Could not validate your account.' }, 401) };
  return { user, authorization, base };
}

export async function loadProfileAccess(env, userId, authorization) {
  const base = supabaseBase(env);
  const headers = authorization
    ? { apikey: env.SUPABASE_ANON_KEY.trim(), Authorization: authorization }
    : { apikey: env.SUPABASE_SERVICE_ROLE_KEY.trim(), Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY.trim()}` };
  const response = await fetch(
    `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,is_pro,stripe_subscription_status,business_name,full_name,phone,company_logo_url,brand_color,company_address,referral_code,referral_credits_months,referred_by_code&limit=1`,
    { headers }
  );
  if (!response.ok) {
    const legacy = await fetch(
      `${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,is_pro,stripe_subscription_status,business_name,full_name,phone,company_logo_url,brand_color,company_address&limit=1`,
      { headers }
    );
    if (!legacy.ok) return { error: json({ error: 'Could not load your subscription status.' }, 502) };
    const [profile] = await legacy.json();
    return { profile: profile || null };
  }
  const [profile] = await response.json();
  return { profile: profile || null };
}

export function isProProfile(profile) {
  return Boolean(profile?.is_pro);
}

export function staffEmails(env) {
  return String(env.STAFF_EMAILS || env.OWNER_ANALYTICS_EMAILS || env.OWNER_ANALYTICS_EMAIL || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isStaffUser(user, env) {
  const email = String(user?.email || '').trim().toLowerCase();
  return Boolean(email) && staffEmails(env).includes(email);
}

export async function requireProUser(request, env) {
  const auth = await requireAuthenticatedUser(request, env);
  if (auth.error) return auth;
  const { profile, error } = await loadProfileAccess(env, auth.user.id, auth.authorization);
  if (error) return { error };
  const staff = isStaffUser(auth.user, env);
  if (!isProProfile(profile) && !staff) {
    return { error: json({ error: 'Elite Quote Flow Pro is required for this action. Upgrade from your dashboard to continue.' }, 402) };
  }
  return { ...auth, profile, staff, paidPro: isProProfile(profile) };
}

export async function onAccountAccess(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const auth = await requireAuthenticatedUser(request, env);
  if (auth.error) return auth.error;
  const loaded = await loadProfileAccess(env, auth.user.id, auth.authorization);
  if (loaded.error) return loaded.error;
  const pro = isProProfile(loaded.profile);
  const staff = isStaffUser(auth.user, env);
  return json({ pro, staff, access: pro ? 'pro' : staff ? 'staff' : 'free' });
}

export { json, readJson };
