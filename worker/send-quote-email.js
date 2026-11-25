import { json, requireProUser, readJson } from './pro-access.js';
import { businessSender } from './sender-address.js';
import { messageAttachments } from './message-attachments.js';

function escapeText(value) {
  return String(value || '').replace(/\r?\n/g, '\n').trim();
}

export async function onSendQuoteEmail(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!env.RESEND_API_KEY?.trim() || !env.RESEND_FROM_EMAIL?.trim()) {
    return json({ error: 'In-app email sending is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL, or use your email app to send the quote.' }, 503);
  }
  const access = await requireProUser(request, env);
  if (access.error) return access.error;
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(payload?.quoteId || '')) return json({ error: 'Invalid quote.' }, 400);

  const quoteResponse = await fetch(
    `${access.base}/rest/v1/quotes?id=eq.${encodeURIComponent(payload.quoteId)}&user_id=eq.${encodeURIComponent(access.user.id)}&select=id,customer,email,service,amount,currency,public_token,follow_up,status&limit=1`,
    { headers: { apikey: env.SUPABASE_ANON_KEY.trim(), Authorization: access.authorization } }
  );
  if (!quoteResponse.ok) return json({ error: 'Could not load this quote.' }, 502);
  const [quote] = await quoteResponse.json();
  if (!quote) return json({ error: 'Quote not found.' }, 404);
  if (!quote.email) return json({ error: 'Add a customer email before sending.' }, 400);
  if (!quote.public_token) return json({ error: 'Create a customer quote link before sending.' }, 400);

  const appUrl = (env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  const link = `${appUrl}/q/${quote.public_token}`;
  const profile = access.profile || {};
  const sender = businessSender(env, {
    businessName: profile.business_name,
    fullName: profile.full_name,
    replyTo: access.user.email
  });
  if (!sender) return json({ error: 'In-app email sending is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL, or use your email app to send the quote.' }, 503);
  const files = messageAttachments(payload);
  if (files.error) return json({ error: files.error }, 400);
  const fromName = sender.name === 'Elite Quote Flow' ? 'our team' : sender.name;
  const subject = escapeText(payload.subject) || `Your ${quote.service} quote from ${fromName}`;
  const body = escapeText(payload.body) || [
    `Hi ${quote.customer},`,
    '',
    `Thank you for the opportunity to quote ${quote.service}.`,
    '',
    `Quote total: ${quote.amount} ${quote.currency || 'USD'}`,
    `Review and respond here: ${link}`,
    '',
    `Best,`,
    fromName,
    profile.phone || ''
  ].filter(Boolean).join('\n');

  const message = {
    from: sender.from,
    to: [quote.email],
    reply_to: sender.replyTo || undefined,
    subject,
    text: body
  };
  if (files.attachments.length) message.attachments = files.attachments;
  const resend = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  });
  const result = await readJson(resend);
  if (!resend.ok) {
    const detail = String(result?.message || result?.error || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    console.error('Resend quote email failed', resend.status, detail || 'unknown');
    return json({ error: detail ? `Could not send the quote email. ${detail}` : 'Could not send the quote email. Try again or use your email app.' }, 502);
  }
  return json({ sent: true, id: result?.id || null, link, from: sender.from });
}
