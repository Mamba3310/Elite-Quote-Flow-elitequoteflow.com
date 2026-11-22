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

async function ensureTeam(env, ownerId, name) {
  const base = supabaseBase(env);
  const existing = await fetch(`${base}/rest/v1/business_teams?owner_id=eq.${encodeURIComponent(ownerId)}&select=*&limit=1`, {
    headers: serviceHeaders(env)
  });
  if (!existing.ok) throw new Error('Could not load team.');
  const [team] = await existing.json();
  if (team) return team;
  const created = await fetch(`${base}/rest/v1/business_teams`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({ owner_id: ownerId, name: name || 'My team' })
  });
  if (!created.ok) throw new Error('Could not create team.');
  const [row] = await created.json();
  return row;
}

async function listTeams(request, env) {
  const access = await requireAuthenticatedUser(request, env);
  if (access.error) return access.error;
  const base = supabaseBase(env);
  const owned = await fetch(`${base}/rest/v1/business_teams?owner_id=eq.${encodeURIComponent(access.user.id)}&select=id,name,created_at&limit=1`, {
    headers: serviceHeaders(env)
  });
  if (!owned.ok) return json({ error: 'Apply supabase-growth-features.sql to enable teams, or check team table access.' }, 503);
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
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const email = String(payload?.email || '').trim().toLowerCase();
  const role = ['admin', 'member', 'read_only'].includes(payload?.role) ? payload.role : 'member';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: 'Enter a valid teammate email.' }, 400);
  if (email === String(access.user.email || '').toLowerCase()) return json({ error: 'You already own this workspace.' }, 400);

  try {
    const team = await ensureTeam(env, access.user.id, access.profile.business_name || 'My team');
    const base = supabaseBase(env);
    const insert = await fetch(`${base}/rest/v1/business_team_members`, {
      method: 'POST',
      headers: { ...serviceHeaders(env), Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        team_id: team.id,
        invited_email: email,
        role,
        invitation_status: 'pending'
      })
    });
    if (!insert.ok) {
      const detail = await readJson(insert);
      return json({ error: detail?.message || 'Could not save the invitation.' }, 502);
    }
    const [member] = await insert.json();
    return json({ invited: true, member, team });
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
  const email = String(access.user.email || '').toLowerCase();
  if (!email) return json({ error: 'Your account needs an email address to accept invitations.' }, 400);
  const base = supabaseBase(env);
  const update = await fetch(`${base}/rest/v1/business_team_members?id=eq.${encodeURIComponent(payload.inviteId)}&invited_email=eq.${encodeURIComponent(email)}&invitation_status=eq.pending`, {
    method: 'PATCH',
    headers: serviceHeaders(env),
    body: JSON.stringify({ invitation_status: 'accepted', user_id: access.user.id })
  });
  if (!update.ok) return json({ error: 'Could not accept this invitation.' }, 502);
  const rows = await update.json();
  if (!rows.length) return json({ error: 'Invitation not found or already handled.' }, 404);
  return json({ accepted: true, member: rows[0] });
}

async function updateMember(request, env) {
  const access = await requireProUser(request, env);
  if (access.error) return access.error;
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(payload?.memberId || '')) return json({ error: 'Invalid member.' }, 400);
  if (!['revoked', 'pending'].includes(payload?.status)) return json({ error: 'Unsupported member status.' }, 400);
  const team = await ensureTeam(env, access.user.id, access.profile.business_name || 'My team');
  const base = supabaseBase(env);
  const update = await fetch(`${base}/rest/v1/business_team_members?id=eq.${encodeURIComponent(payload.memberId)}&team_id=eq.${encodeURIComponent(team.id)}`, {
    method: 'PATCH',
    headers: serviceHeaders(env),
    body: JSON.stringify({ invitation_status: payload.status })
  });
  if (!update.ok) return json({ error: 'Could not update teammate.' }, 502);
  const rows = await update.json();
  if (!rows.length) return json({ error: 'Teammate not found.' }, 404);
  return json({ updated: true, member: rows[0] });
}
