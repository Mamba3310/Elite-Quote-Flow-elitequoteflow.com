import { json, requireProUser, readJson } from './pro-access.js';
import { businessSender } from './sender-address.js';

function cleanLine(value, max) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

export async function onSendCustomerMessage(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!env.RESEND_API_KEY?.trim() || !env.RESEND_FROM_EMAIL?.trim()) {
    return json({ error: 'In-app email sending is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL.' }, 503);
  }
  const access = await requireProUser(request, env);
  if (access.error) return access.error;
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const to = cleanLine(payload?.to, 254).toLowerCase();
  const subject = cleanLine(payload?.subject, 160);
  const text = String(payload?.body || '').replace(/\r\n/g, '\n').trim().slice(0, 5000);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: 'Enter the customer email.' }, 400);
  if (!subject) return json({ error: 'Enter a subject.' }, 400);
  if (text.length < 2) return json({ error: 'Write the message first.' }, 400);
  const profile = access.profile || {};
  const sender = businessSender(env, {
    businessName: profile.business_name,
    fullName: profile.full_name,
    replyTo: access.user.email
  });
  if (!sender) return json({ error: 'In-app email sending is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL.' }, 503);
  const resend = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: sender.from, to: [to], reply_to: sender.replyTo || undefined, subject, text })
  });
  const result = await readJson(resend);
  if (!resend.ok) {
    const detail = String(result?.message || result?.error || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    console.error('Resend customer message failed', resend.status, detail || 'unknown');
    return json({ error: detail ? `Could not send the message. ${detail}` : 'Could not send the message. Try again.' }, 502);
  }
  return json({ sent: true, id: result?.id || null, from: sender.from });
}
