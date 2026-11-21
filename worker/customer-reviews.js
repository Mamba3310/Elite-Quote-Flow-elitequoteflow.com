const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const boundedText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
export async function onCustomerReview(request, env) {
  if (request.method === 'GET') {
    if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_ANON_KEY?.trim()) return json({ error: 'Reviews are temporarily unavailable.' }, 503);
    try {
      const anonKey = env.SUPABASE_ANON_KEY.trim();
      const response = await fetch(`${env.SUPABASE_URL.trim().replace(/\/$/, '')}/rest/v1/rpc/get_published_customer_reviews`, {
        method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_limit: 12 })
      });
      if (!response.ok) throw new Error(`Review query returned ${response.status}.`);
      return json({ reviews: await response.json() }, 200);
    } catch (error) { console.error('Published reviews query failed:', error.message); return json({ error: 'Reviews are temporarily unavailable.' }, 503); }
  }
  if (request.method !== 'POST') return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, POST' } });
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Submit a valid review.' }, 400); }
  // Honeypot: silently accept bot-filled submissions without storing them.
  if (typeof payload?.website === 'string' && payload.website.trim()) return json({ received: true }, 202);
  const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const business = typeof payload?.business === 'string' ? payload.business.trim() : '';
  const review = typeof payload?.review === 'string' ? payload.review.trim() : '';
  const rating = Number(payload?.rating);
  if (!boundedText(name, 80) || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !boundedText(business, 100) || !boundedText(review, 1500) || !Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: 'Enter your name, a valid email, business name, a 1–5 star rating, and a review under 1,500 characters.' }, 400);
  const allowedOrigin = env.REVIEW_ALLOWED_ORIGIN || 'https://elitequoteflow.com';
  const origin = request.headers.get('Origin');
  if (origin && origin !== allowedOrigin && origin !== 'https://www.elitequoteflow.com') return json({ error: 'Origin not allowed.' }, 403);
  const clientAddress = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.REVIEW_RATE_LIMITER?.limit) {
    const result = await env.REVIEW_RATE_LIMITER.limit({ key: clientAddress });
    if (!result.success) return json({ error: 'Please wait before submitting another review.' }, 429);
  }
  if (!env.SUPABASE_URL?.trim() || !env.SUPABASE_ANON_KEY?.trim()) return json({ error: 'Review submission is temporarily unavailable.' }, 503);
  try {
    const anonKey = env.SUPABASE_ANON_KEY.trim();
    const response = await fetch(`${env.SUPABASE_URL.trim().replace(/\/$/, '')}/rest/v1/rpc/submit_customer_review`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_customer_name: name, p_customer_email: email, p_business_name: business, p_rating: rating, p_review_text: review })
    });
    if (response.status === 429) return json({ error: 'Please wait before submitting another review.' }, 429);
    if (!response.ok) throw new Error(`Review RPC returned ${response.status}.`);
    const result = await response.json();
    if (!result?.received) return json({ error: 'A review with this email was already submitted.' }, 409);
    return json({ received: true, message: result.message || 'Thank you. Your review is now published on the landing page.' }, 201);
  } catch (error) {
    console.error('Customer review submission failed:', error.message);
    return json({ error: 'Could not submit your review right now. Please try again later.' }, 503);
  }
}
