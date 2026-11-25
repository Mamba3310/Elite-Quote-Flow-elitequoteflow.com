import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
import { readFile } from 'node:fs/promises';
const ownerToken = `header.${Buffer.from(JSON.stringify({ aal: 'aal2' })).toString('base64url')}.signature`;
const baseEnv = { SUPABASE_URL: 'https://supabase.example', SUPABASE_ANON_KEY: 'public-key', STRIPE_SECRET_KEY: 'stripe-secret', STRIPE_PRO_PAYMENT_LINK: 'https://buy.stripe.com/test_lifetime', STRIPE_PRO_MONTHLY_PAYMENT_LINK: 'https://buy.stripe.com/test_monthly', STRIPE_PRO_LIFETIME_PAYMENT_LINK_ID: 'plink_lifetime', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key', STRIPE_WEBHOOK_SECRET: 'whsec_test' };
const jsonRequest = (url, body, method = 'POST', headers = {}) => new Request(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body) });
async function withMockedFetch(mock, run) { const originalFetch = globalThis.fetch; globalThis.fetch = mock; try { await run(); } finally { globalThis.fetch = originalFetch; } }

test('HTTP requests redirect to HTTPS and HTTPS responses include HSTS',async()=>{
 const response=await worker.fetch(new Request('http://elitequoteflow.com/path?x=1'),{});assert.equal(response.status,301);assert.equal(response.headers.get('location'),'https://elitequoteflow.com/path?x=1');
 await withMockedFetch(async()=>new Response('site',{status:200,headers:{'Content-Type':'text/html'}}),async()=>{const secure=await worker.fetch(new Request('https://elitequoteflow.com/'),{ASSETS:{fetch:async request=>new Response('site',{status:200,headers:{'Content-Type':'text/html'}})}});assert.equal(secure.status,200);assert.match(secure.headers.get('strict-transport-security'),/max-age=31536000/);assert.equal(secure.headers.get('x-content-type-options'),'nosniff');});
});

test('admin portal is served as a private no-store page with owner tools',async()=>{
 const response=await worker.fetch(new Request('https://elitequoteflow.com/admin'),baseEnv);const body=await response.text();assert.equal(response.status,200);assert.match(body,/customer reviews/i);assert.match(body,/booking requests/i);assert.match(body,/recurring services/i);assert.match(body,/recent quote activity/i);assert.match(body,/admin-login-form/);assert.match(body,/signInWithPassword/);assert.match(body,/summary-quotes/);assert.match(body,/Follow-ups due/);assert.match(body,/Deposits not paid/);assert.match(body,/Most viewed quotes/);assert.match(body,/Win rate/);assert.match(body,/id="calendar"/);assert.match(body,/id="timeline"/);assert.match(body,/Export filtered CSV/);assert.match(body,/Signed in as/);assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('x-frame-options'),/DENY/);
});

test('admin access shows missing owner configuration without leaking the configured email',async()=>{
 const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin'),baseEnv);assert.equal(response.status,503);const message=(await response.json()).error;assert.match(message,/OWNER_ANALYTICS_EMAILS/);assert.doesNotMatch(message,/owner@example\.com/);
});

test('admin API distinguishes missing, expired, and non-owner sessions',async()=>{
 const missing=await worker.fetch(new Request('https://elitequoteflow.com/api/admin'),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(missing.status,401);assert.match((await missing.json()).error,/Sign in/);
 await withMockedFetch(async()=>new Response('expired',{status:401}),async()=>{const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:'Bearer expired-token'}}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(response.status,401);assert.match((await response.json()).error,/expired/);});
 await withMockedFetch(async()=>Response.json({email:'other@example.com'}),async()=>{const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:'Bearer user-token'}}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(response.status,403);assert.match((await response.json()).error,/not configured as the admin owner/i);});
});

test('admin API allows multiple owner emails configured by OWNER_ANALYTICS_EMAILS',async()=>{
 await withMockedFetch(async(url)=>{if(String(url).endsWith('/auth/v1/user'))return Response.json({email:'sbobick1948@gmail.com'});if(String(url).includes('/rest/v1/'))return Response.json([]);assert.fail(`Unexpected request ${url}`);},async()=>{const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:`Bearer ${ownerToken}`}}),{...baseEnv,OWNER_ANALYTICS_EMAILS:'clearvest@workmail.com,sbobick1948@gmail.com'});assert.equal(response.status,200);});
});

test('admin API requires an aal2 authenticator session before owner data access',async()=>{
 const aal1=`header.${Buffer.from(JSON.stringify({aal:'aal1'})).toString('base64url')}.signature`;
 await withMockedFetch(async url=>{if(String(url).endsWith('/auth/v1/user'))return Response.json({email:'owner@example.com'});assert.fail(`Admin data must not be queried before MFA: ${url}`);},async()=>{
  const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:`Bearer ${aal1}`}}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(response.status,403);assert.match((await response.json()).error,/Authenticator MFA is required/);
 });
});

test('admin MFA challenge view and authenticator enrollment controls are present',async()=>{
 const response=await worker.fetch(new Request('https://elitequoteflow.com/admin'),baseEnv);const body=await response.text();assert.match(body,/auth\.mfa\.enroll\(\{factorType:'totp'/);assert.match(body,/auth\.mfa\.challenge/);assert.match(body,/auth\.mfa\.verify/);assert.match(body,/mfa-qr/);assert.match(body,/beginTotpEnrollment/);
});

test('admin API allows explicitly listed owner emails and returns owner dashboard data',async()=>{
 const calls=[];
 await withMockedFetch(async(url,options={})=>{const target=String(url);calls.push(target);if(target.endsWith('/auth/v1/user'))return Response.json({email:'OWNER@example.com'});if(target.includes('/rest/v1/')){assert.equal(options.headers.apikey,'service-role-key');assert.equal(options.headers.Authorization,undefined);if(!target.includes('/admin_audit_log'))assert.equal(options.headers.Prefer,undefined);}if(target.includes('/admin_audit_log?'))return Response.json([]);if(target.includes('/customer_reviews?'))return Response.json([{id:'r1'}]);if(target.includes('/quote_bookings?'))return Response.json([{id:'b1'}]);if(target.includes('/public_booking_requests?'))return Response.json([{id:'pb1'}]);if(target.includes('/recurring_service_plans?'))return Response.json([{id:'p1'}]);if(target.includes('/rest/v1/quotes?'))return Response.json([{id:'q1'}]);assert.fail(`Unexpected request ${target}`);},async()=>{
  const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:`Bearer ${ownerToken}`}}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'other@example.com, owner@example.com'});assert.equal(response.status,200);const data=await response.json();assert.equal(data.reviews.length,1);assert.equal(data.bookings.length,1);assert.equal(data.recurring.length,1);assert.equal(data.quotes.length,1);
 });assert.equal(calls.filter(target=>target.endsWith('/auth/v1/user')).length,1);
});

test('admin dashboard reports missing optional booking migration and preserves other sections',async()=>{
 await withMockedFetch(async(url)=>{const target=String(url);if(target.endsWith('/auth/v1/user'))return Response.json({email:'owner@example.com'});if(target.includes('/public_booking_requests?'))return Response.json({code:'PGRST205',message:'Could not find the table public_booking_requests'},{status:404});if(target.includes('/customer_reviews?'))return Response.json([{id:'review-1'}]);if(target.includes('/quote_bookings?'))return Response.json([]);if(target.includes('/recurring_service_plans?'))return Response.json([]);if(target.includes('/rest/v1/quotes?'))return Response.json([]);if(target.includes('/admin_audit_log'))return Response.json([]);assert.fail(`Unexpected request ${target}`);},async()=>{
  const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:`Bearer ${ownerToken}`}}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(response.status,200);const data=await response.json();assert.equal(data.reviews.length,1);assert.deepEqual(data.missingMigrations,['supabase-public-bookings.sql']);
 });
});

test('admin diagnostics preserve Supabase authentication response instead of assuming every 401 is a bad key',async()=>{
 await withMockedFetch(async(url)=>{const target=String(url);if(target.endsWith('/auth/v1/user'))return Response.json({email:'owner@example.com'});if(target.includes('/customer_reviews?'))return Response.json({code:'PGRST301',message:'Invalid API key'}, {status:401});return Response.json([]);},async()=>{const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:`Bearer ${ownerToken}`}}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});const result=await response.json();assert.match(result.errors[0],/HTTP 401 \(PGRST301: Invalid API key/);assert.match(result.errors[0],/key-type=unrecognized key format/);});
 await withMockedFetch(async(url)=>{const target=String(url);if(target.endsWith('/auth/v1/user'))return Response.json({email:'owner@example.com'});if(target.includes('/customer_reviews?'))return Response.json({code:'42501',message:'permission denied for table'}, {status:401});return Response.json([]);},async()=>{const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:`Bearer ${ownerToken}`}}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});const result=await response.json();assert.match(result.errors[0],/HTTP 401 \(42501: permission denied for table/);});
});

