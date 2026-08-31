/* LIVE INTEGRITY — the ponytail probe, over angles the other suites do not assert.
 *   1. duplicates, with the engine's own rangeAgg exemption
 *   2. the composite's INTERNAL arithmetic on every rated agent: renormalisation,
 *      "absence is not a nought" (non-negotiable 6), the penalty cap, the sign-in bonus
 *   3. lag: every page in PAGES, rendered over the live model
 * Cross-tab sales/GWP agreement is deliberately NOT re-checked here — verify-all-tabs owns it.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const HTML = path.join(REPO, 'site', 'pulse', 'index.html');
const TABS = ['dashboard', 'agents', 'leaderboard', 'coaching', 'mtd', 'weekly', 'daily',
  'attend', 'leads', 'variance', 'data', 'adjust', 'hubs', 'settings', 'manual'];
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + ' — ' + d); } };

const e = Object.fromEntries(fs.readFileSync(path.join(REPO, 'supabase.env'), 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: e.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + e.SUPABASE_SECRET_KEY };
const r = await fetch(e.SUPABASE_URL + '/storage/v1/object/raw/kv/vas-state', { headers: H, signal: AbortSignal.timeout(90000) });
if (!r.ok) { console.log('(skipping — cannot read live state: ' + r.status + ')'); process.exit(0); }
const blob = await r.text();
console.log('live state: ' + (blob.length / 1048576).toFixed(2) + ' MB');

const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s); });
await new Promise(x => server.listen(8177, '127.0.0.1', x));

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', x => errors.push(x.message));
page.on('dialog', d => d.accept());
await page.goto('http://127.0.0.1:8177/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(b => { const S = window.__mtd.state(); const j = JSON.parse(b);
  for (const k of Object.keys(j)) S[k] = j[k]; window.__mtd.rebuild(); }, blob);

/* ---------- 1. DUPLICATES ---------- */
console.log('\n-- 1. duplicates');
const dup = await page.evaluate(() => {
  const S = window.__mtd.state(), M = window.__mtd.model();
  const cnt = arr => { const m = {}; arr.forEach(k => m[k] = (m[k] || 0) + 1); return Object.entries(m).filter(([, n]) => n > 1); };
  const days = (M.facts || []).filter(f => !f.rangeAgg);
  return { rosterDup: cnt(S.roster.map(a => String(a.code || '').toUpperCase())),
    factDup: cnt(days.map(f => f.code + '|' + f.date)),
    agentDup: cnt((M.agents || []).map(a => a.code)),
    fileDup: cnt((S.files || []).map(f => (f.hash || '') + '|' + (f.type || '')).filter(k => !k.startsWith('|'))),
    ranged: (M.facts || []).filter(f => f.rangeAgg).length,
    n: { roster: S.roster.length, facts: (M.facts || []).length, agents: (M.agents || []).length, files: (S.files || []).length } };
});
console.log('   ' + JSON.stringify(dup.n) + ' · rangeAgg rows: ' + dup.ranged);
ok('no agent appears twice on the Agent List', dup.rosterDup.length === 0, JSON.stringify(dup.rosterDup));
ok('no agent-day is recorded twice', dup.factDup.length === 0, JSON.stringify(dup.factDup.slice(0, 5)));
ok('no agent appears twice in the model', dup.agentDup.length === 0, JSON.stringify(dup.agentDup));
ok('no file is ingested twice into the same sheet type', dup.fileDup.length === 0, JSON.stringify(dup.fileDup.slice(0, 5)));

