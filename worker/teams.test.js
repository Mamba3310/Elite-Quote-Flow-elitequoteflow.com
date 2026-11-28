import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
const token = `header.${Buffer.from(JSON.stringify({ aal: 'aal2' })).toString('base64url')}.signature`;
const env = { SUPABASE_URL: 'https://supabase.example', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };
const req = (url, body, method = 'POST') => new Request(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function mockedFetch(mock, run) { const original = globalThis.fetch; globalThis.fetch = mock; try { await run(); } finally { globalThis.fetch = original; } }

test('Crew & Team invitation reserves seats only with active subscription and returns capacity errors', async () => {
 let reserved = false;
 await mockedFetch(async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith('/auth/v1/user')) return Response.json({ id: 'owner1', email: 'owner@example.com' });
  if (target.includes('/rest/v1/profiles?')) return Response.json([{ id: 'owner1', is_pro: false, business_name: 'Acme' }]);
  if (target.includes('/rest/v1/business_teams?owner_id=eq.owner1&select=id,seat_limit,subscription_status&limit=1')) return Response.json([{ id: 'team1', seat_limit: 3, subscription_status: 'active' }]);
  if (target.endsWith('/rest/v1/business_teams?owner_id=eq.owner1&select=id,name,seat_limit,subscription_status&limit=1')) return Response.json([{ id: 'team1', name: 'Acme', seat_limit: 3, subscription_status: 'active' }]);
  if (target.endsWith('/rpc/reserve_team_seat')) { reserved = true; assert.deepEqual(JSON.parse(options.body), { p_owner_id: 'owner1', p_email: 'member@example.com', p_role: 'member' }); return Response.json({ id: 'm1', invitation_status: 'pending' }); }
  assert.fail(`Unexpected ${target}`);
 }, async () => {
  const response = await worker.fetch(req('https://app.example/api/teams', { email: 'member@example.com', role: 'member' }), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).invited, true);
 });
 assert.equal(reserved, true);
 await mockedFetch(async url => {
  const target = String(url);
  if (target.endsWith('/auth/v1/user')) return Response.json({ id: 'owner1', email: 'owner@example.com' });
  if (target.includes('/rest/v1/profiles?')) return Response.json([{ id: 'owner1', is_pro: false }]);
  if (target.endsWith('/rest/v1/business_teams?owner_id=eq.owner1&select=id,name,seat_limit,subscription_status&limit=1')) return Response.json([{ id: 'team1', subscription_status: 'past_due', seat_limit: 3 }]);
  assert.fail(`Inactive team must not reserve a seat: ${target}`);
 }, async () => {
  const response = await worker.fetch(req('https://app.example/api/teams', { email: 'member@example.com' }), env);
  assert.equal(response.status, 402);
 });
});

test('active accepted team members receive Pro entitlement, while inactive members do not', async () => {
 await mockedFetch(async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith('/auth/v1/user')) return Response.json({ id: 'member1', email: 'member@example.com' });
  if (target.includes('/rest/v1/profiles?')) return Response.json([{ id: 'member1', is_pro: false }]);
  if (target.endsWith('/rpc/get_team_entitlement')) { assert.deepEqual(JSON.parse(options.body), { p_user_id: 'member1' }); return Response.json({ team_id: 'team1', role: 'member', seat_limit: 5, subscription_status: 'active' }); }
  assert.fail(`Unexpected ${target}`);
 }, async () => {
  const response = await worker.fetch(new Request('https://app.example/api/account-access', { headers: { Authorization: `Bearer ${token}` } }), env);
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.pro, true); assert.equal(body.access, 'team'); assert.equal(body.team.role, 'member'); assert.equal(body.team.seatLimit, 5);
 });
 await mockedFetch(async url => {
  const target = String(url);
  if (target.endsWith('/auth/v1/user')) return Response.json({ id: 'member1', email: 'member@example.com' });
  if (target.includes('/rest/v1/profiles?')) return Response.json([{ id: 'member1', is_pro: false }]);
  if (target.endsWith('/rpc/get_team_entitlement')) return Response.json(null);
  assert.fail(`Unexpected ${target}`);
 }, async () => {
  const response = await worker.fetch(new Request('https://app.example/api/account-access', { headers: { Authorization: `Bearer ${token}` } }), env);
  assert.equal((await response.json()).access, 'free');
 });
});

test('read-only team members cannot invite additional teammates', async () => {
 await mockedFetch(async url => {
  const target = String(url);
  if (target.endsWith('/auth/v1/user')) return Response.json({ id: 'member1', email: 'member@example.com' });
  if (target.includes('/rest/v1/profiles?')) return Response.json([{ id: 'member1', is_pro: false }]);
  if (target.endsWith('/rpc/get_team_entitlement')) return Response.json({ team_id: 'team1', role: 'read_only', seat_limit: 5, subscription_status: 'active' });
  assert.fail(`Read-only role must be rejected before further requests: ${target}`);
 }, async () => {
  const response = await worker.fetch(req('https://app.example/api/teams', { email: 'other@example.com' }), env);
  assert.equal(response.status, 403); assert.match((await response.json()).error, /read-only/i);
 });
});

test('acceptance is bound to authenticated email and current subscription seat via RPC', async () => {
 let call;
 await mockedFetch(async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith('/auth/v1/user')) return Response.json({ id: 'member1', email: 'MEMBER@example.com' });
  if (target.endsWith('/rpc/accept_team_invite')) { call = JSON.parse(options.body); return Response.json({ id: 'm1', user_id: 'member1', invitation_status: 'accepted' }); }
  assert.fail(`Unexpected ${target}`);
 }, async () => {
  const response = await worker.fetch(req('https://app.example/api/teams/accept', { inviteId: '550e8400-e29b-41d4-a716-446655440000' }), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).accepted, true);
 });
 assert.deepEqual(call, { p_invite_id: '550e8400-e29b-41d4-a716-446655440000', p_user_id: 'member1', p_email: 'member@example.com' });
});