test('admin dashboard exposes non-schema upstream errors per dataset',async()=>{
 await withMockedFetch(async(url)=>{const target=String(url);if(target.endsWith('/auth/v1/user'))return Response.json({email:'owner@example.com'});if(target.includes('/admin_audit_log?'))return Response.json([]);if(target.includes('/admin_audit_log'))return Response.json([]);if(target.includes('/customer_reviews?'))return new Response('storage unavailable',{status:503,headers:{'Content-Type':'text/plain','sb-request-id':'req-test-123'}});return Response.json([]);},async()=>{const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:`Bearer ${ownerToken}`}}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(response.status,200);const data=await response.json();assert.match(data.errors[0],/reviews: Supabase GET customer_reviews returned HTTP 503 \(storage unavailable; content-type=text\/plain; key-type=unrecognized key format; project=supabase\.example; request-id=req-test-123\)/);});
 await withMockedFetch(async(url)=>{const target=String(url);if(target.endsWith('/auth/v1/user'))return Response.json({email:'owner@example.com'});if(target.includes('/admin_audit_log?'))return Response.json([]);if(target.includes('/admin_audit_log'))return Response.json([]);if(target.includes('/customer_reviews?'))return new Response('storage unavailable',{status:503});return Response.json([]);},async()=>{const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:`Bearer ${ownerToken}`}}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(response.status,200);const data=await response.json();assert.match(data.errors[0],/reviews: Supabase GET customer_reviews returned HTTP 503/);});
});

test('admin API returns safe per-dataset Supabase diagnostics to the owner',async()=>{
 await withMockedFetch(async(url)=>{const target=String(url);if(target.endsWith('/auth/v1/user'))return Response.json({email:'owner@example.com'});if(target.includes('/public_booking_requests?'))return Response.json({code:'PGRST205',message:'Could not find the table public_booking_requests'},{status:404});if(target.includes('/customer_reviews?'))return Response.json([]);if(target.includes('/quote_bookings?'))return Response.json([]);if(target.includes('/recurring_service_plans?'))return Response.json([]);if(target.includes('/rest/v1/quotes?'))return Response.json([]);if(target.includes('/admin_audit_log?'))return Response.json([]);assert.fail(`Unexpected ${target}`);},async()=>{
  const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:`Bearer ${ownerToken}`}}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(response.status,200);const data=await response.json();assert.deepEqual(data.errors,[]);assert.deepEqual(data.missingMigrations,['supabase-public-bookings.sql']);
 });
 await withMockedFetch(async(url)=>{const target=String(url);if(target.endsWith('/auth/v1/user'))return Response.json({email:'owner@example.com'});if(target.includes('/customer_reviews?'))return Response.json([]);if(target.includes('/quote_bookings?'))return Response.json([]);if(target.includes('/public_booking_requests?'))return new Response(JSON.stringify({code:'42501',message:'permission denied for table'}),{status:403});if(target.includes('/recurring_service_plans?'))return Response.json([]);if(target.includes('/rest/v1/quotes?'))return Response.json([]);if(target.includes('/admin_audit_log'))return Response.json([]);assert.fail(`Unexpected ${target}`);},async()=>{
  const response=await worker.fetch(new Request('https://elitequoteflow.com/api/admin',{headers:{Authorization:`Bearer ${ownerToken}`}}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});const data=await response.json();assert.match(data.errors[0],/publicBookings: Supabase GET public_booking_requests returned HTTP 403/);
 });
});

