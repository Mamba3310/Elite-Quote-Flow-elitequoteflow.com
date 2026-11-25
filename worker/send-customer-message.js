import { json, requireProUser, readJson } from './pro-access.js';
import { businessSender } from './sender-address.js';

const BULK_MESSAGE_LIMIT = 25;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanLine(value, max) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function recipientsFrom(payload) {
  const source = Array.isArray(payload?.recipients) ? payload.recipients : [payload?.to ? { to: payload.to, name: payload?.name } : null];
  const seen = new Set();
  const recipients = [];
  for (const item of source) {
    if (!item) continue;
    const to = cleanLine(item.to ?? item, 254).toLowerCase();
    if (!to || seen.has(to)) continue;
    seen.add(to);
    recipients.push({ to, name: cleanLine(item.name, 80) });
  }
  return recipients;
}

async function deliverMessage(env, sender, recipient, subject, text) {
  const name = recipient.name || recipient.to.split('@')[0];
  const personal = text.split('{{customer}}').join(name);
  try {
    const resend = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: sender.from, to: [recipient.to], reply_to: sender.replyTo || undefined, subject, text: personal })
    });
    const result = await readJson(resend);
    if (!resend.ok) {
      const detail = String(result?.message || result?.error || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      console.error('Resend customer message failed', resend.status, detail || 'unknown');
      return { to: recipient.to, sent: false, error: detail };
    }
    return { to: recipient.to, sent: true, id: result?.id || null };
  } catch (error) {
    console.error('Resend customer message failed', error?.message || error);
    return { to: recipient.to, sent: false, error: '' };
  }
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
  const recipients = recipientsFrom(payload);
  const subject = cleanLine(payload?.subject, 160);
  const text = String(payload?.body || '').replace(/\r\n/g, '\n').trim().slice(0, 5000);
  if (!recipients.length) return json({ error: 'Enter the customer email.' }, 400);
  if (recipients.length > BULK_MESSAGE_LIMIT) return json({ error: `Send to ${BULK_MESSAGE_LIMIT} customers at a time.` }, 400);
  if (recipients.some(recipient => !EMAIL.test(recipient.to))) return json({ error: 'Enter a valid customer email.' }, 400);
  if (!subject) return json({ error: 'Enter a subject.' }, 400);
  if (text.length < 2) return json({ error: 'Write the message first.' }, 400);
  const profile = access.profile || {};
  const sender = businessSender(env, {
    businessName: profile.business_name,
    fullName: profile.full_name,
    replyTo: access.user.email
  });
  if (!sender) return json({ error: 'In-app email sending is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL.' }, 503);
  const results = [];
  for (const recipient of recipients) results.push(await deliverMessage(env, sender, recipient, subject, text));
  const sentResults = results.filter(result => result.sent);
  if (!sentResults.length) {
    const detail = results.find(result => result.error)?.error;
    return json({ error: detail ? `Could not send the message. ${detail}` : 'Could not send the message. Try again.', results }, 502);
  }
  if (recipients.length === 1) return json({ sent: true, count: 1, failed: 0, id: sentResults[0].id, from: sender.from });
  return json({ sent: true, count: sentResults.length, failed: results.length - sentResults.length, results, from: sender.from });
}
