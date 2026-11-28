import { json, requireProUser, requireAuthenticatedUser, readJson, supabaseBase } from './pro-access.js';

function serviceHeaders(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
}

export async function onTeamsRequest(request, env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return json({ error: 'Team management is not configured.' }, 503);
  const url = new URL(request.url);
  if (request.method === 'GET') return listTeams(request, env);
  if (request.method === 'POST' && url.pathname.endsWith('/accept')) return acceptInvite(request, env);
  if (request.method === 'POST') return inviteMember(request, env);
  if (request.method === 'PATCH') return updateMember(request, env);
  return json({ error: 'Method not allowed.' }, 405);
}

async function listTeams(request, env) {
  const access = await requireAuthenticatedUser(request, env);
  if (access.error) return access.error;
  const base = supabaseBase(env);
  const owned = await fetch(`${base}/rest/v1/business_teams?owner_id=eq.${encodeURIComponent(access.user.id)}&select=id,name,seat_limit,subscription_status,created_at&limit=1`, {
    headers: serviceHeaders(env)
  });
  if (!owned.ok) return json({ error: 'Apply supabase-growth-features.sql and supabase-team-seats.sql to enable team management.' }, 503);
  const [team] = await owned.json();
  let members = [];
  if (team) {
    const memberResponse = await fetch(`${base}/rest/v1/business_team_members?team_id=eq.${encodeURIComponent(team.id)}&select=id,invited_email,role,invitation_status,created_at&order=created_at.asc`, {
      headers: serviceHeaders(env)
    });
    if (memberResponse.ok) members = await memberResponse.json();
  }
  const invites = await fetch(`${base}/rest/v1/business_team_members?invited_email=eq.${encodeURIComponent((access.user.email || '').toLowerCase())}&invitation_status=eq.pending&select=id,team_id,role,invitation_status,created_at`, {
    headers: serviceHeaders(env)
  });
  const pendingInvites = invites.ok ? await invites.json() : [];
  return json({ team: team || null, members, pendingInvites });
}

async function inviteMember(request, env) {
  const access = await requireProUser(request, env);
  if (access.error) return access.error;
  if (access.team && access.team.role !== 'owner') return json({ error: 'Only the Crew & Team subscription owner can invite teammates.' }, 403);
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const email = String(payload?.email || '').trim().toLowerCase();
  const role = ['admin', 'member', 'read_only'].includes(payload?.role) ? payload.role : 'member';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'Enter a valid teammate email.' }, 400);
  if (email === String(access.user.email || '').toLowerCase()) return json({ error: 'You already own this workspace.' }, 400);
  try {
    const base = supabaseBase(env);
    const teamResponse = await fetch(`${base}/rest/v1/business_teams?owner_id=eq.${encodeURIComponent(access.user.id)}&select=id,name,seat_limit,subscription_status&limit=1`, { headers: serviceHeaders(env) });
    if (!teamResponse.ok) return json({ error: 'Could not verify the Crew & Team subscription.' }, 502);
    const [team] = await teamResponse.json();
    if (!team || !['active', 'trialing'].includes(team.subscription_status)) return json({ error: 'An active Crew & Team subscription is required to invite teammates.' }, 402);
    const reservation = await fetch(`${base}/rest/v1/rpc/reserve_team_seat`, {
      method: 'POST', headers: serviceHeaders(env),
      body: JSON.stringify({ p_owner_id: access.user.id, p_email: email, p_role: role })
    });
    if (!reservation.ok) {
      const detail = await readJson(reservation);
      if (reservation.status === 403) return json({ error: detail?.message || 'An active Crew & Team subscription is required.' }, 402);
      if (reservation.status === 422 || reservation.status === 409) return json({ error: detail?.message || 'No team seats are available.' }, 409);
      return json({ error: detail?.message || 'Could not reserve a team seat.' }, 502);
    }
    return json({ invited: true, member: await reservation.json(), team });
  } catch (error) {
    return json({ error: error.message || 'Could not invite teammate.' }, 502);
  }
}

async function acceptInvite(request, env) {
  const access = await requireAuthenticatedUser(request, env);
  if (access.error) return access.error;
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(payload?.inviteId || '')) return json({ error: 'Invalid invitation.' }, 400);
  const email = String(access.user.email || '').trim().toLowerCase();
  if (!email) return json({ error: 'Your account needs an email address to accept invitations.' }, 400);
  const response = await fetch(`${supabaseBase(env)}/rest/v1/rpc/accept_team_invite`, {
    method: 'POST', headers: serviceHeaders(env),
    body: JSON.stringify({ p_invite_id: payload.inviteId, p_user_id: access.user.id, p_email: email })
  });
  if (!response.ok) return json({ error: 'Could not accept this invitation or no active seat is available.' }, response.status === 403 ? 402 : 502);
  const member = await response.json();
  if (!member?.id) return json({ error: 'Invitation not found, already handled, or the team has no active seats.' }, 409);
  return json({ accepted: true, member });
}

async function updateMember(request, env) {
  const access = await requireProUser(request, env);
  if (access.error) return access.error;
  if (access.team && access.team.role !== 'owner') return json({ error: 'Only the Crew & Team subscription owner can manage teammates.' }, 403);
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(payload?.memberId || '')) return json({ error: 'Invalid member.' }, 400);
  if (!['revoked', 'pending'].includes(payload?.status)) return json({ error: 'Unsupported member status.' }, 400);
  const base = supabaseBase(env);
  const teamLookup = await fetch(`${base}/rest/v1/business_teams?owner_id=eq.${encodeURIComponent(access.user.id)}&select=id,subscription_status&limit=1`, { headers: serviceHeaders(env) });
  if (!teamLookup.ok) return json({ error: 'Could not verify the Crew & Team subscription.' }, 502);
  const [team] = await teamLookup.json();
  if (!team || !['active', 'trialing'].includes(team.subscription_status)) return json({ error: 'An active Crew & Team subscription is required.' }, 402);
  const update = await fetch(`${base}/rest/v1/business_team_members?id=eq.${encodeURIComponent(payload.memberId)}&team_id=eq.${encodeURIComponent(team.id)}`, {
    method: 'PATCH', headers: serviceHeaders(env), body: JSON.stringify({ invitation_status: payload.status })
  });
  if (!update.ok) return json({ error: 'Could not update teammate.' }, 502);
  const rows = await update.json();
  if (!rows.length) return json({ error: 'Teammate not found.' }, 404);
  return json({ updated: true, member: rows[0] });
}