test('admin mutation returns sanitized Supabase failure detail only to authenticated owner',async()=>{
 const id='550e8400-e29b-41d4-a716-446655440000';
 await withMockedFetch(async(url)=>{if(String(url).endsWith('/auth/v1/user'))return Response.json({email:'owner@example.com'});return new Response(JSON.stringify({code:'42501',message:'permission denied on customer_reviews'}),{status:403});},async()=>{
  const response=await worker.fetch(jsonRequest('https://elitequoteflow.com/api/admin/reviews',{id,status:'hidden'},'PATCH',{Authorization:`Bearer ${ownerToken}`}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(response.status,503);assert.match((await response.json()).error,/customer_reviews returned HTTP 403/);
 });
});

test('admin review moderation validates action and uses authenticated owner data',async()=>{
 const token='550e8400-e29b-41d4-a716-446655440000';let patch;
 await withMockedFetch(async(url,options={})=>{const target=String(url);if(target.endsWith('/auth/v1/user'))return Response.json({email:'owner@example.com'});if(target.includes('/admin_audit_log'))return Response.json([]);patch={url:target,body:JSON.parse(options.body)};return Response.json([{id:token}]);},async()=>{
  const response=await worker.fetch(jsonRequest('https://elitequoteflow.com/api/admin/reviews',{id:token,status:'hidden'},'PATCH',{Authorization:`Bearer ${ownerToken}`}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(response.status,200);
 });assert.match(patch.url,/customer_reviews\?id=eq\./);assert.equal(patch.body.status,'hidden');
});

test('admin dashboard presents country pageview share and quote decisions for customer-demand insight',async()=>{
 const response=await worker.fetch(new Request('https://elitequoteflow.com/admin'),baseEnv);const body=await response.text();assert.match(body,/Visitor country demand · last 30 days/);assert.match(body,/Aggregate pageviews by country, including anonymous visitors/);assert.match(body,/local customer needs/);assert.match(body,/visitor-country-total/);assert.match(body,/country-insights/);assert.match(body,/function renderCountryInsights/);assert.match(body,/decisionsForCountry\.accepted/);assert.match(body,/country unavailable/);assert.match(body,/No pageview events yet/);
});

test('admin quote status control is owner-protected and records audited updates',async()=>{
 const token='550e8400-e29b-41d4-a716-446655440000';let update;
 await withMockedFetch(async(url,options={})=>{const target=String(url);if(target.endsWith('/auth/v1/user'))return Response.json({email:'owner@example.com'});if(target.includes('/rest/v1/quotes?id=eq.')){update={url:target,body:JSON.parse(options.body)};return Response.json([{id:token}]);}if(target.includes('/admin_audit_log'))return Response.json([]);assert.fail(`Unexpected request ${target}`);},async()=>{
  const response=await worker.fetch(jsonRequest('https://elitequoteflow.com/api/admin/quotes',{id:token,status:'won'},'PATCH',{Authorization:`Bearer ${ownerToken}`}),{...baseEnv,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(response.status,200);assert.deepEqual(await response.json(),{updated:true});
 });assert.match(update.url,/quotes\?id=eq\./);assert.equal(update.body.status,'won');assert.ok(update.body.status_changed_at);assert.ok(update.body.updated_at);
});

test('sidebar promotes the AI assistant without the redundant growth slogan card',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');const css=await readFile(new URL('../public/ai-assistant.css',import.meta.url),'utf8');
 assert.match(html,/id="support-launch"/);assert.match(html,/Elite Quote Flow AI/);assert.doesNotMatch(html,/Small steps, steady growth|Keep every estimate moving with a thoughtful follow-up/);assert.match(css,/\.sidebar-bottom\{margin-top:auto/);assert.match(css,/NEED A HAND/);
});

test('calculator currency control offers supported currencies and updates results and estimate currency',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(html,/<select id="calc-currency" class="calculator-badge" aria-label="Calculator currency"><\/select>/);assert.match(html,/id="calc-currency-symbol-rate"/);assert.match(html,/id="calc-currency-symbol-materials"/);
 assert.match(app,/\$\('#calc-currency'\)\.innerHTML = currencyOptions/);assert.match(app,/addEventListener\('change', event => setCalculatorCurrency\(event\.currentTarget\.value\)\)/);assert.match(app,/formatMoney\(price, calculatorCurrency\)/);assert.match(app,/form\.elements\.currency\.value = calculatorCurrency/);assert.match(app,/CALCULATOR_CURRENCY_KEY/);assert.match(app,/\['USD', 'EUR', 'GBP', 'NGN'/);
});

test('Nigerian defaults, optional tax ID profile, and tax-aware invoice exports are wired up',async()=>{
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');const schema=await readFile(new URL('../supabase-schema.sql',import.meta.url),'utf8');const migration=await readFile(new URL('../supabase-sale-ready-migration.sql',import.meta.url),'utf8');
 assert.ok(app.includes("'Africa/Lagos'"));assert.ok(app.includes("endsWith('-NG') ? 'NGN' : 'USD'"));assert.ok(html.includes('name="taxId" maxlength="32"'));assert.ok(app.includes('seller_tax_id: profile.taxId'));assert.ok(app.includes('tax_amount: (taxableSubtotal * taxRate / 100).toFixed(2)'));assert.ok(schema.includes("tax_id text not null default ''"));assert.ok(migration.includes("add column if not exists tax_id text not null default ''"));
});

test('Nigerian naira is available for quotes, templates, and calculator pricing',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/\['USD', 'EUR', 'GBP', 'NGN'/);assert.match(app,/currencyOptions/);assert.match(app,/formatMoney\(price, calculatorCurrency\)/);assert.match(app,/Intl\.NumberFormat\(undefined, \{ style: 'currency', currency: code/);assert.match(html,/id="calc-currency"/);assert.match(html,/class="currency-select"/);
});

test('owner analytics reports aggregate quote views and decisions by country',async()=>{
 const queries=[];const analytics={writeDataPoint(){},query:async sql=>{queries.push(sql);if(sql.includes("INTERVAL '5' MINUTE"))return {data:[{visits:3}]};if(sql.includes('AS hour'))return {data:[{hour:'2025-01-01 10:00:00',visits:5}]};if(sql.includes('AS path'))return {data:[{path:'/',visits:9}]};if(sql.includes('SELECT SUM(double1) AS visits'))return {data:[{visits:18}]};if(sql.includes('AS source'))return {data:[{source:'example.com',visits:7}]};if(sql.includes('blob3 AS country, blob5 AS decision'))return {data:[{country:'CA',decision:'accepted',decisions:2}]};if(sql.includes('AS country'))return {data:[{country:'CA',visits:4},{country:'Unknown',visits:2}]};if(sql.includes('AS views'))return {data:[{views:6}]};return {data:[{decision:'accepted',decisions:2},{decision:'declined',decisions:1}]};}};
 await withMockedFetch(async url=>{assert.ok(String(url).endsWith('/auth/v1/user'));return Response.json({email:'owner@example.com'});},async()=>{
  const response=await worker.fetch(new Request('https://elitequoteflow.com/api/analytics',{headers:{Authorization:`Bearer ${ownerToken}`}}),{...baseEnv,OWNER_ANALYTICS_EMAILS:'owner@example.com',SITE_ANALYTICS:analytics});assert.equal(response.status,200);const data=await response.json();assert.equal(data.visits24h,18);assert.equal(data.visits5m,3);assert.deepEqual(data.hourly,[{hour:'2025-01-01 10:00:00',visits:5}]);assert.deepEqual(data.pages,[{path:'/',visits:9}]);assert.equal(data.quoteViews24h,6,JSON.stringify(data));assert.deepEqual(data.decisions24h,{accepted:2,declined:1});assert.deepEqual(data.decisionsByCountry,[{country:'CA',decision:'accepted',count:2}]);assert.deepEqual(data.countries,[{name:'CA',visits:4},{name:'Unknown',visits:2}]);
 });assert.equal(queries.length,9);assert.ok(queries.every(sql=>sql.includes('INTERVAL')||sql.includes("timestamp > NOW()")));
});

test('site traffic chart is on the owner dashboard and renders 24 hourly buckets for all visitors',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
 assert.match(html,/id="analytics-traffic-chart"/);assert.match(html,/including visitors without accounts/);assert.match(html,/total site traffic/i);assert.match(app,/Array\.from\(\{ length: 24 \}/);assert.match(app,/renderTrafficChart\(data\)/);assert.match(app,/analytics-traffic-total/);assert.match(css,/\.analytics-traffic-bar\{/);assert.match(app,/byHour\.get\(hour\.getTime\(\)\) \|\| 0/);
});

test('public page visits are counted without sign-in and owner traffic is excluded',async()=>{
 const events=[];let authCalls=0;const env={SITE_ANALYTICS:{writeDataPoint:event=>events.push(event)},SUPABASE_URL:baseEnv.SUPABASE_URL,SUPABASE_ANON_KEY:baseEnv.SUPABASE_ANON_KEY};
 await withMockedFetch(async url=>{if(String(url).endsWith('/auth/v1/user')){authCalls++;return Response.json({email:'owner@example.com'});}assert.fail(`Unexpected upstream ${url}`);},async()=>{
  const anonymous=await worker.fetch(jsonRequest('https://elitequoteflow.com/api/analytics',{event:'pageview',path:'/pricing',referrer:'https://search.example/'}),env);assert.equal(anonymous.status,202);
  const owner=await worker.fetch(jsonRequest('https://elitequoteflow.com/api/analytics',{event:'pageview',path:'/dashboard',referrer:''},'POST',{Authorization:`Bearer ${ownerToken}`}),{...env,OWNER_ANALYTICS_EMAIL:'owner@example.com'});assert.equal(owner.status,202);
 });assert.equal(authCalls,1);assert.equal(events.length,1);assert.deepEqual(events[0].blobs.slice(0,4),['/pricing','search.example','Unknown','pageview']);
});

test('public quote views and successful decisions write anonymized analytics events',async()=>{
 const token='550e8400-e29b-41d4-a716-446655440000',events=[],env={...baseEnv,SITE_ANALYTICS:{writeDataPoint:event=>events.push(event)}};
 await withMockedFetch(async url=>{assert.ok(String(url).includes('/rest/v1/rpc/'));return String(url).endsWith('/get_public_quote_by_token')?Response.json({customer:'Alex',service:'Repair',amount:100,status:'sent'}):Response.json({received:true,status:'accepted'});},async()=>{
  const view=await worker.fetch(new Request(`https://app.example/q/${token}`),env);assert.equal(view.status,200);
  const accept=await worker.fetch(jsonRequest(`https://app.example/q/${token}`,{action:'accept',name:'Alex',signature:'signature'}),env);assert.equal(accept.status,200);
 });assert.equal(events.length,2);assert.deepEqual(events[0].blobs.slice(0,1),['/q/:quote']);assert.equal(events[0].blobs[3],'quote_view');assert.equal(events[1].blobs[3],'quote_decision');assert.equal(events[1].blobs[4],'accepted');
});

test('booking page submits customer requests internally rather than redirecting to a third party',async()=>{
 const response=await worker.fetch(new Request('https://elitequoteflow.com/booking'),baseEnv);const body=await response.text();assert.equal(response.status,200);assert.match(body,/id="booking-form"/);assert.match(body,/api\/public-booking/);assert.doesNotMatch(body,/explee\.com/);assert.match(body,/does not confirm an appointment/);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 const head=await worker.fetch(new Request('https://elitequoteflow.com/booking',{method:'HEAD'}),baseEnv);assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('public booking endpoint validates and stores a request through the submit RPC',async()=>{
 const valid={name:'Casey Customer',email:'casey@example.com',phone:'555-1234',service:'Cleaning',preferred_date:new Date(Date.now()+10*86400000).toISOString().slice(0,10),note:'Afternoon',website:''};let call;
 await withMockedFetch(async(url,options)=>{call={url:String(url),options,body:JSON.parse(options.body)};return Response.json({received:true,request_id:'booking-1'});},async()=>{
  const response=await worker.fetch(jsonRequest('https://elitequoteflow.com/api/public-booking',valid,'POST',{Origin:'https://elitequoteflow.com','CF-Connecting-IP':'203.0.113.7'}),{SUPABASE_URL:baseEnv.SUPABASE_URL,SUPABASE_ANON_KEY:baseEnv.SUPABASE_ANON_KEY,BOOKING_RATE_LIMITER:{limit:async({key})=>({success:key==='203.0.113.7'})}});
  assert.equal(response.status,201);assert.equal((await response.json()).received,true);
 });assert.ok(call.url.endsWith('/rpc/submit_public_booking_request'));assert.equal(call.options.headers.apikey,'public-key');assert.equal(call.body.p_customer_email,valid.email);assert.equal(call.body.p_service,valid.service);
});

test('public booking endpoint rejects invalid dates and foreign origins',async()=>{
 const payload={name:'Casey',email:'casey@example.com',service:'Cleaning',preferred_date:'2000-01-01'};
 const badDate=await worker.fetch(jsonRequest('https://elitequoteflow.com/api/public-booking',payload),{SUPABASE_URL:baseEnv.SUPABASE_URL,SUPABASE_ANON_KEY:baseEnv.SUPABASE_ANON_KEY});assert.equal(badDate.status,400);
 const badOrigin=await worker.fetch(jsonRequest('https://elitequoteflow.com/api/public-booking',{...payload,preferred_date:new Date(Date.now()+86400000).toISOString().slice(0,10)},'POST',{Origin:'https://evil.example'}),{SUPABASE_URL:baseEnv.SUPABASE_URL,SUPABASE_ANON_KEY:baseEnv.SUPABASE_ANON_KEY});assert.equal(badOrigin.status,403);
});

test('valid customer reviews publish automatically while validation and rate limiting remain active',async()=>{
 const good={name:'Casey Example',email:'casey@example.com',business:'Casey Services',rating:'5',review:'The follow-up calendar helps me stay organized.'};
 const invalid=await worker.fetch(jsonRequest('https://app.example/api/customer-reviews',{...good,rating:'8'}),{SUPABASE_URL:baseEnv.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:baseEnv.SUPABASE_SERVICE_ROLE_KEY});assert.equal(invalid.status,400);
 const denied=await worker.fetch(jsonRequest('https://app.example/api/customer-reviews',good,'POST',{Origin:'https://attacker.example'}),{SUPABASE_URL:baseEnv.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:baseEnv.SUPABASE_SERVICE_ROLE_KEY});assert.equal(denied.status,403);
 let saved,limits=0;
 const RATE={limit:async({key})=>{assert.equal(key,'203.0.113.8');limits++;return {success:true};}};
 await withMockedFetch(async(url,options)=>{assert.ok(String(url).endsWith('/rpc/submit_customer_review'));saved=JSON.parse(options.body);assert.equal(options.headers.apikey,'public-key');return Response.json({received:true,message:'published'});},async()=>{
  const response=await worker.fetch(jsonRequest('https://app.example/api/customer-reviews',good,'POST',{Origin:'https://elitequoteflow.com','CF-Connecting-IP':'203.0.113.8'}),{SUPABASE_URL:baseEnv.SUPABASE_URL,SUPABASE_ANON_KEY:baseEnv.SUPABASE_ANON_KEY,REVIEW_RATE_LIMITER:RATE});assert.equal(response.status,201);assert.equal((await response.json()).received,true);
 });
 assert.equal(saved.p_rating,5);assert.equal(saved.p_customer_email,'casey@example.com');assert.equal(limits,1);
});

test('published customer reviews endpoint returns public fields without email addresses',async()=>{
 let requestUrl;
 await withMockedFetch(async(url,options)=>{requestUrl={url:String(url),body:JSON.parse(options.body)};assert.equal(options.headers.apikey,'public-key');return Response.json([{customer_name:'Casey',business_name:'Casey Services',rating:5,review_text:'Helpful tool',submitted_at:'2025-01-01T00:00:00Z'}]);},async()=>{
  const response=await worker.fetch(new Request('https://app.example/api/customer-reviews'),{SUPABASE_URL:baseEnv.SUPABASE_URL,SUPABASE_ANON_KEY:baseEnv.SUPABASE_ANON_KEY});assert.equal(response.status,200);const body=await response.json();assert.equal(body.reviews.length,1);assert.equal(body.reviews[0].customer_name,'Casey');assert.equal('customer_email' in body.reviews[0],false);
 });
 assert.match(requestUrl.url,/rpc\/get_published_customer_reviews$/);assert.equal(requestUrl.body.p_limit,12);
});

test('duplicate review submissions receive a conflict response',async()=>{
 const form={name:'Casey Example',email:'casey@example.com',business:'Casey Services',rating:'5',review:'The follow-up calendar helps me stay organized.'};
 await withMockedFetch(async()=>Response.json({received:false,reason:'duplicate'}),async()=>{const response=await worker.fetch(jsonRequest('https://app.example/api/customer-reviews',form),{SUPABASE_URL:baseEnv.SUPABASE_URL,SUPABASE_ANON_KEY:baseEnv.SUPABASE_ANON_KEY});assert.equal(response.status,409);});
});

test('review honeypot silently accepts bots without database writes',async()=>{
 const response=await worker.fetch(jsonRequest('https://app.example/api/customer-reviews',{website:'spam'}),{});assert.equal(response.status,202);assert.equal((await response.json()).received,true);
});

test('landing page shows an honest sample preview, signup CTAs, interactive value estimator, steps, and current plan path',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');const css=await readFile(new URL('../public/landing-refresh.css',import.meta.url),'utf8');
 assert.match(css,/\.lead-calculator/);assert.match(html,/Send the quote/);assert.match(html,/PRODUCT PREVIEW/);assert.match(html,/id="lead-calc-quotes"/);assert.match(html,/id="lead-calc-amount"/);assert.match(html,/id="lead-calc-result"/);assert.match(html,/id="landing-steps-cta"/);assert.match(html,/id="landing-pricing-cta"/);assert.match(html,/FREE TO START/);assert.match(html,/landing-pricing-grid/);assert.match(html,/Stripe deposits and invoice balance collection/);assert.match(html,/No sample or invented reviews are displayed/);assert.doesNotMatch(html,/Prototype preview/);assert.match(app,/updateLeadEstimate/);assert.match(app,/landing-calc-cta/);assert.match(app,/landing-pricing-cta/);assert.match(app,/Create an account/);
 assert.match(html,/id="customer-review-form"/);assert.match(html,/id="published-customer-reviews"/);assert.match(html,/id="team-panel"/);assert.match(html,/id="referral-panel"/);assert.match(app,/api\/customer-reviews/);assert.match(app,/api\/send-quote-email/);assert.match(app,/api\/invoice-checkout/);assert.match(app,/FREE_OPEN_QUOTE_LIMIT/);assert.match(app,/review\.review_text/);assert.doesNotMatch(app,/review\.customer_email/);
});

test('dashboard offers distinct monthly and lifetime purchase options',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(html,/id="upgrade-monthly-link"[^>]*data-plan="monthly"/);
 assert.match(html,/id="upgrade-lifetime-link"[^>]*data-plan="lifetime"/);
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/\/api\/create-monthly-checkout-session/);
 assert.match(app,/\/api\/create-checkout-session/);
});

test('24/7 AI support endpoint validates methods, messages, and calls the configured model', async () => {
 const missing=await worker.fetch(new Request('https://app.example/api/support-chat',{method:'GET'}),{});assert.equal(missing.status,405);
 const malformed=await worker.fetch(jsonRequest('https://app.example/api/support-chat',{messages:[{role:'user',content:'x'.repeat(2001)}]}),{});assert.equal(malformed.status,400);
 let requestMessages;
 const AI={run:async(_model,payload)=>{requestMessages=payload.messages;return {response:'Use the New quote button to get started.'};}};
 const response=await worker.fetch(jsonRequest('https://app.example/api/support-chat',{messages:[{role:'user',content:'How do I create a quote?'}]}),{AI});
 assert.equal(response.status,200);assert.equal((await response.json()).reply,'Use the New quote button to get started.');assert.match(requestMessages[0].content,/available any time/);assert.equal(requestMessages.at(-1).content,'How do I create a quote?');
});

test('AI drafting reports fallback instead of treating fallback guidance as generated scope text',async()=>{
 const response=await worker.fetch(jsonRequest('https://app.example/api/support-chat',{mode:'draft',messages:[{role:'user',content:'Replace the faucet.'}]}),{});const result=await response.json();assert.equal(response.status,200);assert.equal(result.mode,'help-fallback');assert.match(result.reply,/could not reach the drafting model/i);
});

test('AI provider failures fall back to relevant always-available product guidance',async()=>{
 const AI={run:async()=>{throw new Error('model unavailable');}};
 const response=await worker.fetch(jsonRequest('https://app.example/api/support-chat',{messages:[{role:'user',content:'How do I accept a quote?'}]}),{AI});
 assert.equal(response.status,200);const body=await response.json();assert.equal(body.mode,'help-fallback');assert.match(body.reply,/draw your signature/i);
});

test('AI quote drafting reads Workers AI chat-completion text', async () => {
 const AI={run:async()=>({choices:[{message:{content:'Replace the faucet, supply the cartridge, and test for leaks.'}}]})};
 const response=await worker.fetch(jsonRequest('https://app.example/api/support-chat',{mode:'draft',messages:[{role:'user',content:'Replace faucet'}]}),{AI});
 const result=await response.json();
 assert.equal(response.status,200);assert.equal(result.mode,'ai');assert.equal(result.reply,'Replace the faucet, supply the cartridge, and test for leaks.');
});

test('AI quote drafting uses the current default model, scope prompt, and returns draft copy', async () => {
 let requestMessages,requestedModel;
 const AI={run:async(model,payload)=>{requestedModel=model;requestMessages=payload.messages;return {response:'Replace the kitchen faucet and test for leaks.'};}};
 const response=await worker.fetch(jsonRequest('https://app.example/api/support-chat',{mode:'draft',messages:[{role:'user',content:'Replace faucet'}]}),{AI});
 assert.equal(response.status,200);assert.equal((await response.json()).reply,'Replace the kitchen faucet and test for leaks.');assert.equal(requestedModel,'@cf/openai/gpt-oss-20b');assert.match(requestMessages[0].content,/Do not invent prices/);
});

test('AI drafting retries supported models when the selected Workers AI model fails',async()=>{
 const models=[];const AI={run:async(model)=>{models.push(model);if(models.length<3)throw new Error('model unavailable');return {response:'Replace faucet and test for leaks.'};}};
 const response=await worker.fetch(jsonRequest('https://app.example/api/support-chat',{mode:'draft',messages:[{role:'user',content:'Replace faucet'}]}),{AI,SUPPORT_AI_MODEL:'@cf/unavailable/model'});const result=await response.json();assert.equal(result.mode,'ai');assert.equal(result.reply,'Replace faucet and test for leaks.');assert.deepEqual(models,['@cf/unavailable/model','@cf/openai/gpt-oss-20b','@cf/ibm-granite/granite-4.0-h-micro']);
});

test('mobile navigation exposes a visible close control and dismisses accessibly',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
 assert.match(html,/aria-label="Open navigation" aria-expanded="false" aria-controls="main-sidebar"/);assert.match(html,/class="sidebar" id="main-sidebar"/);assert.match(html,/class="menu-close-icon"[^>]*>×/);assert.match(app,/setMobileNavigation\(!document\.body\.classList\.contains\('nav-open'\)\)/);assert.match(app,/event\.key === 'Escape'/);assert.match(app,/event\.target\.closest\('#main-sidebar, #mobile-menu'\)/);assert.match(css,/body\.nav-open \.mobile-menu \.menu-close-icon\{display:block\}/);
});

test('support endpoint gives useful product guidance when no AI provider is configured',async()=>{
 const response=await worker.fetch(jsonRequest('https://app.example/api/support-chat',{messages:[{role:'user',content:'How do I create a quote?'}]}),{});assert.equal(response.status,200);const body=await response.json();assert.equal(body.mode,'help-fallback');assert.match(body.reply,/New quote/);
});

test('sale-ready migration has required upgrade fields and protected RPCs', async () => {
 const sql = await readFile(new URL('../supabase-sale-ready-migration.sql', import.meta.url), 'utf8');
 const constraints = await readFile(new URL('../supabase-sale-ready-constraints.sql', import.meta.url), 'utf8');
 const rpcs = await readFile(new URL('../supabase-sale-ready-rpcs.sql', import.meta.url), 'utf8');
 const index = await readFile(new URL('../supabase-sale-ready-index.sql', import.meta.url), 'utf8');
 for (const field of ['line_items','subtotal_amount','tax_rate','discount_amount','deposit_percent','view_count','accepted_signature','rejected_reason','stripe_payment_url','reminder_count','company_logo_url','brand_color','referral_credits_months']) assert.match(sql,new RegExp(`add column if not exists ${field}`));
 assert.doesNotMatch(sql,/^begin;|^commit;/m);
 assert.match(constraints,/not valid/);
 assert.match(index,/create index concurrently if not exists quotes_reminder_due_idx/);
 assert.match(rpcs,/create or replace function public\.get_public_quote_by_token/); assert.match(rpcs,/create or replace function public\.respond_to_public_quote/); assert.match(rpcs,/revoke all on function public\.respond_to_public_quote[\s\S]*from public, anon, authenticated/);
});

test('frontend Supabase config endpoint reflects each environment and requires configured bindings', async () => {
 const production = await worker.fetch(new Request('https://app.example/supabase-config.js'), { ...baseEnv, SUPABASE_URL: 'https://prod.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_prod' });
 assert.equal(production.status, 200);
 assert.match(production.headers.get('content-type'), /javascript/);
 assert.deepEqual(await production.text(), 'window.QUOTEFlow_SUPABASE_CONFIG=Object.freeze({"url":"https://prod.supabase.co","anonKey":"sb_publishable_prod"});');
 const staging = await worker.fetch(new Request('https://staging.example/supabase-config.js'), { ...baseEnv, SUPABASE_URL: 'https://stage.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_stage' });
 const stagingBody = await staging.text();
 assert.match(stagingBody, /stage\.supabase\.co/);
 assert.doesNotMatch(stagingBody, /prod\.supabase\.co/);
 const missing = await worker.fetch(new Request('https://app.example/supabase-config.js'), {});
 assert.equal(missing.status, 503);
});

test('public quote renders every line item with calculated totals, branding, payment and signature UI', async () => {
 const token='550e8400-e29b-41d4-a716-446655440000'; let url;
 await withMockedFetch(async (requestUrl,options)=>{url=String(requestUrl); assert.equal(options.method,'POST'); return Response.json({customer:'Alex',service:'Repair',amount:180,currency:'USD',status:'sent',line_items:[{description:'Labor',quantity:2,unit_price:50,total:100},{description:'Replacement part',quantity:1,unit_price:80}],subtotal_amount:180,tax_rate:0,discount_amount:0,deposit_percent:25,stripe_payment_url:'https://checkout.example/session',brand:{business_name:'Acme',brand_color:'#123456'}});},async()=>{
  const response=await worker.fetch(new Request(`https://app.example/q/${token}`),baseEnv); const body=await response.text();
  assert.equal(response.status,200); assert.match(url,/rpc\/get_public_quote_by_token$/); assert.match(body,/Acme/); assert.match(body,/#123456/); assert.match(body,/Labor/); assert.match(body,/Replacement part/); assert.match(body,/\$80\.00/); assert.match(body,/checkout\.example/); assert.match(body,/<canvas id="signature"/); assert.match(body,/24\/7 AI product help/); assert.match(body,/api\/support-chat/); assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 });
});

test('quote builder supports up to 20 editable items and live subtotals without changing existing quote storage',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
 assert.match(html,/id="quote-line-items"/);assert.match(html,/id="add-quote-line-item"/);assert.match(html,/id="quote-items-total"/);assert.match(html,/inputmode="decimal"><span id="quote-currency-label" aria-live="polite">USD<\/span>/);assert.match(css,/\.currency-input\{display:flex/);assert.doesNotMatch(css,/\.currency-input>span\{position:absolute/);assert.match(app,/rows\.slice\(0, 20\)/);assert.match(app,/lineItemsContainer\.querySelectorAll\('\.quote-line-item'\)/);assert.match(app,/unit_price: unitPrice, total:/);assert.match(app,/Items subtotal:/);assert.match(app,/remove\.disabled = rows\.length < 2/);assert.match(css,/\.quote-line-item\{/);
});

test('accepted public quote submits booking requests through a token-scoped RPC',async()=>{
 const token='550e8400-e29b-41d4-a716-446655440000';let call;
 await withMockedFetch(async(url,options)=>{call={url:String(url),payload:JSON.parse(options.body)};return Response.json({received:true,booking_id:'booking-1'});},async()=>{
  const response=await worker.fetch(jsonRequest(`https://app.example/q/${token}/booking`,{name:'Alex',email:'alex@example.com',scheduledFor:'2030-05-01T10:00:00.000Z',note:'Morning preferred'}),baseEnv);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{received:true});
 });
 assert.ok(call.url.endsWith('/rpc/request_quote_booking'));assert.equal(call.payload.p_email,'alex@example.com');assert.match(call.payload.p_scheduled_for,/2030-05-01/);
});

test('booking requests reject malformed dates before upstream calls',async()=>{
 const token='550e8400-e29b-41d4-a716-446655440000';
 const response=await worker.fetch(jsonRequest(`https://app.example/q/${token}/booking`,{name:'Alex',email:'alex@example.com',scheduledFor:'not-a-date'}),baseEnv);assert.equal(response.status,400);
});

test('public response sends acceptance signature data to RPC and decline reason', async()=>{
 const token='550e8400-e29b-41d4-a716-446655440000'; let params;
 await withMockedFetch(async(url,options)=>{params=JSON.parse(options.body);return Response.json({received:true,status:'accepted'});},async()=>{
  const response=await worker.fetch(jsonRequest(`https://app.example/q/${token}`,{action:'accept',name:'Alex',email:'a@example.com',signature:'data:image/png;base64,abc'}),baseEnv); assert.equal(response.status,200);
 });
 assert.equal(params.p_action,'accept');assert.equal(params.p_signature,'data:image/png;base64,abc');
 await withMockedFetch(async(_url,options)=>{params=JSON.parse(options.body);return Response.json({received:true,status:'declined'});},async()=>{
  const response=await worker.fetch(jsonRequest(`https://app.example/q/${token}`,{action:'decline',reason:'Timing'}),baseEnv);assert.equal(response.status,200);
 });
 assert.equal(params.p_reason,'Timing');
});

test('public quote bounds response payload and only allows GET and POST',async()=>{
 const token='550e8400-e29b-41d4-a716-446655440000';
 const oversized=await worker.fetch(jsonRequest(`https://app.example/q/${token}`,{action:'accept',signature:'x'.repeat(30001)}),baseEnv);assert.equal(oversized.status,400);
 const method=await worker.fetch(new Request(`https://app.example/q/${token}`,{method:'DELETE'}),baseEnv);assert.equal(method.status,405);
});

test('deposit endpoint authenticates Pro user, checks ownership, calculates minor units and stores checkout session',async()=>{
 const id='550e8400-e29b-41d4-a716-446655440000';let stripeForm,saved;
 await withMockedFetch(async(url,options={})=>{
  const target=String(url);
  if(target.endsWith('/auth/v1/user'))return Response.json({id:'user1',email:'owner@example.com'});
  if(target.includes('/rest/v1/profiles?'))return Response.json([{id:'user1',is_pro:true,business_name:'Acme'}]);
  if(target.includes('/rest/v1/quotes?')&&!options.method)return Response.json([{id,public_token:id,service:'Repair',amount:120,currency:'USD',deposit_percent:25,status:'sent',deposit_paid_at:null}]);
  if(target==='https://api.stripe.com/v1/checkout/sessions'){assert.match(options.headers['Idempotency-Key'],/^eqf-deposit-/);stripeForm=new URLSearchParams(options.body);return Response.json({id:'cs_123',url:'https://checkout.stripe.com/session'});}
  if(target.includes('/rest/v1/quotes?id=eq.')&&options.method==='PATCH'){saved=JSON.parse(options.body);return new Response(null,{status:204});}
  assert.fail(`Unexpected upstream request ${target}`);
 },async()=>{
  const response=await worker.fetch(jsonRequest('https://app.example/api/deposit-checkout',{quoteId:id,publicToken:id},'POST',{Authorization:`Bearer ${ownerToken}`}),baseEnv);assert.equal(response.status,200);assert.equal((await response.json()).url,'https://checkout.stripe.com/session');
 });
 assert.equal(stripeForm.get('line_items[0][price_data][unit_amount]'),'3000');assert.equal(stripeForm.get('metadata[supabase_user_id]'),'user1');assert.equal(saved.stripe_checkout_session_id,'cs_123');assert.equal(stripeForm ? true : false,true);
});

test('deposit endpoint refuses unauthenticated callers, free users, and mismatched public tokens',async()=>{
 const id='550e8400-e29b-41d4-a716-446655440000';
 const unauth=await worker.fetch(jsonRequest('https://app.example/api/deposit-checkout',{quoteId:id,publicToken:id}),baseEnv);assert.equal(unauth.status,401);
 await withMockedFetch(async url=>{
  const target=String(url);
  if(target.endsWith('/auth/v1/user'))return Response.json({id:'u1'});
  if(target.includes('/rest/v1/profiles?'))return Response.json([{id:'u1',is_pro:false}]);
  assert.fail(`Unexpected ${target}`);
 },async()=>{
  const response=await worker.fetch(jsonRequest('https://app.example/api/deposit-checkout',{quoteId:id,publicToken:id},'POST',{Authorization:`Bearer ${ownerToken}`}),baseEnv);assert.equal(response.status,402);
 });
 await withMockedFetch(async url=>{
  const target=String(url);
  if(target.endsWith('/auth/v1/user'))return Response.json({id:'u1'});
  if(target.includes('/rest/v1/profiles?'))return Response.json([{id:'u1',is_pro:true}]);
  return Response.json([{id,public_token:'550e8400-e29b-41d4-a716-446655440001',deposit_percent:10}]);
 },async()=>{
  const response=await worker.fetch(jsonRequest('https://app.example/api/deposit-checkout',{quoteId:id,publicToken:id},'POST',{Authorization:`Bearer ${ownerToken}`}),baseEnv);assert.equal(response.status,404);
 });
});

test('scheduled job expires quotes, emails Pro owners only, and persists reminder count',async()=>{
 const {runScheduled}=await import('./scheduled.js');let patchCount=0;let emailSent=false;
 await withMockedFetch(async(url,options={})=>{
  const target=String(url);
  if(target.includes('/rest/v1/quotes?status=')){if(new URL(target).searchParams.get('offset')!=='0')return Response.json([]);return Response.json([{id:'expired',user_id:'user1',email:'',expires_at:'2020-01-01',follow_up:'2020-01-01',reminder_count:0},{id:'due',user_id:'user1',email:'x@example.com',customer:'Alex',service:'Repair',expires_at:'2026-01-01',follow_up:'2024-12-31',reminder_count:0,public_token:'token'}]);}
  if(target.includes('/rest/v1/profiles?')&&target.includes('is_pro=eq.true'))return Response.json([{id:'user1'}]);
  if(target.includes('/rest/v1/profiles?')&&target.includes('select=id,business_name,full_name,phone'))return Response.json([{id:'user1',business_name:'Acme Pros',full_name:'Alex Owner',phone:'555-0100'}]);
  if(target.includes('/rest/v1/recurring_service_plans?'))return Response.json([]);
  if(target.includes('/auth/v1/admin/users/'))return Response.json({id:'user1',email:'owner@example.com'});
  if(target==='https://api.resend.com/emails'){emailSent=true;const body=JSON.parse(options.body);assert.equal(body.from,'Acme Pros <acme-pros@example.com>');assert.equal(body.reply_to,'owner@example.com');return Response.json({id:'email'});}
  if(options.method==='PATCH'){patchCount++;return new Response(null,{status:204});}
  assert.fail(`Unexpected upstream request ${target}`);
 },async()=>{
  const result=await runScheduled({...baseEnv,RESEND_API_KEY:'resend',RESEND_FROM_EMAIL:'quotes@example.com',PUBLIC_APP_URL:'https://app.example'},new Date('2025-01-01T09:00:00Z'));
  assert.equal(result.scanned,2);assert.equal(result.emailed,1);assert.equal(result.expired,1);assert.equal(result.failed,0);assert.equal(result.skippedFree,0);
 });
 assert.equal(emailSent,true);assert.equal(patchCount,2);
});

test('follow-up automation uses staged gentle messages after due date',async()=>{
 const {runScheduled}=await import('./scheduled.js');let subject='',text='';
 await withMockedFetch(async(url,options={})=>{
  const target=String(url);
  if(target.includes('/rest/v1/quotes?status='))return Response.json([{id:'q1',user_id:'user1',email:'x@example.com',customer:'Alex',service:'Repair',public_token:'token',follow_up:'2025-01-01',reminder_count:1,last_reminder_at:'2025-01-02T09:00:00Z'}]);
  if(target.includes('/rest/v1/profiles?')&&target.includes('is_pro=eq.true'))return Response.json([{id:'user1'}]);
  if(target.includes('/rest/v1/profiles?')&&target.includes('select=id,business_name,full_name,phone'))return Response.json([{id:'user1',business_name:'Acme',full_name:'Alex Owner',phone:'555-0100'}]);
  if(target.includes('/rest/v1/recurring_service_plans?'))return Response.json([]);
  if(target.includes('/auth/v1/admin/users/'))return Response.json({id:'user1',email:'owner@example.com'});
  if(target==='https://api.resend.com/emails'){const body=JSON.parse(options.body);subject=body.subject;text=body.text;assert.equal(body.from,'Acme <acme@example.com>');assert.equal(body.reply_to,'owner@example.com');assert.match(body.text,/- Repair/);assert.match(body.text,/Alex Owner/);assert.match(body.text,/555-0100/);return Response.json({id:'email'});}
  if(options.method==='PATCH')return new Response(null,{status:204});
  assert.fail(`Unexpected ${target}`);
 },async()=>{await runScheduled({...baseEnv,RESEND_API_KEY:'resend',RESEND_FROM_EMAIL:'quotes@example.com',PUBLIC_APP_URL:'https://app.example'},new Date('2025-01-05T09:00:00Z'));});
 assert.match(subject,/questions/i);assert.match(text,/no pressure/i);
});

test('scheduled job enforces 24-hour quiet period and paginates quote results',async()=>{
 const {runScheduled}=await import('./scheduled.js');let quoteOffsets=[];
 await withMockedFetch(async url=>{
  const target=String(url);
  const parsed=new URL(target);
  if(target.includes('/rest/v1/quotes?status=')){
   quoteOffsets.push(parsed.searchParams.get('offset'));
   if(parsed.searchParams.get('offset')==='0')return Response.json(Array.from({length:100},(_,i)=>({id:`q${i}`,user_id:'user1',email:'x@example.com',follow_up:'2024-12-31',reminder_count:1,last_reminder_at:'2025-01-01T08:00:00Z'})));
   return Response.json([]);
  }
  if(target.includes('/rest/v1/profiles?'))return Response.json([{id:'user1'}]);
  if(target.includes('/rest/v1/recurring_service_plans?'))return Response.json([]);
  assert.fail(`Unexpected ${target}`);
 },async()=>{const result=await runScheduled({...baseEnv,RESEND_API_KEY:'resend',RESEND_FROM_EMAIL:'quotes@example.com'},new Date('2025-01-01T09:00:00Z'));assert.equal(result.scanned,100);assert.equal(result.emailed,0);});
 assert.deepEqual(quoteOffsets,['0','100']);
});

test('invoice checkout and send-quote-email require Pro and create Stripe or Resend requests',async()=>{
 const id='550e8400-e29b-41d4-a716-446655440000';
 let sentFrom='';
 await withMockedFetch(async(url,options={})=>{
  const target=String(url);
  if(target.endsWith('/auth/v1/user'))return Response.json({id:'user1',email:'owner@example.com'});
  if(target.includes('/rest/v1/profiles?'))return Response.json([{id:'user1',is_pro:true,business_name:'Acme',full_name:'Alex Owner'}]);
  if(target.includes('/rest/v1/quotes?'))return Response.json([{id,customer:'Casey',email:'casey@example.com',service:'Repair',amount:200,currency:'USD',status:'won',invoice_status:'unpaid',deposit_percent:25,deposit_paid_at:'2025-01-01T00:00:00Z',public_token:id}]);
  if(target==='https://api.stripe.com/v1/checkout/sessions')return Response.json({id:'cs_inv',url:'https://checkout.stripe.com/invoice'});
  if(target==='https://api.resend.com/emails'){sentFrom=JSON.parse(options.body).from;return Response.json({id:'email_1'});}
  if(target.includes('/rest/v1/quotes?id=eq.'))return new Response(null,{status:204});
  assert.fail(`Unexpected ${target}`);
 },async()=>{
  const invoice=await worker.fetch(jsonRequest('https://app.example/api/invoice-checkout',{quoteId:id},'POST',{Authorization:`Bearer ${ownerToken}`}),baseEnv);
  assert.equal(invoice.status,200);assert.equal((await invoice.json()).url,'https://checkout.stripe.com/invoice');
  const email=await worker.fetch(jsonRequest('https://app.example/api/send-quote-email',{quoteId:id},'POST',{Authorization:`Bearer ${ownerToken}`}),{...baseEnv,RESEND_API_KEY:'resend',RESEND_FROM_EMAIL:'quotes@example.com'});
  const body=await email.json();
  assert.equal(email.status,200);assert.equal(body.sent,true);assert.equal(body.from,'Acme <acme@example.com>');
 });
 assert.equal(sentFrom,'Acme <acme@example.com>');
});

test('follow-ups send in-app and unused AI drafts stay out of the quote',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(html,/id="ai-scope-preview"/);assert.match(html,/id="ai-scope-use"/);assert.match(html,/id="ai-scope-discard"/);
 assert.match(app,/Follow-up sent/);assert.match(app,/sendCustomerEmail\(quote, subject, body, 'Follow-up sent'\)/);
 assert.match(app,/quoteItemLabels\(quote\)/);assert.match(app,/emailSignature\(\)/);
 assert.match(app,/clearUnusedAiDraft\(\)/);assert.match(app,/It stays out of the quote until you use it/);
 assert.doesNotMatch(app,/terms\.value = result\.reply/);
});

test('notices stay in the top layer and quote send failures stay on screen',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
 const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
 assert.match(html,/id="toast"[^>]*popover="manual"/);
 assert.match(app,/toast\.showPopover\(\)/);
 assert.match(app,/Open email app/);
 assert.doesNotMatch(app,/Opening your email app instead/);
 assert.match(css,/\.toast\{[^}]*top:16px/);
 assert.match(css,/\.field-error\{[^}]*font:600 13px/);
});

test('quote email failures include the provider reason',async()=>{
 const id='550e8400-e29b-41d4-a716-446655440000';
 await withMockedFetch(async url=>{
  const target=String(url);
  if(target.endsWith('/auth/v1/user'))return Response.json({id:'user1',email:'owner@example.com'});
  if(target.includes('/rest/v1/profiles?'))return Response.json([{id:'user1',is_pro:true,business_name:'Acme',full_name:'Alex Owner'}]);
  if(target.includes('/rest/v1/quotes?'))return Response.json([{id,customer:'Casey',email:'casey@example.com',service:'Repair',amount:200,currency:'USD',public_token:id}]);
  if(target==='https://api.resend.com/emails')return Response.json({message:'Invalid from address.'},{status:422});
  assert.fail(`Unexpected ${target}`);
 },async()=>{
  const email=await worker.fetch(jsonRequest('https://app.example/api/send-quote-email',{quoteId:id},'POST',{Authorization:`Bearer ${ownerToken}`}),{...baseEnv,RESEND_API_KEY:'resend',RESEND_FROM_EMAIL:'quotes@example.com'});
  const body=await email.json();
  assert.equal(email.status,502);
  assert.match(body.error,/Invalid from address/);
 });
});

test('business sender addresses use the business name and avoid platform mailboxes',async()=>{
 const {businessSender}=await import('./sender-address.js');
 const sender=businessSender({RESEND_FROM_EMAIL:'quotes@admin.elitequoteflow.com',PUBLIC_APP_URL:'https://elitequoteflow.com'},{businessName:"José's Painting & Co",replyTo:'Owner@Example.com'});
 assert.equal(sender.address,'joses-painting-and-co@elitequoteflow.com');
 assert.equal(sender.replyTo,'owner@example.com');
 assert.equal(sender.from,"José's Painting & Co <joses-painting-and-co@elitequoteflow.com>");
 const reserved=businessSender({RESEND_FROM_EMAIL:'quotes@admin.elitequoteflow.com'},{businessName:'Support'});
 assert.equal(reserved.address,'support-studio@elitequoteflow.com');
 const named=businessSender({RESEND_FROM_DOMAIN:'mail.example.com',RESEND_FROM_EMAIL:'quotes@admin.elitequoteflow.com'},{businessName:'Acme Painting'});
 assert.equal(named.address,'acme-painting@mail.example.com');
});

test('staff review accounts can use Pro actions without a paid subscription',async()=>{
 const id='550e8400-e29b-41d4-a716-446655440000';
 await withMockedFetch(async(url,options={})=>{
  const target=String(url);
  if(target.endsWith('/auth/v1/user'))return Response.json({id:'user1',email:'owner@example.com'});
  if(target.includes('/rest/v1/profiles?'))return Response.json([{id:'user1',is_pro:false,business_name:'Acme',full_name:'Alex Owner'}]);
  if(target.includes('/rest/v1/quotes?'))return Response.json([{id,customer:'Casey',email:'casey@example.com',service:'Repair',amount:200,currency:'USD',public_token:id}]);
  if(target==='https://api.resend.com/emails'){const body=JSON.parse(options.body);assert.equal(body.from,'Acme <acme@example.com>');assert.equal(body.reply_to,'owner@example.com');return Response.json({id:'email_staff'});}
  assert.fail(`Unexpected ${target}`);
 },async()=>{
  const denied=await worker.fetch(jsonRequest('https://app.example/api/send-quote-email',{quoteId:id},'POST',{Authorization:`Bearer ${ownerToken}`}),{...baseEnv,RESEND_API_KEY:'resend',RESEND_FROM_EMAIL:'quotes@example.com'});
  assert.equal(denied.status,402);
  const allowed=await worker.fetch(jsonRequest('https://app.example/api/send-quote-email',{quoteId:id},'POST',{Authorization:`Bearer ${ownerToken}`}),{...baseEnv,STAFF_EMAILS:'owner@example.com',RESEND_API_KEY:'resend',RESEND_FROM_EMAIL:'quotes@example.com'});
  assert.equal(allowed.status,200);
  const access=await worker.fetch(new Request('https://app.example/api/account-access',{headers:{Authorization:`Bearer ${ownerToken}`}}),{...baseEnv,OWNER_ANALYTICS_EMAILS:'owner@example.com, teammate@example.com'});
  const body=await access.json();
  assert.equal(access.status,200);assert.equal(body.staff,true);assert.equal(body.pro,false);assert.equal(body.access,'staff');assert.equal(body.emails,undefined);
 });
});

test('teams invite and referral endpoints create Pro collaboration records',async()=>{
 await withMockedFetch(async(url,options={})=>{
  const target=String(url);
  if(target.endsWith('/auth/v1/user'))return Response.json({id:'user1',email:'owner@example.com'});
  if(target.includes('/rest/v1/profiles?id=eq.user1')&&!options.method)return Response.json([{id:'user1',is_pro:true,business_name:'Acme',referral_code:null,referral_credits_months:0}]);
  if(target.includes('/rest/v1/profiles?id=eq.user1')&&options.method==='PATCH')return Response.json([{id:'user1',referral_code:'EQFABCDEF1234'}]);
  if(target.includes('/rest/v1/business_teams?owner_id=')&&!options.method)return Response.json([]);
  if(target.includes('/rest/v1/business_teams')&&options.method==='POST')return Response.json([{id:'team1',owner_id:'user1',name:'Acme'}]);
  if(target.includes('/rest/v1/business_team_members')&&options.method==='POST')return Response.json([{id:'member1',invited_email:'mate@example.com',role:'member',invitation_status:'pending'}]);
  if(target.includes('/rest/v1/business_team_members?'))return Response.json([]);
  assert.fail(`Unexpected ${target}`);
 },async()=>{
  const referral=await worker.fetch(new Request('https://app.example/api/referrals',{headers:{Authorization:`Bearer ${ownerToken}`}}),baseEnv);
  assert.equal(referral.status,200);assert.match((await referral.json()).referralCode,/^EQF/);
  const invite=await worker.fetch(jsonRequest('https://app.example/api/teams',{email:'mate@example.com',role:'member'},'POST',{Authorization:`Bearer ${ownerToken}`}),baseEnv);
  assert.equal(invite.status,200);assert.equal((await invite.json()).invited,true);
 });
});

test('deposit webhook sets paid timestamp for matching quote owner',async()=>{
 const signature=async(body)=>{const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(baseEnv.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const raw=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${Math.floor(Date.now()/1000)}.${body}`));return `t=${Math.floor(Date.now()/1000)},v1=${[...new Uint8Array(raw)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}`;};
 const body=JSON.stringify({type:'checkout.session.completed',data:{object:{id:'cs_123',mode:'payment',payment_status:'paid',metadata:{quote_id:'quote1',supabase_user_id:'user1'}}}});const sig=await signature(body);let updated;
 await withMockedFetch(async(url,options={})=>{if(String(url).includes('/rest/v1/quotes?')&&!options.method)return Response.json([{id:'quote1',user_id:'user1',stripe_checkout_session_id:'cs_123',deposit_paid_at:null}]);if(options.method==='PATCH'){updated=JSON.parse(options.body);return new Response(null,{status:204});}assert.fail(`Unexpected ${url}`);},async()=>{
  const response=await worker.fetch(new Request('https://app.example/api/stripe-webhook',{method:'POST',body,headers:{'Stripe-Signature':sig}}),baseEnv);assert.equal(response.status,200);
 });
 assert.ok(updated.deposit_paid_at);
});

test('paid one-time Pro checkout activates lifetime access for its referenced profile',async()=>{
 const timestamp=Math.floor(Date.now()/1000);
 const body=JSON.stringify({id:'evt_lifetime',type:'checkout.session.completed',livemode:true,data:{object:{id:'cs_lifetime',mode:'payment',payment_status:'paid',client_reference_id:'user1',payment_link:'plink_lifetime',amount_total:14999,currency:'usd',customer:'cus_lifetime'}}});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(baseEnv.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signatureBytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${body}`));
 const signature=`t=${timestamp},v1=${[...new Uint8Array(signatureBytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}`;
 let update;
 await withMockedFetch(async(url,options={})=>{
  const target=String(url);
  if(target.includes('/rest/v1/profiles?id=eq.user1&select=id'))return Response.json([{id:'user1'}]);
  if(target.includes('/rest/v1/profiles?id=eq.user1')&&options.method==='PATCH'){update=JSON.parse(options.body);return new Response(null,{status:204});}
  if(target.includes('/rest/v1/profiles?')&&!options.method)return Response.json([{id:'user1',referred_by_code:null,referral_reward_status:'none'}]);
  assert.fail(`Unexpected upstream request ${target}`);
 },async()=>{
  const response=await worker.fetch(new Request('https://app.example/api/stripe-webhook',{method:'POST',body,headers:{'Stripe-Signature':signature}}),baseEnv);
  assert.equal(response.status,200);
 });
 assert.equal(update.is_pro,true);
 assert.equal(update.stripe_customer_id,'cus_lifetime');
 assert.equal(update.stripe_subscription_id,null);
 assert.equal(update.stripe_subscription_status,'lifetime');
});

test('monthly checkout route returns the monthly link with account reference',async()=>{
 await withMockedFetch(async(url,options={})=>{
  const target=String(url);
  if(target.endsWith('/auth/v1/user')){assert.equal(options.headers.Authorization,`Bearer ${ownerToken}`);return Response.json({id:'user1',email:'user@example.com'});}
  if(target.includes('/rest/v1/profiles?'))return Response.json([{is_pro:false}]);
  assert.fail(`Unexpected upstream request ${target}`);
 },async()=>{
  const response=await worker.fetch(jsonRequest('https://app.example/api/create-monthly-checkout-session',{plan:'monthly'},'POST',{Authorization:`Bearer ${ownerToken}`}),baseEnv);
  assert.equal(response.status,200);
  assert.equal((await response.json()).url,'https://buy.stripe.com/test_monthly?client_reference_id=user1');
 });
});

test('monthly checkout rejects accounts already on Pro',async()=>{
 await withMockedFetch(async url=>String(url).endsWith('/auth/v1/user')?Response.json({id:'user1',email:'user@example.com'}):Response.json([{is_pro:true}]),async()=>{
  const response=await worker.fetch(jsonRequest('https://app.example/api/create-monthly-checkout-session',{plan:'monthly'},'POST',{Authorization:`Bearer ${ownerToken}`}),baseEnv);
  assert.equal(response.status,409);
 });
});

test('paid monthly Pro subscription activates renewable Pro access',async()=>{
 const timestamp=Math.floor(Date.now()/1000);
 const body=JSON.stringify({id:'evt_monthly',type:'checkout.session.completed',livemode:true,data:{object:{id:'cs_monthly',mode:'subscription',payment_status:'paid',client_reference_id:'user1',subscription:'sub_monthly',customer:'cus_monthly'}}});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(baseEnv.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signatureBytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${body}`));
 const signature=`t=${timestamp},v1=${[...new Uint8Array(signatureBytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}`;
 let update;
 await withMockedFetch(async(url,options={})=>{
  const target=String(url);
  if(target.includes('/rest/v1/profiles?id=eq.user1&select=id'))return Response.json([{id:'user1'}]);
  if(target.includes('/rest/v1/profiles?id=eq.user1')&&options.method==='PATCH'){update=JSON.parse(options.body);return new Response(null,{status:204});}
  if(target.includes('/rest/v1/profiles?')&&!options.method)return Response.json([{id:'user1',referred_by_code:null,referral_reward_status:'none'}]);
  assert.fail(`Unexpected upstream request ${target}`);
 },async()=>{
  const response=await worker.fetch(new Request('https://app.example/api/stripe-webhook',{method:'POST',body,headers:{'Stripe-Signature':signature}}),baseEnv);
  assert.equal(response.status,200);
 });
 assert.equal(update.is_pro,true);
 assert.equal(update.stripe_customer_id,'cus_monthly');
 assert.equal(update.stripe_subscription_id,'sub_monthly');
 assert.equal(update.stripe_subscription_status,'active');
});

test('paid customer-selected amount below USD 149.99 does not grant lifetime Pro',async()=>{
 const timestamp=Math.floor(Date.now()/1000);
 const body=JSON.stringify({id:'evt_lifetime_under_minimum',type:'checkout.session.completed',livemode:true,data:{object:{id:'cs_lifetime_under_minimum',mode:'payment',payment_status:'paid',client_reference_id:'user1',payment_link:'plink_lifetime',amount_total:100,currency:'usd',customer:'cus_lifetime'}}});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(baseEnv.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signatureBytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${body}`));
 const signature=`t=${timestamp},v1=${[...new Uint8Array(signatureBytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}`;
 let requests=0;
 await withMockedFetch(async()=>{requests++;assert.fail('Below-minimum payment must not touch the profile.');},async()=>{
  const response=await worker.fetch(new Request('https://app.example/api/stripe-webhook',{method:'POST',body,headers:{'Stripe-Signature':signature}}),baseEnv);
  assert.equal(response.status,200);
 });
 assert.equal(requests,0);
});

test('duplicate successful deposit webhook is acknowledged without another database update',async()=>{
 const body=JSON.stringify({type:'checkout.session.completed',data:{object:{id:'cs_123',mode:'payment',payment_status:'paid',metadata:{quote_id:'quote1',supabase_user_id:'user1'}}}});
 const timestamp=Math.floor(Date.now()/1000);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(baseEnv.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signatureBytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${body}`));const signature=`t=${timestamp},v1=${[...new Uint8Array(signatureBytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}`;let patches=0;
 await withMockedFetch(async(url,options={})=>{if(String(url).includes('/rest/v1/quotes?')&&!options.method)return Response.json([{id:'quote1',user_id:'user1',stripe_checkout_session_id:'cs_123',deposit_paid_at:'2025-01-01T00:00:00Z'}]);if(options.method==='PATCH'){patches++;return new Response(null,{status:204});}assert.fail(`Unexpected ${url}`);},async()=>{
  const response=await worker.fetch(new Request('https://app.example/api/stripe-webhook',{method:'POST',body,headers:{'Stripe-Signature':signature}}),baseEnv);assert.equal(response.status,200);assert.deepEqual(await response.json(),{received:true});
 });
 assert.equal(patches,0);
});

test('staging scheduled handler is disabled when configured for shared Supabase',async()=>{
 let scheduled;
 const event={scheduledTime:Date.now(),cron:'0 9 * * *'};
 worker.scheduled(event,{DISABLE_SCHEDULED_JOBS:'true'},{waitUntil(){scheduled=true;}});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(scheduled,undefined);
});

test('admin grants migration provides service-role CRUD on every admin dataset',async()=>{
 const sql=await readFile(new URL('../supabase-admin-grants.sql',import.meta.url),'utf8');
 for(const table of ['customer_reviews','quote_bookings','public_booking_requests','recurring_service_plans','quotes'])assert.match(sql,new RegExp(`public\\.${table}`));
 assert.match(sql,/grant select, insert, update, delete on table[\s\S]*to service_role/i);
});

test('wrangler defines daily production cron and prevents staging cron jobs',async()=>{
 const config=await readFile(new URL('../wrangler.toml',import.meta.url),'utf8');
 assert.match(config,/\[\[ratelimits\]\]/);
 assert.match(config,/name = "BOOKING_RATE_LIMITER"/);
 assert.doesNotMatch(config,/\[\[kv_namespaces\]\]/);
 const publicBookings=await readFile(new URL('../supabase-public-bookings.sql',import.meta.url),'utf8');assert.match(publicBookings,/create table if not exists public\.public_booking_requests/);assert.match(publicBookings,/submit_public_booking_request/);assert.match(publicBookings,/revoke all on public\.public_booking_requests from public, anon, authenticated/);
 assert.match(config,/name = "REVIEW_RATE_LIMITER"/);
 const reviews=await readFile(new URL('../supabase-customer-reviews.sql',import.meta.url),'utf8');assert.match(reviews,/status text not null default 'published'/);assert.match(reviews,/get_published_customer_reviews/);assert.match(reviews,/submit_customer_review/);assert.match(reviews,/customer_reviews_email_uidx/);assert.match(reviews,/revoke all on public\.customer_reviews from public, anon, authenticated/);
 const growth=await readFile(new URL('../supabase-growth-features.sql',import.meta.url),'utf8');
 assert.match(growth,/create table if not exists public\.quote_bookings/);assert.match(growth,/create table if not exists public\.recurring_service_plans/);assert.match(growth,/create table if not exists public\.customer_notes/);assert.match(growth,/request_quote_booking/);
 assert.match(config,/binding = "SITE_ANALYTICS"/);assert.match(config,/dataset = "site_analytics"/);assert.match(config,/crons\s*=\s*\["0 9 \* \* \*"\]/);
 assert.match(config,/DISABLE_SCHEDULED_JOBS\s*=\s*"true"/);
});
