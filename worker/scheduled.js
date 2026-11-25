import { businessSender } from './sender-address.js';

const jsonHeaders = { 'Content-Type': 'application/json' };
const MAX_QUOTES_PER_RUN = 100;
const MAX_PLANS_PER_RUN = 100;

async function fetchDueQuotes(base, key, today) {
  const rows = [];
  for (let offset = 0; ; offset += MAX_QUOTES_PER_RUN) {
    const response = await fetch(`${base}/rest/v1/quotes?status=eq.sent&select=id,user_id,customer,email,service,amount,currency,line_items,public_token,expires_at,follow_up,reminder_count,last_reminder_at&or=(expires_at.lte.${today},follow_up.lte.${today})&order=id&limit=${MAX_QUOTES_PER_RUN}&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!response.ok) throw new Error(`Supabase reminder query failed (${response.status}).`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < MAX_QUOTES_PER_RUN) return rows;
  }
}

async function fetchProOwners(base, key, userIds) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const pro = new Set();
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const response = await fetch(`${base}/rest/v1/profiles?id=in.(${chunk.map(id => `"${id}"`).join(',')})&is_pro=eq.true&select=id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!response.ok) throw new Error(`Supabase Pro owner lookup failed (${response.status}).`);
    for (const row of await response.json()) pro.add(row.id);
  }
  return pro;
}

function quoteItemLabels(quote) {
  const items = Array.isArray(quote.line_items) ? quote.line_items : [];
  const labels = items.map(item => String(item?.description || '').trim()).filter(Boolean).slice(0, 8);
  if (labels.length) return labels;
  const service = String(quote.service || '').trim();
  return service ? [service] : [];
}

function reminderSignature(profile) {
  return [profile.fullName, profile.businessName, profile.phone].map(value => String(value || '').trim()).filter(Boolean).join('\n');
}

async function sendReminder(env, quote, stage = 0, profile = {}, replyTo = '') {
  const sender = businessSender(env, { businessName: profile.businessName, fullName: profile.fullName, replyTo });
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || !sender || !quote.email) return false;
  const link = `${env.PUBLIC_APP_URL || 'https://elitequoteflow.com'}/q/${quote.public_token}`;
  const items = quoteItemLabels(quote).map(label => `- ${label}`).join('\n');
  const total = quote.amount == null || quote.amount === '' ? '' : `Quote total: ${quote.amount} ${quote.currency || 'USD'}\n\n`;
  const signature = reminderSignature(profile);
  const signoff = signature ? `\n\nBest,\n${signature}` : '';
  const messages = [
    { subject: `Your ${quote.service} quote is ready`, text: `Hello ${quote.customer},\n\nJust a quick note that your quote is ready to review.\n\n${items}\n\n${total}You can view the quote and let us know what you think here:\n${link}\n\nPlease reply to this email if you have questions.${signoff}` },
    { subject: `Any questions about your ${quote.service} quote?`, text: `Hello ${quote.customer},\n\nI wanted to check whether you had any questions about this quote.\n\n${items}\n\n${total}If anything needs clarification, you can review it here or reply to this email:\n${link}\n\nNo pressure; happy to help.${signoff}` },
    { subject: `Last check-in about your ${quote.service} quote`, text: `Hello ${quote.customer},\n\nOne last check-in about this quote.\n\n${items}\n\n${total}If the timing is not right, that is okay. You can review the details here, or reply if you would like to discuss another option:\n${link}\n\nThank you for considering us.${signoff}` }
  ];
  const message = messages[Math.min(stage, messages.length - 1)];
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, ...jsonHeaders },
    body: JSON.stringify({
      from: sender.from,
      to: [quote.email],
      reply_to: sender.replyTo || undefined,
      subject: message.subject,
      text: message.text
    })
  });
  return response.ok;
}

async function ownerReplyTo(base, key, userId, cache) {
  if (cache.has(userId)) return cache.get(userId);
  let email = '';
  try {
    const response = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (response.ok) email = (await response.json())?.email || '';
  } catch (error) {
    console.error('Could not load owner email for reply-to', userId, error.message);
  }
  cache.set(userId, email);
  return email;
}

function nextServiceDate(current, frequency) {
  const date = new Date(`${current}T00:00:00Z`);
  if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1);
  else if (frequency === 'quarterly') date.setUTCMonth(date.getUTCMonth() + 3);
  else if (frequency === 'annually') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else return null;
  return date.toISOString().slice(0, 10);
}

