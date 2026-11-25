import { sendingDomain } from './sender-address.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const ACTIONS = {
  signup: ['Confirm your Elite Quote Flow account', 'Confirm your email to open your Elite Quote Flow desk.'],
  email: ['Confirm your Elite Quote Flow account', 'Confirm your email to open your Elite Quote Flow desk.'],
  magiclink: ['Sign in to Elite Quote Flow', 'Use this link to sign in to Elite Quote Flow.'],
  recovery: ['Reset your Elite Quote Flow password', 'Use this link to choose a new Elite Quote Flow password.'],
  invite: ['Your Elite Quote Flow invite', 'Use this link to join Elite Quote Flow.'],
  email_change: ['Confirm your Elite Quote Flow email', 'Confirm this email address for your Elite Quote Flow account.']
};

function hookSecret(env) {
  return String(env.SEND_EMAIL_HOOK_SECRET || '').trim().replace(/^v1,whsec_/, '');
}

function decodeSecret(secret) {
  const binary = atob(secret);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function signatureValid(raw, headers, secret) {
  const id = headers.get('webhook-id') || '';
  const timestamp = headers.get('webhook-timestamp') || '';
  const signature = headers.get('webhook-signature') || '';
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!id || !timestamp || !signature || !Number.isFinite(age) || age > 300) return false;
  const key = await crypto.subtle.importKey('raw', decodeSecret(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return signature.split(' ').some(part => {
    const [version, value] = part.split(',');
    return version === 'v1' && timingSafeEqual(value || '', expected);
  });
}

export function authMessage(env, request, payload) {
  const action = String(payload?.email_data?.email_action_type || '');
  const copy = ACTIONS[action];
  const tokenHash = String(payload?.email_data?.token_hash || '');
  const email = String(payload?.user?.email || '').trim().toLowerCase();
  const domain = sendingDomain(env);
  if (!copy || !domain || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[A-Za-z0-9_-]{8,256}$/.test(tokenHash)) return null;
  const appUrl = (env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  const link = new URL(`${appUrl}/`);
  link.searchParams.set('token_hash', tokenHash);
  link.searchParams.set('type', action);
  return {
    from: `Elite Quote Flow <welcome@${domain}>`,
    to: email,
    subject: copy[0],
    text: `${copy[1]}\n\n${link}\n\nElite Quote Flow\nhttps://elitequoteflow.com`
  };
}

export async function onAuthEmail(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const secret = hookSecret(env);
  if (!secret || !env.RESEND_API_KEY?.trim()) return json({ error: 'Account email is not configured.' }, 503);
  const raw = await request.text();
  if (!await signatureValid(raw, request.headers, secret)) return json({ error: 'Invalid account email signature.' }, 401);
  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'Invalid account email.' }, 400); }
  const message = authMessage(env, request, payload);
  if (!message) return json({ error: 'This account email could not be prepared.' }, 400);
  const resend = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, text: message.text })
  });
  if (!resend.ok) return json({ error: 'Account email could not be sent.' }, 502);
  return json({});
}
