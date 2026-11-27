const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' }
});

function tokenAal(authorization) {
  try {
    const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
    if (!payload) return '';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))).aal || '';
  } catch { return ''; }
}

function ownerEmails(env) {
  return String(env.OWNER_ANALYTICS_EMAILS || env.OWNER_ANALYTICS_EMAIL || '')
    .split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
}

function cleanHost(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Direct / unknown';
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.slice(0, 120) || 'Direct / unknown';
  } catch {
    return 'Direct / unknown';
  }
}

function cleanPath(value) {
  if (typeof value !== 'string' || !/^\/[a-zA-Z0-9/_:-]{0,100}$/.test(value)) return '/';
  return value.replace(/^\/q\/[^/]+(?:\/booking)?$/, '/q/:quote');
}

async function isConfiguredOwnerVisit(request, env) {
  const emails = ownerEmails(env);
  const supabaseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = String(env.SUPABASE_ANON_KEY || '').trim();
  const authorization = request.headers.get('Authorization') || '';
  if (!emails.length || !supabaseUrl || !anonKey || !/^Bearer\s+\S+$/i.test(authorization)) return false;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: authorization } });
    if (!response.ok) return false;
    const user = await response.json();
    return typeof user.email === 'string' && emails.includes(user.email.trim().toLowerCase());
  } catch {
    return false;
  }
}

async function authenticateOwner(request, env) {
  const emails = ownerEmails(env);
  const supabaseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = String(env.SUPABASE_ANON_KEY || '').trim();
  const authorization = request.headers.get('Authorization') || '';
  if (!emails.length || !supabaseUrl || !anonKey || !/^Bearer\s+\S+$/i.test(authorization) || tokenAal(authorization) !== 'aal2') return false;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization }
  });
  if (!response.ok) return false;
  const user = await response.json();
  return typeof user.email === 'string' && emails.includes(user.email.trim().toLowerCase());
}

export function normalizeIp(value) {
  const ip = String(value || '').trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(part => Number(part) <= 255)) return ip;
  if (ip.length <= 64 && ip.includes(':') && /^[0-9a-f:]+$/i.test(ip)) return ip.toLowerCase();
  return '';
}

export function recordAnalytics(env, { path = '/', referrer = '', country = 'Unknown', event = 'pageview', decision = '', ip = '' } = {}) {
  if (!env.SITE_ANALYTICS || typeof env.SITE_ANALYTICS.writeDataPoint !== 'function') return false;
  const safeCountry = /^[A-Z]{2}$/.test(String(country).toUpperCase()) ? String(country).toUpperCase() : 'Unknown';
  const allowedEvents = ['pageview', 'quote_view', 'quote_decision', 'engaged_20s', 'signup_click', 'signup_submit', 'signin_submit', 'trade_directory_click'];
  const safeEvent = allowedEvents.includes(event) ? event : 'pageview';
  const safeDecision = ['accepted', 'declined'].includes(decision) ? decision : '';
  env.SITE_ANALYTICS.writeDataPoint({
    blobs: [cleanPath(path), cleanHost(referrer), safeCountry, safeEvent, safeDecision, normalizeIp(ip)],
    doubles: [1],
    indexes: []
  });
  return true;
}

