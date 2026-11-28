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

export async function loadOwnedTeamEntitlement(env, userId) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return null;
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  let response;
  try {
    response = await fetch(`${supabaseBase(env)}/rest/v1/business_teams?owner_id=eq.${encodeURIComponent(userId)}&select=id,seat_limit,subscription_status&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
  } catch { return null; }
  if (!response.ok) return null;
  const [team] = await readJson(response) || [];
  return team && ['active', 'trialing'].includes(team.subscription_status) ? team : null;
}

export async function loadTeamEntitlement(env, userId) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return null;
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  let response;
  try {
    response = await fetch(`${supabaseBase(env)}/rest/v1/rpc/get_team_entitlement`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId })
    });
  } catch { return null; }
  if (!response.ok) return null;
  const entitlement = await readJson(response);
  return entitlement?.team_id && ['admin', 'member', 'read_only'].includes(entitlement.role) ? entitlement : null;
}

export async function requireProUser(request, env) {
  const auth = await requireAuthenticatedUser(request, env);
  if (auth.error) return auth;
  const { profile, error } = await loadProfileAccess(env, auth.user.id, auth.authorization);
  if (error) return { error };
  const staff = isStaffUser(auth.user, env);
  const teamMember = isProProfile(profile) || staff ? null : await loadTeamEntitlement(env, auth.user.id);
  const ownedTeam = isProProfile(profile) || staff ? null : await loadOwnedTeamEntitlement(env, auth.user.id);
  const team = teamMember || (ownedTeam ? { ...ownedTeam, role: 'owner' } : null);
  if (!isProProfile(profile) && !team && !staff) {
    return { error: json({ error: 'An active Elite Quote Flow Pro or Crew & Team entitlement is required for this action.' }, 402) };
  }
  if (team?.role === 'read_only') return { error: json({ error: 'This team seat is read-only. Ask your team owner to change your role.' }, 403) };
  return { ...auth, profile, team, teamRole: team?.role || (isProProfile(profile) ? 'owner' : null), staff, paidPro: isProProfile(profile) || Boolean(team) };
}

export async function onAccountAccess(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const auth = await requireAuthenticatedUser(request, env);
  if (auth.error) return auth.error;
  const loaded = await loadProfileAccess(env, auth.user.id, auth.authorization);
  if (loaded.error) return loaded.error;
  const pro = isProProfile(loaded.profile);
  const staff = isStaffUser(auth.user, env);
  const [team, ownedTeam] = await Promise.all([
    pro || staff ? null : loadTeamEntitlement(env, auth.user.id),
    loadOwnedTeamEntitlement(env, auth.user.id)
  ]);
  return json({ pro: pro || Boolean(team) || Boolean(ownedTeam), staff, access: pro ? 'pro' : team ? 'team' : ownedTeam ? 'team' : staff ? 'staff' : 'free',
    ...(team ? { team: { role: team.role, seatLimit: team.seat_limit } } : {}),
    ...(ownedTeam ? { teamOwner: { seatLimit: ownedTeam.seat_limit } } : {}) });
}

export { json, readJson };
