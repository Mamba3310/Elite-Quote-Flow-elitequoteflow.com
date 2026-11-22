const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY = 12;
const DEFAULT_AI_MODEL = '@cf/openai/gpt-oss-20b';
const AI_MODEL_FALLBACK = '@cf/ibm-granite/granite-4.0-h-micro';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const SUPPORT_PROMPT = `You are the Elite Quote Flow customer support assistant, available any time. Help customers and service-business owners use Elite Quote Flow. Be concise, warm, and practical. Explain quote links, accepting or declining quotes, deposits, follow-ups, templates, invoice status, exports, and account access. Never claim to access or change an account, payment, quote, or booking. Never ask for passwords, card numbers, signatures, or sensitive personal data. For account-specific or payment problems, explain how to contact the business that sent the quote or use the signed-in account's existing support channel. Do not invent policies, prices, or business-specific commitments. If uncertain, say so and suggest contacting the business directly.`;
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
function productHelpFallback(messages, mode) {
  const question = messages.at(-1)?.content.toLowerCase() || '';
  if (mode === 'draft') return 'I could not reach the drafting model just now. Write a short scope with the service, included work, exclusions, and any assumptions. Avoid adding prices or guarantees you have not confirmed, then try AI drafting again later.';
  if (/quote|proposal|estimate/.test(question) && /create|new|make|send|share|link/.test(question)) return 'To create a quote, sign in and select “New quote.” Add the customer, service, amount, follow-up date, and terms, then save. Use the link action to copy a customer link, or print to save a proposal as PDF.';
  if (/accept|approve|sign|decline/.test(question)) return 'Open the quote link from the business. Review the scope and amount, then enter your name and draw your signature to accept. You can also decline and optionally share a reason. Contact the business directly if you need a change.';
  if (/deposit|payment|pay|invoice|billing/.test(question)) return 'A quote may include a secure deposit link if the business enabled one. For invoice balances, billing changes, refunds, or payment problems, contact the business that sent the quote; this assistant cannot view or change payment records.';
  if (/follow.?up|reminder|calendar/.test(question)) return 'In your signed-in workspace, set a follow-up date on each quote. The dashboard and calendar show what is due; browser reminders can be enabled from the calendar. Email nudges run only when the business has configured email delivery.';
  if (/template/.test(question)) return 'In the signed-in workspace, select “Templates” above the quotes list to save common services, pricing, and terms. Choose a saved template while creating a quote.';
  if (/customer|history|note|recurring|repeat|appointment|booking|schedule/.test(question)) return 'The workspace includes customer history and private notes, recurring-service tracking, and appointment requests on accepted quote links. Appointment dates are requests, not confirmed bookings; the business must confirm availability.';
  if (/export|csv|calendar|contact/.test(question)) return 'Pro users can export quote and customer CSVs, calendar events, contacts, and accounting CSV data from the dashboard. Accounting CSV is a manual export for QuickBooks or Xero import, not a live sync.';
  if (/pro|upgrade|pricing|plan|free/.test(question)) return 'Free includes up to 15 open quotes, quote links, e-sign, follow-ups, and mailto send. Pro adds deposits, invoice collection, branded email, auto reminders, multi-item quotes, branding, AI drafting, exports, teams, referrals, and recurring auto-quotes for $14.99/month or $149.99 lifetime.';
  if (/team|invite|referral/.test(question)) return 'Pro includes team invites from the Teams panel. Referral links earn one month of Pro credit when a referred business upgrades. Apply a code from the Referrals panel or by signing up with a ?ref= link.';
  if (/account|sign.?in|password|login/.test(question)) return 'Use the Sign in link on the landing page. If you cannot access your account, use “Forgot password?” on the sign-in form. Never send your password or payment details in chat.';
  return 'I can help with creating and sharing quotes, accepting a quote, deposits, follow-ups, templates, exports, Pro plans, teams, and recurring services. Tell me which part you are trying to do. For quote-specific changes or payment issues, contact the business that sent the quote.';
}
async function askModel(env, messages) {
  if (env.AI?.run) {
    const configuredModel = String(env.SUPPORT_AI_MODEL || DEFAULT_AI_MODEL).trim();
    const models = [...new Set([configuredModel, DEFAULT_AI_MODEL, AI_MODEL_FALLBACK])];
    let lastError;
    for (const model of models) {
      try {
        const result = await env.AI.run(model, { messages, max_tokens: 400 });
        const reply = result?.response?.trim();
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
  const system = mode === 'draft' ? DRAFT_PROMPT : SUPPORT_PROMPT;
  try {
    const reply = await askModel(env, [{ role: 'system', content: system }, ...messages]);
    if (reply) return json({ reply, mode: 'ai' });
    return json({ reply: productHelpFallback(messages, mode), mode: 'help-fallback' });
  } catch (error) {
    console.error('Support assistant provider failed; using product guidance fallback:', error.message);
    return json({ reply: productHelpFallback(messages, mode), mode: 'help-fallback' });
  }
}
