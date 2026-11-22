import { json, requireProUser, supabaseBase, readJson } from './pro-access.js';

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
  const business = escapeText(access.profile.business_name || access.profile.full_name || 'our team');
  const fromName = business.slice(0, 60);
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
    access.profile.phone || ''
  ].filter(Boolean).join('\n');

  const resend = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${fromName} <${env.RESEND_FROM_EMAIL.trim()}>`,
      to: [quote.email],
      reply_to: access.user.email || undefined,
      subject,
      text: body
    })
  });
  const result = await readJson(resend);
  if (!resend.ok) {
    console.error('Resend quote email failed', resend.status, result?.message || result?.error || 'unknown');
    return json({ error: 'Could not send the quote email. Try again or use your email app.' }, 502);
  }
  return json({ sent: true, id: result?.id || null, link });
}
