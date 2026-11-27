import { readFile, writeFile } from 'node:fs/promises';
let html=await readFile('public/index.html','utf8');
let app=await readFile('public/app.js','utf8');
const end='</ul></div></div><p class="analytics-error" id="analytics-error" role="status" hidden></p></section>';
if(!html.includes('id="analytics-funnel"')) { if(!html.includes(end))throw Error('Analytics section marker missing'); html=html.replace(end,'</ul></div></div><div class="analytics-funnel"><h3>Signup funnel · last 24 hours</h3><p>Aggregate interaction counts help show where visitors stop in the journey.</p><ul id="analytics-funnel" class="analytics-list"><li>Loading funnel activity…</li></ul></div><p class="analytics-error" id="analytics-error" role="status" hidden></p></section>'); }
const marker="    renderList('#analytics-decisions-by-country', data.decisionsByCountry || [], 'No quote decisions in the last 24 hours', item => `${item.country} · ${item.decision}: ${item.count}`);";
if(!app.includes("renderList('#analytics-funnel'")){if(!app.includes(marker))throw Error('Owner analytics renderer marker missing');app=app.replace(marker,marker+"\n    renderList('#analytics-funnel', data.funnel || [], 'No tracked funnel events yet', item => `${item.stage} · ${item.path}${item.action ? ` · ${item.action}` : ''}: ${item.count}`);");}
await writeFile('public/index.html',html,'utf8');await writeFile('public/app.js',app,'utf8');console.log('Added aggregate signup-funnel reporting to the owner dashboard.');
