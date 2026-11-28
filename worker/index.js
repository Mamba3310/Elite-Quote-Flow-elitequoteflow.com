import { onRequestPost as createCheckoutSession } from './create-checkout-session.js';
import { onRequestPost as receiveStripeWebhook } from './stripe-webhook.js';
import { onRequestPost as createPortalSession } from './create-portal-session.js';
import { onPublicQuoteRequest } from './public-quote.js';
import { onAnalyticsRequest } from './site-analytics.js';
import { runScheduled } from './scheduled.js';
import { onDepositCheckout } from './deposit-checkout.js';
import { onConnectOnboarding } from './connect-onboarding.js';
import { onInvoiceCheckout } from './invoice-checkout.js';
import { onSendQuoteEmail } from './send-quote-email.js';
import { onSendCustomerMessage } from './send-customer-message.js';
import { onAuthEmail } from './auth-email.js';
import { onTeamsRequest } from './teams.js';
import { onReferralsRequest } from './referrals.js';
import { onSupportChat } from './support-chat.js';
import { onAccountAccess } from './pro-access.js';
import { onCustomerReview } from './customer-reviews.js';
import { adminPage, onAdminApi } from './admin.js';
import { onPublicBooking } from './public-booking.js';
import { onVisitorLocale } from './visitor-locale.js';
import { onAddressSuggest } from './address-suggest.js';
import { onAccountSlot } from './account-slot.js';

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' }
});

