const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY = 12;
const DEFAULT_AI_MODEL = '@cf/openai/gpt-oss-20b';
const AI_MODEL_FALLBACK = '@cf/ibm-granite/granite-4.0-h-micro';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const ASSISTANTS = { en: 'Stacey', fr: 'Camille', es: 'Lucía', pt: 'Beatriz', zh: 'Mei' };
function assistantName(language) {
  const code = String(language || 'en').toLowerCase().slice(0, 2);
  return ASSISTANTS[code] || ASSISTANTS.en;
}
export function supportPrompt() {
  return `You are Stacey, the friendly, practical customer support and onboarding assistant for Elite Quote Flow (elitequoteflow.com), a quote management and follow-up workspace built for home and commercial service businesses.

CORE CAPABILITIES
- Help users create, customize, and send itemized quotes.
- Explain follow-up reminders, quote templates, and online customer approvals.
- Answer billing, trial, and plan questions using only the pricing below.
- Guide users through logo, brand-color, Stripe deposit, and team-seat setup.

PLANS AND PRICING (STRICTLY ACCURATE)
1. Starter Desk: $0/month, free forever. Up to 5 active quotes per month; unlimited line items per quote; shareable customer quote links and online e-sign; follow-up calendar, templates, and mailto draft send.
2. 14-day Pro trial: $4.99 upfront. Full Solo Pro access for 14 days; payment card required. It automatically renews at $29/month after 14 days unless canceled anytime in Account Settings -> Manage Subscription.
3. Solo Pro: $29/month or $249/year (saves two months). Unlimited quotes and recurring auto-quotes; branded in-app quote emails and automated follow-up reminders; Stripe online deposits and invoice balance collection; custom logo, brand colors, AI scope drafting, referrals, and QuickBooks/Xero CSV exports.
4. Crew & Team: $59/month, includes 3 user seats, plus $15/month per additional seat. Includes Solo Pro, shared follow-up queue, customer notes, and Admin, Member, and Read-only roles.
Do not claim annual Crew & Team billing is available. Never invent a feature, discount, price, or plan term.

BILLING AND SECURITY
- Direct billing changes, cancellations, and payment updates to Account Settings -> Manage Subscription (Stripe Customer Portal).
- Never ask for passwords, full card numbers, CVVs, secret API keys, or other payment credentials.
- Do not claim you can access or change an account, payment, quote, subscription, or booking.
- Keep answers concise, clear, and practical for busy contractors reading on a phone.
- For bugs or human help, tell users to reply to their welcome email or contact support@elitequoteflow.com.`;
}
const DRAFT_PROMPT = `You help service-business owners draft customer-ready quote scopes. Turn their job notes into a clear, concise, professional scope. Preserve only facts they provide. Do not invent prices, guarantees, schedules, licenses, or included work. If details are missing, list them as questions instead of making assumptions.`;
function normalizeMessages(input) {
  if (!Array.isArray(input)) return null;
  const messages = input.slice(-MAX_HISTORY).map(item => {
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') return null;
    const content = item.content.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) return null;
    return { role: item.role, content };
  });
  return messages.length && messages.every(Boolean) && messages.at(-1).role === 'user' ? messages : null;
}
function productHelpFallback(messages, mode, name = 'Stacey') {
  const question = messages.at(-1)?.content.toLowerCase() || '';
  if (mode === 'draft') return 'I could not reach the drafting model just now. Write a short scope with the service, included work, exclusions, and any assumptions. Avoid adding prices or guarantees you have not confirmed, then try AI drafting again later.';
  if (/quote|proposal|estimate/.test(question) && /create|new|make|send|share|link/.test(question)) return 'To create a quote, sign in and select “New quote.” Add the customer, service, amount, follow-up date, and terms, then save. Use the link action to copy a customer link, or print to save a proposal as PDF.';
  if (/accept|approve|sign|decline/.test(question)) return 'Open the quote link from the business. Review the scope and amount, then enter your name and draw your signature to accept. You can also decline and optionally share a reason. Contact the business directly if you need a change.';
  if (/deposit|payment|pay|invoice|billing/.test(question)) return 'Solo Pro and Crew & Team include Stripe online deposits and invoice balance collection. For billing changes, cancellations, or payment updates, open Account Settings -> Manage Subscription. I cannot access or change payment records.';
  if (/follow.?up|reminder|calendar/.test(question)) return 'In your signed-in workspace, set a follow-up date on each quote. The dashboard and calendar show what is due; browser reminders can be enabled from the calendar. Email nudges run only when the business has configured email delivery.';
  if (/template/.test(question)) return 'In the signed-in workspace, select “Templates” above the quotes list to save common services, pricing, and terms. Choose a saved template while creating a quote.';
  if (/customer|history|note|recurring|repeat|appointment|booking|schedule/.test(question)) return 'The workspace includes customer history and private notes, recurring-service tracking, and appointment requests on accepted quote links. Appointment dates are requests, not confirmed bookings; the business must confirm availability.';
  if (/export|csv|calendar|contact/.test(question)) return 'Pro users can export quote and customer CSVs, calendar events, contacts, and accounting CSV data from the dashboard. Accounting CSV is a manual export for QuickBooks or Xero import, not a live sync.';
  if (/pro|upgrade|pricing|plan|free|trial|starter|solo/.test(question)) return 'Starter Desk is free forever and includes up to 5 active quotes per month, unlimited line items, customer quote links with e-sign, follow-up calendar, templates, and mailto draft send. Solo Pro is $29/month or $249/year. The 14-day Pro trial is $4.99 upfront and requires a card; it renews at $29/month unless canceled in Account Settings -> Manage Subscription.';
  if (/team|invite|seat/.test(question)) return 'Crew & Team is $59/month and includes 3 seats, shared follow-up queue, customer notes, and Admin, Member, and Read-only roles. Additional seats are $15/month each. The subscription owner chooses seats in the Crew & Team plan card and manages teammates from the Teams panel.';
  if (/referral/.test(question)) return 'Solo Pro and Crew & Team include referrals. Use the Referrals panel to copy your referral link or apply a code.';
  if (/account|sign.?in|password|login|cancel|billing|subscription/.test(question)) return 'Use the Sign in link on the landing page. For billing updates or cancellations, open Account Settings -> Manage Subscription. If you cannot access your account, use “Forgot password?” on the sign-in form. Never send your password or payment details in chat.';
  return `I’m ${name}. I can help with creating and sharing quotes, accepting a quote, deposits, follow-ups, templates, exports, Pro plans, teams, and recurring services. Tell me which part you are trying to do. For quote-specific changes or payment issues, contact the business that sent the quote.`;
}
function modelReply(result) {
  if (!result) return '';
  if (typeof result === 'string') return result.trim();
  if (typeof result.response === 'string' && result.response.trim()) return result.response.trim();
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : (part?.text || '')).join('').trim();
  return '';
}
async function askModel(env, messages) {
  if (env.AI?.run) {
    const configuredModel = String(env.SUPPORT_AI_MODEL || DEFAULT_AI_MODEL).trim();
    const models = [...new Set([configuredModel, DEFAULT_AI_MODEL, AI_MODEL_FALLBACK])];
    let lastError;
    for (const model of models) {
      try {
        const result = await env.AI.run(model, { messages, max_tokens: 400 });
        const reply = modelReply(result);
        if (reply) return reply;
        lastError = new Error(`Workers AI returned an empty result from ${model}.`);
      } catch (error) {
        lastError = error;
        console.error(`Workers AI model request failed (${model}):`, String(error?.message || error).slice(0, 240));
      }
    }
    if (lastError) throw lastError;
  }
  if (env.OPENAI_API_KEY?.trim()) {
    const endpoint = (env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions').trim();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.SUPPORT_AI_MODEL || 'gpt-4o-mini', messages, max_tokens: 400, temperature: 0.3 })
    });
    if (!response.ok) throw new Error(`AI provider returned ${response.status}.`);
    return (await response.json())?.choices?.[0]?.message?.content?.trim();
  }
  return null;
}
export async function onSupportChat(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed.', { status: 405, headers: { Allow: 'POST' } });
  let input;
  try { input = await request.json(); } catch { return json({ error: 'Send a valid JSON message.' }, 400); }
  const messages = normalizeMessages(input?.messages);
  if (!messages) return json({ error: 'Send up to 12 short chat messages, ending with a user question.' }, 400);
  const mode = input?.mode === 'draft' ? 'draft' : 'support';
  const name = assistantName(input?.language);
  const system = mode === 'draft' ? DRAFT_PROMPT : supportPrompt(name);
  try {
    const reply = await askModel(env, [{ role: 'system', content: system }, ...messages]);
    if (reply) return json({ reply, mode: 'ai' });
    return json({ reply: productHelpFallback(messages, mode, name), mode: 'help-fallback' });
  } catch (error) {
    console.error('Support assistant provider failed; using product guidance fallback:', error.message);
    return json({ reply: productHelpFallback(messages, mode, name), mode: 'help-fallback' });
  }
}
