import { readFile, writeFile } from 'node:fs/promises';
const load = path => readFile(path, 'utf8');
const save = (path, data) => writeFile(path, data, 'utf8');
let html = await load('public/index.html');
let app = await load('public/app.js');
if (!html.includes('src="reviews.js"')) html = html.replace('  <script defer src="marketing.js"></script>', '  <script defer src="marketing.js"></script>\n  <script defer src="reviews.js"></script>');
html = html.replace('Read real customer feedback when available. No sample or invented reviews are displayed.', 'Real customer feedback from published submissions. No invented testimonials.');
html = html.replace('Loading customer reviews.</p>', 'Loading customer reviews…</p>');
const demo = `<dialog class="quote-dialog walkthrough-dialog" id="product-walkthrough" aria-labelledby="walkthrough-title"><section class="support-panel"><header class="support-header"><div><p class="eyebrow">A QUICK PRODUCT WALKTHROUGH</p><h2 id="walkthrough-title">A quote, a follow-up, a clear next step.</h2><p>See how the workflow fits a typical service estimate.</p></div><button class="icon-button" id="walkthrough-close" type="button" aria-label="Close walkthrough">×</button></header><div class="walkthrough-steps"><article><strong>01 · Add</strong><h3>Save the customer and estimate</h3><p>Keep the job, itemized price, terms, and follow-up date together.</p></article><article><strong>02 · Share</strong><h3>Send a reviewable quote link</h3><p>Give the customer a clear proposal they can open and respond to online.</p></article><article><strong>03 · Follow through</strong><h3>See what needs your attention</h3><p>Track upcoming check-ins, quote views, and decisions in your workspace.</p></article></div><button class="button button-primary" id="walkthrough-start" type="button">Try it with my first quote</button><p class="niche-note">Illustrative workflow only. Sample names and amounts on this site are not customer results.</p></section></dialog>`;
if (!html.includes('id="product-walkthrough"')) html = html.replace('  <dialog class="quote-dialog history-dialog"', `  ${demo}\n  <dialog class="quote-dialog history-dialog"`);
if (!html.includes('id="landing-demo-video"')) html = html.replace('<button class="landing-link" id="landing-demo" type="button">Already have an account? Sign in</button>', '<button class="landing-link" id="landing-demo-video" type="button">Watch the 60-second walkthrough</button><button class="landing-link" id="landing-demo" type="button">Already have an account? Sign in</button>');
if (!html.includes('id="landing-trades-title"')) throw new Error('15-trade directory is missing from the home page.');
await save('public/index.html', html);
const start = app.indexOf('  function renderPublishedCustomerReviews(target, result) {');
const end = app.indexOf("  $('#support-form').addEventListener('submit'", start);
if (start >= 0 && end < 0) throw new Error('Could not locate end of old inline reviews block.');
if (start >= 0) app = `${app.slice(0, start)}  // Reviews are loaded independently by public/reviews.js to survive unrelated app initialization errors.\n${app.slice(end)}`;
if (!app.includes("$('#landing-demo-video').addEventListener")) {
  const marker = "  $('#landing-signin').addEventListener('click', () => showSignedOut('signin'));";
  if (!app.includes(marker)) throw new Error('Could not locate landing action bindings.');
  app = app.replace(marker, `${marker}\n  const walkthrough = $('#product-walkthrough');\n  $('#landing-demo-video').addEventListener('click', () => walkthrough.showModal());\n  $('#walkthrough-close').addEventListener('click', () => walkthrough.close());\n  $('#walkthrough-start').addEventListener('click', () => { walkthrough.close(); showRegistration(); });\n  walkthrough.addEventListener('click', event => { if (event.target === walkthrough) walkthrough.close(); });`);
}
await save('public/app.js', app);
console.log('Separated review loading from the dashboard and added the guided product walkthrough.');