async function processRecurringPlans(env, base, key, today, proOwners) {
  const results = { scanned: 0, created: 0, advanced: 0, failed: 0 };
  for (let offset = 0; ; offset += MAX_PLANS_PER_RUN) {
    const response = await fetch(`${base}/rest/v1/recurring_service_plans?status=eq.active&next_service_date=lte.${today}&select=*&order=next_service_date&limit=${MAX_PLANS_PER_RUN}&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!response.ok) {
      if (response.status === 404) return results;
      throw new Error(`Supabase recurring plan query failed (${response.status}).`);
    }
    const plans = await response.json();
    results.scanned += plans.length;
    for (const plan of plans) {
      try {
        if (!proOwners.has(plan.user_id)) continue;
        const followUp = nextServiceDate(plan.next_service_date, plan.frequency) || plan.next_service_date;
        const insert = await fetch(`${base}/rest/v1/quotes`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            user_id: plan.user_id,
            customer: plan.customer,
            email: plan.email || '',
            service: plan.service,
            amount: plan.amount,
            currency: plan.currency || 'USD',
            follow_up: followUp,
            status: 'sent',
            note: plan.notes ? `Auto-created from recurring plan. ${plan.notes}`.slice(0, 240) : 'Auto-created from recurring plan.',
            public_token: crypto.randomUUID(),
            quote_terms: ''
          })
        });
        if (!insert.ok) {
          results.failed++;
          continue;
        }
        results.created++;
        const nextDate = nextServiceDate(plan.next_service_date, plan.frequency);
        if (!nextDate) {
          results.failed++;
          continue;
        }
        const advance = await fetch(`${base}/rest/v1/recurring_service_plans?id=eq.${encodeURIComponent(plan.id)}`, {
          method: 'PATCH',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ next_service_date: nextDate, updated_at: new Date().toISOString() })
        });
        if (advance.ok) results.advanced++; else results.failed++;
      } catch (error) {
        console.error('Recurring plan processing failed', plan.id, error.message);
        results.failed++;
      }
    }
    if (plans.length < MAX_PLANS_PER_RUN) return results;
  }
}

export async function runScheduled(env, now = new Date()) {
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) throw new Error('Supabase scheduled job secrets are not configured.');
  const base = env.SUPABASE_URL.trim().replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  const today = now.toISOString().slice(0, 10);
  const quotes = await fetchDueQuotes(base, key, today);
  const proOwners = await fetchProOwners(base, key, quotes.map(quote => quote.user_id));
  const businessNames = new Map();
  const ownerEmails = new Map();
  if (proOwners.size) {
    const ids = [...proOwners];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const response = await fetch(`${base}/rest/v1/profiles?id=in.(${chunk.map(id => `"${id}"`).join(',')})&select=id,business_name,full_name,phone`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      });
      if (response.ok) {
        for (const row of await response.json()) businessNames.set(row.id, { businessName: row.business_name || '', fullName: row.full_name || '', phone: row.phone || '' });
      }
    }
  }

  const results = { scanned: quotes.length, emailed: 0, expired: 0, failed: 0, skippedFree: 0, recurring: null };
  for (const quote of quotes) {
    try {
      const expired = quote.expires_at && quote.expires_at < today;
      if (expired) {
        const update = await fetch(`${base}/rest/v1/quotes?id=eq.${encodeURIComponent(quote.id)}&status=eq.sent`, {
          method: 'PATCH',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'lost', status_changed_at: now.toISOString(), updated_at: now.toISOString() })
        });
        if (update.ok) results.expired++; else results.failed++;
        continue;
      }
      if (!proOwners.has(quote.user_id)) {
        results.skippedFree++;
        continue;
      }
      const last = quote.last_reminder_at ? new Date(quote.last_reminder_at) : null;
      const dueAt = quote.follow_up ? new Date(`${quote.follow_up}T00:00:00Z`) : null;
      const reminderCount = Number(quote.reminder_count || 0);
      const cadenceDays = [0, 3, 7];
      const dueForStage = dueAt && now.getTime() >= dueAt.getTime() + (cadenceDays[reminderCount] ?? Infinity) * 24 * 60 * 60 * 1000;
      const quietPeriodElapsed = !last || now.getTime() - last.getTime() >= 24 * 60 * 60 * 1000;
      if (dueForStage && quietPeriodElapsed && reminderCount < 3) {
        const sent = await sendReminder(env, quote, reminderCount, businessNames.get(quote.user_id) || {}, await ownerReplyTo(base, key, quote.user_id, ownerEmails));
        if (sent) {
          const update = await fetch(`${base}/rest/v1/quotes?id=eq.${encodeURIComponent(quote.id)}&status=eq.sent`, {
            method: 'PATCH',
            headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({
              reminder_count: Number(quote.reminder_count || 0) + 1,
              last_reminder_at: now.toISOString(),
              updated_at: now.toISOString()
            })
          });
          if (update.ok) results.emailed++; else results.failed++;
        }
      }
    } catch (error) {
      console.error('Scheduled quote processing failed', quote.id, error.message);
      results.failed++;
    }
  }

  try {
    const planOwnersResponse = await fetch(`${base}/rest/v1/recurring_service_plans?status=eq.active&next_service_date=lte.${today}&select=user_id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (planOwnersResponse.ok) {
      const planOwners = await planOwnersResponse.json();
      const planProOwners = await fetchProOwners(base, key, planOwners.map(row => row.user_id));
      results.recurring = await processRecurringPlans(env, base, key, today, planProOwners);
    } else if (planOwnersResponse.status !== 404) {
      results.recurring = { error: `plan owner query failed (${planOwnersResponse.status})` };
    } else {
      results.recurring = { scanned: 0, created: 0, advanced: 0, failed: 0 };
    }
  } catch (error) {
    console.error('Recurring plan schedule failed', error.message);
    results.recurring = { error: error.message };
  }
  return results;
}

export default {
  async scheduled(_event, env, context) {
    context.waitUntil(runScheduled(env));
  }
};
