(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const path = window.location.pathname;
  const tradePage = /^\/(landscaping|plumbing|electrical|hvac|painting|house-cleaning|roofing|handyman|pest-control|flooring|remodeling|pressure-washing|pool-service|moving|auto-detailing)$/.test(path);
  const funnelEvent = (stage, extra = {}) => {
    const payload = { event: stage, path, referrer: document.referrer || '', ...extra };
    const body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/analytics', new Blob([body], { type: 'application/json' }))) return;
    } catch { /* Fall through to fetch when beacon is blocked. */ }
    fetch('/api/analytics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  };

  if (tradePage) {
    funnelEvent('pageview');
    document.querySelectorAll('[data-funnel-stage="signup_click"]').forEach(link => link.addEventListener('click', () => funnelEvent('signup_click')));
  }

  if (path === '/trades') funnelEvent('pageview');

  if (path !== '/' && path !== '/trades' && !tradePage) return;

  const stageStart = () => {
    const started = performance.now();
    window.setTimeout(() => {
      const engaged = document.visibilityState === 'visible' && performance.now() - started >= 20000;
      if (engaged) funnelEvent('engaged_20s');
    }, 20500);
  };
  stageStart();
  if (path === '/') {
    document.getElementById('landing-create')?.addEventListener('click', () => funnelEvent('signup_click'));
    document.getElementById('landing-start')?.addEventListener('click', () => funnelEvent('signup_click'));
    ['landing-calc-cta', 'landing-steps-cta', 'landing-pricing-cta', 'landing-pro-cta'].forEach(id => byId(id)?.addEventListener('click', () => funnelEvent('signup_click', { action: id })));
    document.querySelectorAll('.landing-nav a[href^="/landscaping"], .trade-directory-link').forEach(link => link.addEventListener('click', () => funnelEvent('trade_directory_click')));
  }
  document.getElementById('register-form')?.addEventListener('submit', () => funnelEvent('signup_submit'));
  document.getElementById('auth-form')?.addEventListener('submit', () => funnelEvent('signin_submit'));

  window.EliteQuoteFlowMarketing = Object.freeze({ funnelEvent });
})();
