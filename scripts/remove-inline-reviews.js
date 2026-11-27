import { readFile, writeFile } from 'node:fs/promises';
const path = 'public/app.js';
const source = await readFile(path, 'utf8');
const start = source.indexOf('  function renderPublishedCustomerReviews(target, result) {');
const end = source.indexOf("  $('#support-form').addEventListener('submit'", start);
if (start < 0 || end < 0) throw new Error('Could not isolate the inline review handlers.');
const updated = `${source.slice(0, start)}  // Public review rendering is loaded separately in reviews.js, independently of dashboard initialization.\n${source.slice(end)}`;
await writeFile(path, updated, 'utf8');
console.log('Removed inline review logic from the primary application initializer.');
