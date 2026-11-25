import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

await import('./estimate-import.js');
const api = globalThis.QuoteFlowEstimateImport;

test('estimate import parses labeled customer, contact, and total without inventing amounts', () => {
  assert.ok(api);
  const sample = [
    'Estimate',
    'Customer: Jordan Lee',
    'Email: jordan@example.com',
    'Phone: (555) 123-4567',
    'Service: Spring yard cleanup',
    'Materials 120.00',
    'Labor 80.00',
    'Total: $1,250.50'
  ].join('\n');
  const parsed = api.parseEstimateText(sample, { sourceType: 'paste' });
  assert.equal(parsed.fields.customer, 'Jordan Lee');
  assert.equal(parsed.fields.email, 'jordan@example.com');
  assert.match(parsed.fields.phone, /555/);
  assert.equal(parsed.fields.service, 'Spring yard cleanup');
  assert.equal(parsed.fields.amount, '1250.50');
  assert.equal(parsed.fields.currency, 'USD');
});

test('estimate import leaves amount blank when no labeled total exists', () => {
  const parsed = api.parseEstimateText('Hello there\nMaybe about 500 someday', { sourceType: 'paste' });
  assert.equal(parsed.fields.amount, '');
  assert.ok(parsed.warnings.some(warning => /no clearly labeled total/i.test(warning)));
});

test('image imports rely on filename hint and manual confirm messaging', () => {
  const parsed = api.parseEstimateText('', { filename: 'kitchen-faucet-install.png', sourceType: 'image' });
  assert.equal(parsed.fields.service, 'kitchen faucet install');
  assert.match(parsed.fields.note, /Imported image/);
  assert.ok(parsed.warnings.some(warning => /OCR/i.test(warning)));
});

test('PDF text extractor reads simple Tj literals', () => {
  const pdf = `%PDF-1.4
1 0 obj<<>>endobj
stream
BT (Customer: Alex Morgan) Tj
(Total: 480.00) Tj
ET
endstream
%%EOF`;
  const text = api.extractTextFromPdfBytes(new TextEncoder().encode(pdf));
  assert.match(text, /Alex Morgan/);
  assert.match(text, /480\.00/);
});

test('import and recovered metric UI are wired in the dashboard', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
  assert.match(html, /id="import-estimate-button"/);
  assert.match(html, /id="import-estimate-dialog"/);
  assert.match(html, /id="metric-recovered"/);
  assert.match(html, /RECOVERED BY FOLLOW-UP/);
  assert.match(html, /estimate-import\.js/);
  assert.match(app, /isRecoveredByFollowUp/);
  assert.match(app, /Accepted after follow-up was due/);
  assert.match(app, /QuoteFlowEstimateImport/);
  assert.match(app, /openImportDialog/);
  assert.match(css, /metric-card-recovered/);
  assert.match(css, /repeat\(5,minmax\(0,1fr\)\)/);
});
