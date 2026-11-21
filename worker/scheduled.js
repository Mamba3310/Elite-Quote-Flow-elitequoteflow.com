const jsonHeaders = { 'Content-Type': 'application/json' };
const MAX_QUOTES_PER_RUN = 100;
async function fetchDueQuotes(base, key, today) {
  const rows = [];
  for (let offset = 0; ; offset += MAX_QUOTES_PER_RUN) {
    const response = await fetch(`${base}/rest/v1/quotes?status=eq.sent&select=id,user_id,customer,email,service,public_token,expires_at,follow_up,reminder_count,last_reminder_at&or=(expires_at.lte.${today},follow_up.lte.${today})&order=id&limit=${MAX_QUOTES_PER_RUN}&offset=${offset}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error(`Supabase reminder query failed (${response.status}).`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < MAX_QUOTES_PER_RUN) return rows;
  }
}
async function sendReminder(env, quote, stage = 0) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || !quote.email) return false;
  const link = `${env.PUBLIC_APP_URL || 'https://elitequoteflow.com'}/q/${quote.public_token}`;
  const messages = [
    { subject: `Your ${quote.service} quote is ready`, text: `Hello ${quote.customer},\n\nJust a quick note that your quote for ${quote.service} is ready to review. You can view the quote and let us know what you think here:\n${link}\n\nPlease reply to this email if you have questions.` },
    { subject: `Any questions about your ${quote.service} quote?`, text: `Hello ${quote.customer},\n\nI wanted to check whether you had any questions about the quote for ${quote.service}. If anything needs clarification, you can review it here or reply to this email:\n${link}\n\nNo pressure; happy to help.` },
    { subject: `Last check-in about your ${quote.service} quote`, text: `Hello ${quote.customer},\n\nOne last check-in about your ${quote.service} quote. If the timing is not right, that is okay. You can review the details here, or reply if you would like to discuss another option:\n${link}\n\nThank you for considering us.` }
  ];
  const message = messages[Math.min(stage, messages.length - 1)];
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, ...jsonHeaders },
    body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [quote.email], subject: message.subject, text: message.text })
  });
  return response.ok;
}
export async function runScheduled(env, now = new Date()) {
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) throw new Error('Supabase scheduled job secrets are not configured.');
  const base = env.SUPABASE_URL.trim().replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const quotes = await fetchDueQuotes(base, key, now.toISOString().slice(0, 10));
  const results = { scanned: quotes.length, emailed: 0, expired: 0, failed: 0 };
  for (const quote of quotes) {
    try {
      const expired = quote.expires_at && quote.expires_at < now.toISOString().slice(0, 10);
      if (expired) {
        const update = await fetch(`${base}/rest/v1/quotes?id=eq.${encodeURIComponent(quote.id)}&status=eq.sent`, {
          method: 'PATCH', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'lost', status_changed_at: now.toISOString(), updated_at: now.toISOString() })
        });
        if (update.ok) results.expired++; else results.failed++;
        continue;
      }
      const last = quote.last_reminder_at ? new Date(quote.last_reminder_at) : null;
      const dueAt = quote.follow_up ? new Date(`${quote.follow_up}T00:00:00Z`) : null;
      const reminderCount = Number(quote.reminder_count || 0);
      const cadenceDays = [0, 3, 7];
      const dueForStage = dueAt && now.getTime() >= dueAt.getTime() + (cadenceDays[reminderCount] ?? Infinity) * 24 * 60 * 60 * 1000;
      const quietPeriodElapsed = !last || now.getTime() - last.getTime() >= 24 * 60 * 60 * 1000;
      if (dueForStage && quietPeriodElapsed && reminderCount < 3) {
        const sent = await sendReminder(env, quote, reminderCount);
        if (sent) {
          const update = await fetch(`${base}/rest/v1/quotes?id=eq.${encodeURIComponent(quote.id)}&status=eq.sent`, {
            method: 'PATCH', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ reminder_count: Number(quote.reminder_count || 0) + 1, last_reminder_at: now.toISOString(), updated_at: now.toISOString() })
          });
          if (update.ok) results.emailed++; else results.failed++;
        }
      }
    } catch (error) { console.error('Scheduled quote processing failed', quote.id, error.message); results.failed++; }
  }
  return results;
}
export default { async scheduled(_event, env, context) { context.waitUntil(runScheduled(env)); } };
