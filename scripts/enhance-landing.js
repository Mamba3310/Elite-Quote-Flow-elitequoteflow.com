import { readFile, writeFile } from 'node:fs/promises';

const path = 'public/index.html';
let html = await readFile(path, 'utf8');
const directory = `<section class="landing-trades" id="trades" aria-labelledby="landing-trades-title"><div class="landing-section-heading"><p class="eyebrow">BUILT FOR ESTIMATE-BASED SERVICE WORK</p><h2 id="landing-trades-title">See your trade in the workflow.</h2><p>Explore a tailored example for 15 service businesses. Quote amounts are illustrative, not market-price guidance.</p></div><div class="trade-directory-grid">${['landscaping','plumbing','electrical','hvac','painting','house-cleaning','roofing','handyman','pest-control','flooring','remodeling','pressure-washing','pool-service','moving','auto-detailing'].map(slug => { const title = slug.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' '); return `<a href="/${slug}" class="trade-directory-link" data-funnel-stage="trade_directory_click"><strong>${title}</strong><span>View example quote ↗</span></a>`; }).join('')}</div><p class="trade-directory-all"><a href="/trades">Browse all 15 trade examples →</a></p></section>`;
if (!html.includes('id="landing-trades-title"')) html = html.replace('<section class="landing-reviews"', `${directory}<section class="landing-reviews"`);
html = html.replace('<p>Read real customer feedback when available. No sample or invented reviews are displayed.</p>', '<p>Real customer feedback from published submissions. No invented testimonials.</p>');
html = html.replace('<p class="review-loading">Loading customer reviews.</p>', '<p class="review-loading">Loading customer reviews…</p>');
html = html.replace('<footer class="landing-footer">', '<a class="landing-link landing-footer-trades" href="/trades">Explore quote examples for 15 service trades</a><footer class="landing-footer">');
await writeFile(path, html, 'utf8');
console.log('Added the 15-trade directory to the landing page.');
