import { isStaffUser, requireAuthenticatedUser, supabaseBase } from './pro-access.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const MAX_FREE_ACCOUNTS = 2;

export async function hashNetwork(ip, env) {
  const salt = String(env.SIGNUP_IP_SALT || 'elite-quote-flow-network');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
}

async function serviceFetch(env, path, options = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!env.SUPABASE_URL?.trim() || !key) return null;
  return fetch(`${supabaseBase(env)}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(options.headers || {})
    }
  });
}

async function freeAccounts(env, hash) {
  const response = await serviceFetch(env, `/rest/v1/profiles?signup_ip_hash=eq.${encodeURIComponent(hash)}&is_pro=eq.false&select=id`);
  if (!response) return null;
  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows : null;
}

async function profileIsPro(env, userId) {
  const response = await serviceFetch(env, `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_pro&limit=1`);
  if (!response?.ok) return false;
  const [profile] = await response.json();
  return Boolean(profile?.is_pro);
}

async function saveHash(env, userId, hash) {
  const response = await serviceFetch(env, `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ signup_ip_hash: hash })
  });
  return Boolean(response?.ok);
}

export async function onAccountSlot(request, env) {
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const ip = clientIp(request);
  if (!ip) return json({ allowed: true });
  const hash = await hashNetwork(ip, env);
  const rows = await freeAccounts(env, hash);
  if (!rows) return json({ allowed: true, ready: false });
  if (request.method === 'GET') return json({ allowed: rows.length < MAX_FREE_ACCOUNTS });
  const auth = await requireAuthenticatedUser(request, env);
  if (auth.error) return auth.error;
  if (isStaffUser(auth.user, env) || await profileIsPro(env, auth.user.id)) return json({ allowed: true });
  if (rows.some(row => row.id === auth.user.id)) return json({ allowed: true });
  if (rows.length >= MAX_FREE_ACCOUNTS) {
    return json({ allowed: false, error: 'This network already has two free accounts. Sign in to an existing account.' }, 403);
  }
  await saveHash(env, auth.user.id, hash);
  return json({ allowed: true });
}