export async function onAnalyticsRequest(request, env) {
  if (request.method === 'POST') {
    if (!env.SITE_ANALYTICS || typeof env.SITE_ANALYTICS.writeDataPoint !== 'function') return json({ error: 'Analytics storage is not configured.' }, 503);
    let input;
    try { input = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
    const funnelEvents = ['pageview', 'engaged_20s', 'signup_click', 'signup_submit', 'signin_submit', 'trade_directory_click'];
    if (!input || !funnelEvents.includes(input.event)) return json({ error: 'Invalid event.' }, 400);
    const path = cleanPath(input.path);
    const isOwnerVisit = path.startsWith('/api/') || await isConfiguredOwnerVisit(request, env);
    if (!isOwnerVisit) recordAnalytics(env, { path, referrer: input.referrer, country: request.cf?.country, event: input.event, decision: typeof input.action === 'string' ? input.action.slice(0, 40) : '', ip: request.headers.get('CF-Connecting-IP') });
    return json({ received: true }, 202);
  }

  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const includeIps = new URL(request.url).searchParams.get('detail') === 'ips';
  let ownerAuthorized = false;
  try { ownerAuthorized = await authenticateOwner(request, env); } catch { ownerAuthorized = false; }
  if (!ownerAuthorized) return json({ error: 'Not authorized.' }, 403);
  if (!env.SITE_ANALYTICS || typeof env.SITE_ANALYTICS.query !== 'function') return json({ error: 'Analytics storage is not configured.' }, 503);
  try {
    const window = "timestamp > NOW() - INTERVAL '24' HOUR";
    const ipQuery = includeIps
      ? env.SITE_ANALYTICS.query(`SELECT blob6 AS ip, blob3 AS country, blob1 AS path, blob4 AS event, SUM(double1) AS visits FROM site_analytics WHERE timestamp > NOW() - INTERVAL '24' HOUR AND blob6 != '' GROUP BY blob6, blob3, blob1, blob4 ORDER BY visits DESC LIMIT 40`)
      : Promise.resolve({ data: [] });
    const [totals, sources, countries, quoteViews, decisions, decisionsByCountry, hourly, pages, recent, visitors, funnel] = await Promise.all([
      env.SITE_ANALYTICS.query(`SELECT SUM(double1) AS visits FROM site_analytics WHERE ${window} AND (blob4 = 'pageview' OR blob4 = '')`),
      env.SITE_ANALYTICS.query(`SELECT blob2 AS source, SUM(double1) AS visits FROM site_analytics WHERE ${window} AND (blob4 = 'pageview' OR blob4 = '') GROUP BY blob2 ORDER BY visits DESC LIMIT 12`),
      env.SITE_ANALYTICS.query(`SELECT blob3 AS country, SUM(double1) AS visits FROM site_analytics WHERE timestamp > NOW() - INTERVAL '30' DAY AND (blob4 = 'pageview' OR blob4 = '') GROUP BY blob3 ORDER BY visits DESC LIMIT 32`),
      env.SITE_ANALYTICS.query(`SELECT SUM(double1) AS views FROM site_analytics WHERE ${window} AND blob4 = 'quote_view'`),
      env.SITE_ANALYTICS.query(`SELECT blob5 AS decision, SUM(double1) AS decisions FROM site_analytics WHERE ${window} AND blob4 = 'quote_decision' GROUP BY blob5`),
      env.SITE_ANALYTICS.query(`SELECT blob3 AS country, blob5 AS decision, SUM(double1) AS decisions FROM site_analytics WHERE timestamp > NOW() - INTERVAL '30' DAY AND blob4 = 'quote_decision' GROUP BY blob3, blob5 ORDER BY decisions DESC LIMIT 64`),
      env.SITE_ANALYTICS.query(`SELECT toStartOfHour(timestamp) AS hour, SUM(double1) AS visits FROM site_analytics WHERE ${window} AND (blob4 = 'pageview' OR blob4 = '') GROUP BY hour ORDER BY hour`),
      env.SITE_ANALYTICS.query(`SELECT blob1 AS path, SUM(double1) AS visits FROM site_analytics WHERE ${window} AND (blob4 = 'pageview' OR blob4 = '') GROUP BY blob1 ORDER BY visits DESC LIMIT 12`),
      env.SITE_ANALYTICS.query(`SELECT SUM(double1) AS visits FROM site_analytics WHERE timestamp > NOW() - INTERVAL '5' MINUTE AND (blob4 = 'pageview' OR blob4 = '')`),
      ipQuery,
      env.SITE_ANALYTICS.query(`SELECT blob4 AS stage, blob1 AS path, blob5 AS action, SUM(double1) AS count FROM site_analytics WHERE ${window} AND blob4 IN ('engaged_20s','signup_click','signup_submit','signin_submit','trade_directory_click') GROUP BY blob4, blob1, blob5 ORDER BY count DESC LIMIT 60`)
    ]);
    const count = value => Math.max(0, Number(value) || 0);
    const decisionCounts = { accepted: 0, declined: 0 };
    for (const row of decisions?.data || []) {
      if (row.decision === 'accepted' || row.decision === 'declined') decisionCounts[row.decision] = count(row.decisions);
    }
    return json({
      visits24h: count(totals?.data?.[0]?.visits),
      visits5m: count(recent?.data?.[0]?.visits),
      hourly: (hourly?.data || []).map(row => ({ hour: String(row.hour || ''), visits: count(row.visits) })),
      pages: (pages?.data || []).map(row => ({ path: String(row.path || '/'), visits: count(row.visits) })),
      quoteViews24h: count(quoteViews?.data?.[0]?.views),
      decisions24h: decisionCounts,
      decisionsByCountry: (decisionsByCountry?.data || []).filter(row => ['accepted', 'declined'].includes(row.decision)).map(row => ({ country: String(row.country || 'Unknown'), decision: row.decision, count: count(row.decisions) })),
      sources: (sources?.data || []).map(row => ({ name: String(row.source || 'Direct / unknown'), visits: count(row.visits) })),
      countries: (countries?.data || []).map(row => ({ name: String(row.country || 'Unknown'), visits: count(row.visits) })),
      funnel: (funnel?.data || []).map(row => ({ stage: String(row.stage || ''), path: String(row.path || '/'), action: String(row.action || ''), count: count(row.count) })), 
      ...(includeIps ? { visitors: (visitors?.data || []).map(row => ({ ip: normalizeIp(row.ip), country: String(row.country || 'Unknown'), path: String(row.path || '/'), event: String(row.event || 'pageview'), visits: count(row.visits) })).filter(row => row.ip) } : {})
    });
  } catch (error) {
    console.error('Owner analytics query failed:', error?.message || error);
    return json({ error: 'Could not load analytics.' }, 502);
  }
}