/* ---------- 2. THE COMPOSITE'S OWN ARITHMETIC ---------- */
console.log('\n-- 2. the composite, on every rated agent');
const comp = await page.evaluate(() => {
  const M = window.__mtd.model(), R = window.__mtd.compositeRules();
  const cap = ((R && R.adjustments) || {});
  const bad = { nan: [], range: [], unmeasuredScored: [], denom: [], sum: [], overAvail: [], signIn: [], penalty: [] };
  let n = 0, unmeasuredSeen = 0;
  for (const a of (M.agents || [])) {
    const c = window.__mtd.composite(a.code);
    if (!c || !c.rated) continue;
    n++;
    const parts = c.parts || [];
    const v = c.adj != null ? c.adj : c.score;
    if (!isFinite(v)) { bad.nan.push(a.code + '=' + v); continue; }
    if (v < 0 || v > 100) bad.range.push(a.code + '=' + v);

    for (const p of parts) {
      if (p.measured === false) {
        unmeasuredSeen++;
        // ABSENCE IS NOT A NOUGHT: an unmeasured driver must not score and must not
        // occupy weight — if it did, the agent is being marked zero for a missing file.
        if ((p.points || 0) !== 0 || (p.available || 0) !== 0)
          bad.unmeasuredScored.push(a.code + ' ' + p.k + ' pts=' + p.points + ' avail=' + p.available);
      }
      if ((p.points || 0) > (p.available || 0) + (p.w || 0) + 0.01)
        bad.overAvail.push(a.code + ' ' + p.k + ' pts=' + p.points + ' > avail=' + p.available);
    }
    // the denominator is the weight of the MEASURED drivers, and nothing else
    const wMeasured = parts.filter(p => p.measured !== false).reduce((t, p) => t + (p.w || 0), 0);
    if (c.weightScored != null && Math.abs(c.weightScored - wMeasured) > 0.01)
      bad.denom.push(a.code + ' weightScored=' + c.weightScored + ' vs measured w=' + wMeasured);
    // score renormalises across those drivers
    const pts = parts.filter(p => p.measured !== false).reduce((t, p) => t + (p.points || 0), 0);
    const want = wMeasured > 0 ? pts / wMeasured * 100 : 0;
    if (Math.abs(want - c.score) > 0.75) bad.sum.push(a.code + ' score=' + c.score + ' vs Σpoints/Σw=' + Math.round(want * 100) / 100);
    // adj = score - penalties + signIn, and the penalty is capped
    const si = c.signIn || 0;
    if (si < 0 || si > 5) bad.signIn.push(a.code + '=' + si);
    if (c.penaltyTotal != null && c.adj != null) {
      const want2 = Math.max(0, Math.min(100, c.score - c.penaltyTotal + si));
      if (Math.abs(want2 - c.adj) > 0.75) bad.penalty.push(a.code + ' adj=' + c.adj + ' vs score-pen+signIn=' + Math.round(want2 * 100) / 100);
    }
  }
  return { n, unmeasuredSeen, bad, cap };
});
console.log('   rated ' + comp.n + ' agents · unmeasured driver slots seen: ' + comp.unmeasuredSeen);
ok('every composite is a finite number', comp.bad.nan.length === 0, comp.bad.nan.join(', '));
ok('every composite sits in 0..100', comp.bad.range.length === 0, comp.bad.range.join(', '));
ok('an UNMEASURED driver scores nothing and holds no weight (absence is not a nought)',
  comp.bad.unmeasuredScored.length === 0, comp.bad.unmeasuredScored.slice(0, 4).join(' | '));
ok('no driver awards more points than it has available', comp.bad.overAvail.length === 0, comp.bad.overAvail.slice(0, 4).join(' | '));
ok('the denominator is exactly the measured drivers\u2019 weight', comp.bad.denom.length === 0, comp.bad.denom.slice(0, 4).join(' | '));
ok('the score IS \u03a3points renormalised over that weight', comp.bad.sum.length === 0, comp.bad.sum.slice(0, 4).join(' | '));
ok('the adjusted score is score \u2212 penalty + sign-in, clamped', comp.bad.penalty.length === 0, comp.bad.penalty.slice(0, 4).join(' | '));
ok('the sign-in bonus never leaves 0..5', comp.bad.signIn.length === 0, comp.bad.signIn.join(', '));

/* ---------- 3. LAG ---------- */
console.log('\n-- 3. lag (deployed build, live data)');
const timings = [];
for (const t of TABS) {
  const ms = await page.evaluate(async tab => { const t0 = performance.now(); window.__mtd.go(tab);
    await new Promise(x => requestAnimationFrame(() => requestAnimationFrame(x)));
    return Math.round(performance.now() - t0); }, t);
  timings.push([t, ms]);
}
timings.sort((a, b) => b[1] - a[1]);
timings.forEach(([t, ms]) => console.log('   ' + String(ms).padStart(6) + ' ms  ' + t));
ok('every tab renders in under 1.2 s on live data', timings.every(([, ms]) => ms <= 1200),
  JSON.stringify(timings.filter(([, ms]) => ms > 1200)));
ok('no page errors during the whole probe', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
failures.forEach(f => console.log('FAIL: ' + f));
await browser.close(); server.close();
