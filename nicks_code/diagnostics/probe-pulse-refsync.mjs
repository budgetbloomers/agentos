// PULSE referrals auto-sync from the HighLevel API (endpoint intercepted with real rows).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const j = (...p) => path.join(...p);
const SERVE = { '/': j(REPO, 'nicks_code', 'index.html'), '/index.html': j(REPO, 'nicks_code', 'index.html'), '/xlsx.full.min.js': j(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((req, res) => { const p = SERVE[req.url.split('?')[0]]; if (!p || !fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(p).pipe(res); });
await new Promise(r => server.listen(8135, '127.0.0.1', r));

const refCsv = fs.readdirSync(j(REPO, 'uploads')).filter(n => /^referrals-highlevel-.*\.csv$/.test(n)).sort().pop();
const lines = fs.readFileSync(j(REPO, 'uploads', refCsv), 'utf8').split(/\r?\n/).filter(l => l);
const parse = l => { const o = []; let c = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = ''; } else c += ch; } o.push(c); return o; };
const hdr = parse(lines[0]);
const rows = lines.slice(1).map(l => { const c = parse(l); const g = n => c[hdr.indexOf(n)] || ''; return { id: g('Contact Id'), created: g('Created'), agent: g('Agent Name'), referrer: g('Referrer'), count: parseInt(g('Referral Count'), 10) || 1 }; });

const b = await chromium.launch();
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route('**/api/referrals**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows, contacts: rows.length, pulled_at: new Date().toISOString() }) }));
await p.goto('http://127.0.0.1:8135/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await p.setInputFiles('#fileInput', [j(REPO, 'uploads', '2026-08-13', 'Matrix - Agent List.xlsx')], { timeout: 60000 });
await p.waitForTimeout(3000);
await p.evaluate(() => { sessionStorage.setItem('cbx_token', 'harness'); window.__hlSyncVAS(true); });
await p.waitForFunction(() => { const S = window.__mtd.state(); return S.refs && Object.keys(S.refs.by || {}).length > 50; }, null, { timeout: 30000 });
const s = await p.evaluate(() => { const S = window.__mtd.state(); return { agents: Object.keys(S.refs.by).length, total: S.refs.total, unmatched: Object.keys(S.refs.un || {}).length, file: S.refs.f, reg: (S.files || []).filter(f => f.type === 'referrals').length }; });
console.log(JSON.stringify(s));
console.log(s.agents >= 55 && s.total >= 1500 && s.file === 'HighLevel API' && s.reg === 1 ? 'PASS: PULSE auto-sync pulls and ingests from the API' : 'FAIL');

// the production race: a cloud hydrate adopts a blob WITHOUT refs — the watchdog must
// notice the emptied store and re-sync on its own within ~10s (no user action)
await p.evaluate(() => { const S = window.__mtd.state(); S.refs = null; window.__vasHydrated = true; });
await p.waitForFunction(() => { const S = window.__mtd.state(); return S.refs && Object.keys(S.refs.by || {}).length > 50; }, null, { timeout: 20000 });
const s2 = await p.evaluate(() => Object.keys(window.__mtd.state().refs.by).length);
console.log(s2 >= 55 ? 'PASS: watchdog restored the referrals after a hydrate wiped them (' + s2 + ' agents)' : 'FAIL: watchdog did not restore');
console.log('errors:', errs.slice(0, 3).join(' | ') || 'none');
await b.close(); server.close();
process.exit(s.agents >= 55 && s.total >= 1500 && s2 >= 55 ? 0 : 1);
