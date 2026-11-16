/* A REFERRAL GOES TO THE CB HIGHLEVEL CAPTURED — unless the name says it is someone else (2026-11-16).
 *
 * HighLevel's form gained a "CB Number" field on 9 Nov. Before this, every referral was matched on the free-text
 * Agent Name, and ~1,000 referrals reached nobody. The CB is exact, but hand-typed (Londiwe Muyaka is CB458 on the
 * list and CB485 in HighLevel), so the rule is: the CB wins when it is on the Agent List, and the NAME wins a clash —
 * when the name exactly names a DIFFERENT list agent — as it does on the Agent List itself.
 *
 * Drives PULSE's real ingest (referralRecsFromRows -> INGEST._refStore) in a browser over a fictional list, then checks
 * that every hop from HighLevel to the cards carries the CB. Fails without the change: the sync row dropped `cb`.
 *
 * Run: node nicks_code/diagnostics/verify-referrals-cb.mjs   (PULSE_HTML=nicks_code/index.html for the source build)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'site/pulse/index.html').split('/'));
let pass = 0; const fails = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

console.log('\n— every hop carries the CB —');
const src = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const worker = src('worker/src/index.mjs'), sync = src('tools/sync-referrals.mjs'), ops = src('Chatterbox_AgentOS_Analytics.html'), tool = src('tools/fetch-referrals.mjs'), pulse = fs.readFileSync(HTML, 'utf8');
ok('Worker: /api/referrals rows carry cb from "CB Number"', worker.includes("fids('CB Number')") && worker.includes('cb: cbOfField(c)'));
ok('sync-referrals: the scheduled pull keeps cb in kv:referrals-latest', sync.includes("cb: x.cb || ''"));
ok('PULSE: the record maps cb to Employee Code', pulse.includes("'Employee Code':x.cb||''"));
ok('Ops: the API sync maps cb to Employee Code', ops.includes("'Employee Code':x.cb||''"));
ok('Ops: refCbOf lets the name win a clash', ops.includes('if(byCode&&state.cbInfo[byCode]&&!(byName&&state.cbInfo[byName]&&byName!==byCode))return byCode;'));
ok('tool: fetch-referrals reads "CB Number" with the same clash rule', tool.includes("fid('CB Number')") && tool.includes('!(byName && byName !== cbField)'));

/* the Worker's normaliser, run as written */
{
  const m = /const cbOfField = \(c\) => \{([\s\S]*?)\};\r?\n/.exec(worker);
  ok('the Worker normaliser is findable', !!m);
  if (m) {
    const fn = new Function('fval', 'CBNUM', 'return (c) => {' + m[1] + '};')((c) => c, null);
    ok('"CB458" / "cb-458" / "CB 0458" all read CB458', ['CB458', 'cb-458', 'CB 0458'].every((v) => fn(v) === 'CB458'));
    ok('a phone number or a bare number is not a CB', ['0821234567', '458', 'CB12345', ''].every((v) => fn(v) === ''));
  }
}

console.log('\n— PULSE decides the CB against the Agent List —');
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s); });
await new Promise((r) => server.listen(8191, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:8191/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

const ROWS = [
  { id: 'a', created: '2026-11-10', agent: 'Ayo', referrer: 'x', count: 2, cb: 'CB9458' },               // a first name alone: the CB settles it
  { id: 'b', created: '2026-11-10', agent: 'Bongi Sithole', referrer: 'x', count: 1, cb: 'CB9458' },     // CB says Ayodele, name EXACTLY says Bongi
  { id: 'c', created: '2026-11-10', agent: 'Ayodele Mkhize', referrer: 'x', count: 3, cb: 'CB9485' },    // CB not on the list: the name decides
  { id: 'd', created: '2026-11-10', agent: '', referrer: 'x', count: 1, cb: 'CB9301' },                  // no name at all
  { id: 'e', created: '2026-11-10', agent: 'Bongi Sithole', referrer: 'x', count: 4, cb: '' },           // the old path, untouched
];
const res = await page.evaluate((rows) => {
  const S = window.__mtd.state();
  S.roster = [
    { code: 'CB9458', name: 'Ayodele Mkhize', sf: 'Ayodele Mkhize', campaign: 'Cuddle', tl: 'TL A', tenure: 'Exp' },
    { code: 'CB9301', name: 'Bongi Sithole', sf: 'Bongi Sithole', campaign: 'Cuddle', tl: 'TL A', tenure: 'Exp' },
  ];
  INGEST._refStore(referralRecsFromRows(rows), 'verify-referrals-cb', (r) => ({ code: String(r['Employee Code'] || '').trim(),
    agent: String(r['Agent Name'] || '').trim(), cnt: parseInt(r['Referral Count'], 10) || 1, created: String(r['Created'] || '').slice(0, 10) }));
  return { by: S.refs.by, un: S.refs.un, noAgent: S.refs.noAgent };
}, ROWS);
ok('CB9458 = 2 (first name + CB) + 3 (the name rescues the typo\'d CB9485) = 5', res.by.CB9458 === 5, JSON.stringify(res));
ok('CB9301 = 1 (clash: the name wins) + 1 (CB, no name) + 4 (name only) = 6', res.by.CB9301 === 6, JSON.stringify(res));
ok('nothing is left unmatched or nameless', Object.keys(res.un).length === 0 && res.noAgent === 0, JSON.stringify(res));
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log(`\n==== ${pass} passed, ${fails.length} failed ====`);
if (fails.length) { console.log(fails.map((f) => '  · ' + f).join('\n')); process.exit(1); }