export default {
  async scheduled(_event, env, context) {
    if (env.DISABLE_SCHEDULED_JOBS === 'true') return;
    context.waitUntil(runScheduled(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return new Response(null, { status: 301, headers: { Location: url.toString(), 'Cache-Control': 'public, max-age=300' } });
    }
    const secureHeaders = { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'X-Content-Type-Options': 'nosniff' };
    if (url.pathname === '/admin') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } });
      return new Response(request.method === 'HEAD' ? null : adminPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', ...secureHeaders } });
    }
    if (url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')) return onAdminApi(request, env);
    if (url.pathname === '/api/public-booking') return onPublicBooking(request, env);
    if (url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const response = await env.ASSETS.fetch(new Request(new URL(url.pathname, url.origin), { method: 'GET', headers: request.headers }));
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=3600');
      for (const [name, value] of Object.entries(secureHeaders)) headers.set(name, value);
      return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, statusText: response.statusText, headers });
    }
    const tradePages = new Set(['landscaping', 'plumbing', 'electrical', 'hvac', 'painting', 'house-cleaning', 'roofing', 'handyman', 'pest-control', 'flooring', 'remodeling', 'pressure-washing', 'pool-service', 'moving', 'auto-detailing', 'window-cleaning', 'building-inspection', 'land-surveying', 'architectural-drafting', 'quantity-surveying', 'structural-engineering', 'interior-design', 'home-staging', 'home-energy-assessment', 'furniture-assembly', 'borehole-drilling', 'water-tank-cleaning', 'water-treatment', 'solar-panel-cleaning', 'ev-charger-installation', 'ev-charger-servicing', 'boiler-servicing', 'gas-appliance-servicing', 'commercial-refrigeration', 'commercial-kitchen-repair', 'fire-extinguisher-service', 'fire-alarm-service', 'fire-sprinkler-service', 'lift-maintenance', 'restaurant-hood-cleaning', 'grease-trap-cleaning', 'commercial-laundry-repair', 'water-damage-restoration', 'mold-remediation', 'asbestos-surveys', 'aluminium-windows', 'glass-glazing', 'false-ceilings', 'interlocking-pavers', 'satellite-installation', 'tv-antenna-installation', 'home-theater-installation', 'fiber-optic-installation', 'sign-fabrication', 'awning-installation', 'tailoring-alterations', 'dry-cleaning-contracts', 'upholstery-repair', 'wedding-photography', 'event-videography', 'event-decoration', 'event-rentals', 'catering', 'printing-embroidery', 'courier-delivery-contracts']);
    if (url.pathname === '/trades' || url.pathname === '/landscaping' || url.pathname === '/landscapers' || tradePages.has(url.pathname.slice(1))) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const pageName = url.pathname === '/trades' ? 'trades' : (url.pathname === '/landscapers' ? 'landscaping' : url.pathname.slice(1));
      const assetUrl = new URL(`/${pageName}.html`, url.origin);
      const assetRequest = new Request(assetUrl, { method: 'GET', headers: request.headers });
      const assetResponse = await env.ASSETS.fetch(assetRequest);
      const headers = new Headers(assetResponse.headers);
      for (const [name, value] of Object.entries(secureHeaders)) headers.set(name, value);
      headers.set('Cache-Control', 'public, max-age=300');
      return new Response(request.method === 'HEAD' ? null : assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
    }
    if (url.pathname === '/booking') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } });
      const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="index,follow"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>Request a booking | Elite Quote Flow</title><meta name="description" content="Send Elite Quote Flow a booking request and receive confirmation directly from the business."><style>*{box-sizing:border-box}body{min-height:100vh;margin:0;padding:30px 18px;background:radial-gradient(ellipse at 50% 5%,#23396888 0,transparent 48%),#090c12;color:#eef2f8;font:15px/1.6 system-ui,sans-serif}.card{width:min(700px,100%);margin:4vh auto;padding:clamp(23px,6vw,46px);border:1px solid #30394a;border-radius:17px;background:linear-gradient(145deg,#151a24,#10141b);box-shadow:0 28px 85px #0008}.brand{text-align:center;color:#dec47b;font-size:12px;font-weight:800;letter-spacing:2px}.mark{display:grid;place-items:center;width:50px;height:50px;margin:0 auto 13px;border:1px solid #9b7d3e;border-radius:14px;background:#20291b;color:#dec47b;font-size:14px;font-weight:800}.eyebrow{text-align:center;margin:18px 0 6px;color:#a8bdf5;font-size:10px;font-weight:700;letter-spacing:1.6px}h1{text-align:center;margin:0;color:#f1f4fa;font-size:clamp(29px,6vw,42px);line-height:1.16;letter-spacing:-1px}.intro{text-align:center;max-width:500px;margin:12px auto 25px;color:#aab4c5;font-size:13px}.form{display:grid;grid-template-columns:1fr 1fr;gap:13px}.form label{display:grid;gap:6px;color:#cbd5e1;font-size:11px;font-weight:650}.form input,.form select,.form textarea{width:100%;min-height:41px;padding:9px 11px;border:1px solid #30394a;border-radius:6px;background:#0d1118;color:#edf2fa;font:12px system-ui,sans-serif}.form textarea{min-height:100px;resize:vertical}.wide{grid-column:1/-1}.hint{margin:0;color:#8d9bb0;font-size:10px}.submit{min-height:46px;border:0;border-radius:7px;background:#7195ff;color:white;font-size:12px;font-weight:750;cursor:pointer}.submit:disabled{opacity:.65;cursor:wait}.message{min-height:0;margin:0;color:#b7d8bd;font-size:11px}.message.error{color:#ffb5a9}.trap{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden;clip:rect(0,0,0,0)}.back{display:block;margin-top:21px;text-align:center;color:#aab4c5;font-size:11px;text-decoration:none}.back:hover{color:#fff}@media(max-width:560px){.form{grid-template-columns:1fr}.wide{grid-column:auto}.card{padding:24px 18px}}</style></head><body><main class="card"><div class="mark" aria-hidden="true">EQF</div><div class="brand">ELITE QUOTE FLOW</div><p class="eyebrow">BOOKING REQUEST</p><h1>Let’s find a time that works.</h1><p class="intro">Send your preferred service and date. We’ll contact you directly to confirm availability. Submitting this form does not confirm an appointment.</p><form class="form" id="booking-form"><label>Your name<input name="name" autocomplete="name" maxlength="80" required></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Phone (optional)<input name="phone" type="tel" autocomplete="tel" maxlength="30"></label><label>Service you need<input name="service" maxlength="120" placeholder="What can we help with?" required></label><label>Preferred date<input name="preferred_date" type="date" required></label><label class="wide">Additional details (optional)<textarea name="note" maxlength="1000" placeholder="Tell us anything that will help us prepare"></textarea></label><label class="trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><p class="hint wide">We’ll use your contact details only to respond to this request.</p><button class="submit wide" id="booking-submit" type="submit">Send booking request</button><p id="booking-message" class="message wide" role="status" aria-live="polite"></p></form><a class="back" href="/">← Back to Elite Quote Flow</a></main><script>const form=document.querySelector('#booking-form'),button=document.querySelector('#booking-submit'),message=document.querySelector('#booking-message');form.elements.preferred_date.min=new Date().toISOString().slice(0,10);form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;button.textContent='Sending…';message.textContent='';message.classList.remove('error');try{const payload=Object.fromEntries(new FormData(form));const response=await fetch('/api/public-booking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not submit your request.');form.reset();form.elements.preferred_date.min=new Date().toISOString().slice(0,10);message.textContent=result.message||'Request received. The business will contact you to confirm.'}catch(error){message.classList.add('error');message.textContent=error.message||'Could not submit your request. Please try again.'}finally{button.disabled=false;button.textContent='Send booking request'}});</script></body></html>`;
      return new Response(request.method === 'HEAD' ? null : page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', ...secureHeaders, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } });
    }
    if (url.pathname === '/supabase-config.js') {
      if (request.method !== 'GET') return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET' } });
      if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_ANON_KEY?.trim()) return new Response('Supabase client configuration is unavailable.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
      const config = JSON.stringify({ url: env.SUPABASE_URL.trim().replace(/\/$/, ''), anonKey: env.SUPABASE_ANON_KEY.trim() }).replace(/</g, '\u003c');
      return new Response(`window.QUOTEFlow_SUPABASE_CONFIG=Object.freeze(${config});`, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (url.pathname === '/api/visitor-locale') return onVisitorLocale(request);
    if (url.pathname === '/api/account-access') return onAccountAccess(request, env);
    if (url.pathname === '/api/analytics') return onAnalyticsRequest(request, env);
    if (url.pathname === '/api/support-chat') return onSupportChat(request, env);
    if (url.pathname === '/api/customer-reviews') return onCustomerReview(request, env);
    if (url.pathname === '/api/connect-onboarding') return onConnectOnboarding(request, env);
    if (url.pathname === '/api/deposit-checkout') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return onDepositCheckout(request, env);
    }
    if (url.pathname === '/api/invoice-checkout') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return onInvoiceCheckout(request, env);
    }
    if (url.pathname === '/api/send-customer-message') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return onSendCustomerMessage(request, env);
    }
    if (url.pathname === '/api/send-quote-email') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return onSendQuoteEmail(request, env);
    }
    if (url.pathname === '/api/auth-email') return onAuthEmail(request, env);
    if (url.pathname === '/api/address-suggest') return onAddressSuggest(request);
    if (url.pathname === '/api/account-slot') return onAccountSlot(request, env);
    if (url.pathname === '/api/teams' || url.pathname === '/api/teams/accept') {
      return onTeamsRequest(request, env);
    }
    if (url.pathname === '/api/referrals') {
      return onReferralsRequest(request, env);
    }
    if (url.pathname === '/api/create-checkout-session' || url.pathname === '/api/create-monthly-checkout-session') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return createCheckoutSession({ request, env });
    }
    if (url.pathname === '/api/create-portal-session') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return createPortalSession({ request, env });
    }
    const publicQuoteMatch = url.pathname.match(/^\/q\/([^/]+)(?:\/booking)?$/);
    if (publicQuoteMatch) return onPublicQuoteRequest(request, env, publicQuoteMatch[1]);
    if (url.pathname === '/api/stripe-webhook') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      return receiveStripeWebhook({ request, env });
    }
    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);
    for (const [name, value] of Object.entries(secureHeaders)) headers.set(name, value);
    return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
  }
};
