/* REPUBLISH THE WEEKLY REVIEW FROM THE LIVE DATA — the bridge after a publisher change.
 *
 * kv:nba-digest is written by the Ops app itself (the cbx-nba-push block), on a timer, from
 * whatever session happens to be open. That is fine day to day and useless the moment the
 * publisher changes: until somebody opens the management dashboard on the new build, every
 * agent and team leader keeps reading the OLD payload. On 2026-08-31 that payload ran over
 * 2025-10-01 to 2026-08-28 — eleven months — so every agent's own page suppressed its next
 * best action and said so, which is what a floor of people actually saw.
 *
 * This drives the DEPLOYED Ops build headlessly over the live stores, lets the real engine
 * build the real payload (the same window.__nbaPush the app publishes with), and writes it
 * where the Worker reads. Nothing here computes a figure — non-negotiable 1.
 *
 *   node tools/nba-republish.mjs           # build + report, write nothing
 *   node tools/nba-republish.mjs --apply   # build + publish
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const APPLY = process.argv.includes('--apply');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };

/* ---- the live stores, read-only. Only what acStats actually reads. ---- */
const get = async (key) => {
  const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/${key}`, { headers: H });
  if (!r.ok) return null;
  return await r.text();
};
const config = JSON.parse(await get('cb-config') || '{}');
const SRCS = ['AGENT_LIST', 'ATTENDANCE', 'QA_EVALUATIONS', 'BI_ACTIVE_CASES',
  'CALLX_CALL_RECORDS', 'VICI_CALL_REPORT', 'SF_OPEN_CASES', 'SF_CLOSED_CASES', 'SF_INACTIVE'];
const facts = {};
let bytes = 0;
for (const s of SRCS) {
  const t = await get('cb-facts-' + s);
  if (!t) { console.log('  (no ' + s + ')'); continue; }
  bytes += t.length; facts[s] = t;
  console.log('  ' + s.padEnd(22) + (t.length / 1048576).toFixed(1).padStart(6) + ' MB');
}
console.log('live stores: ' + (bytes / 1048576).toFixed(1) + ' MB\n');

/* ---- the deployed build, headless ---- */
const HTML = path.join(ROOT, 'site', 'index.html');
const SIDE = { '/xlsx.full.min.js': path.join(ROOT, 'site', 'xlsx.full.min.js'),
  '/auth-gate.js': path.join(ROOT, 'site', 'auth-gate.js'),
  '/ask-widget.js': path.join(ROOT, 'site', 'ask-widget.js') };
const server = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const p = SIDE[u] || (u === '/' || u === '/index.html' ? HTML : null);
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise((r) => server.listen(8251, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
await page.goto('http://127.0.0.1:8251/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.acStats === 'function' && typeof window.__nbaPush === 'function',
  null, { timeout: 45000 });

/* State goes in one source at a time — a single evaluate carrying 70 MB is what makes this
   fall over, and the failure looks like a hang rather than an error. */
await page.evaluate((cfg) => {
  const o = JSON.parse(cfg);
  for (const k of ['kpis', 'rules', 'agentMap', 'sfOwnerMap', 'cbInfo', 'user']) if (o[k]) state[k] = o[k];
  state.facts = state.facts || {};
}, JSON.stringify(config));
for (const [src, text] of Object.entries(facts)) {
  await page.evaluate(([s, t]) => { state.facts[s] = JSON.parse(t); }, [src, text]);
  console.log('  loaded ' + src);
}
/* ---- the roster of record ---- cb-facts-AGENT_LIST is whatever the last signed-in Ops tab
   saved; the LIST is /api/roster (kv:roster-current), which a headless publish or the VAS
   station may have moved on since. Adopt it the way Ops's syncRosterFromVAS does — same row
   mapping, same applyLoad, same fingerprint — so the ladder never lags the list by "until
   someone opens Ops". Nothing is saved back here; the next real Ops session syncs itself. */
const rc = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=eq.kv:roster-current&select=value`, { headers: H });
if (rc.ok) {
  let rv = ((await rc.json())[0] || {}).value; if (typeof rv === 'string') { try { rv = JSON.parse(rv); } catch {} }
  if (rv && Array.isArray(rv.roster) && rv.roster.length) {
    const adopted = await page.evaluate((j) => {
      j.roster = j.roster.filter(a => a && String(a.code || '').trim() && String(a.name || '').trim());
      if (!j.roster.length) return { refused: 'empty payload' };
      const cur = (state.batches || []).find(b => b.source_type === 'AGENT_LIST' && b.validation_status !== 'failed');
      if (cur && cur.file_hash === j.fingerprint) return { same: true, n: Object.keys(state.cbInfo || {}).length };
      const rows = j.roster.map(a => ({ 'Employee Code': a.code, 'Agent Name': a.name, 'Team Leader': a.tl, 'Campaign': a.campaign,
        'Tenure': a.tenure, 'Call x': a.callx, 'Sales Force': a.sf, 'Target': a.target, 'Start Date': a.start }));
      const before = Object.keys(state.cbInfo || {}).length;
      const res = applyLoad('AGENT_LIST', { name: 'Agent List — published' + (j.as_of ? ' (as of ' + j.as_of + ')' : '') },
        { data: rows, textHash: j.fingerprint }, 'roster of record, adopted by tools/nba-republish');
      if (typeof autoMapAgents === 'function') autoMapAgents();
      return { before, n: res && res.loaded, as_of: j.as_of || null };
    }, rv);
    console.log('roster of record: ' + (adopted.same ? 'facts already on this list (' + adopted.n + ' agents)'
      : adopted.refused ? 'NOT adopted — ' + adopted.refused
      : 'adopted ' + adopted.n + ' agents (facts had ' + adopted.before + ')' + (adopted.as_of ? ' as of ' + adopted.as_of : '')));
  }
}

await page.evaluate(() => { if (typeof _dataVer !== 'undefined') _dataVer++; });

const out = await page.evaluate(() => {
  const before = window.storage && window.storage.set;
  let written = null;
  window.storage = Object.assign({}, window.storage, { set: (k, v) => { if (k === 'nba-digest') written = v; } });
  sessionStorage.setItem('cbx_token', 'republish');
  window.__nbaPush();
  if (before) window.storage.set = before;
  return { payload: written, agents: Object.keys(state.cbInfo || {}).length };
});
await b.close(); server.close();

if (errs.length) console.log('page errors: ' + errs.slice(0, 3).join(' | '));
if (!out.payload) { console.error('the publisher produced nothing — is the roster loaded? cbInfo=' + out.agents); process.exit(1); }
const p = JSON.parse(out.payload);
const days = (a, b2) => Math.round((Date.parse(b2) - Date.parse(a)) / 86400000) + 1;
console.log('\nbuilt by the deployed engine: ' + p.agents.length + ' agents · '
  + p.period.from + ' → ' + p.period.to + ' (' + days(p.period.from, p.period.to) + ' days, '
  + p.workDays + ' working) · ' + Math.round(out.payload.length / 1024) + ' KB');
const withNba = p.agents.filter((a) => a.nba && a.nba.code).length;
const lvl = {}; p.agents.forEach((a) => { const l = a.nba && a.nba.lvl; lvl[l] = (lvl[l] || 0) + 1; });
console.log('  ladder rows: ' + withNba + ' · by level ' + JSON.stringify(lvl));
const showFlag = process.argv.indexOf('--show');
const SHOW = showFlag > 0 ? (process.argv[showFlag + 1] || '') : '';
if (SHOW) { for (const cb of SHOW.split(',')) { const a2 = p.agents.find((x) => String(x.cb).toUpperCase() === cb.toUpperCase());
  console.log('  ' + cb + ': ' + (a2 ? JSON.stringify({ta:a2.twoCheck.ta, gwpSale:a2.twoCheck.gwpSale, value:a2.twoCheck.value,
    volume:a2.twoCheck.volume, status:a2.twoCheck.status, sales:a2.stats.sales, present:a2.stats.present,
    sched:a2.stats.scheduled, target:a2.stats.target, nba:a2.nba.code}) : 'not found')); } }
console.log('  two-check:   ' + JSON.stringify(p.agents.reduce((m, a) => {
  const s = a.twoCheck && a.twoCheck.status; m[s] = (m[s] || 0) + 1; return m; }, {})));

/* The guard this whole exercise exists for: the review must be THIS month. */
if (!/^\d{4}-\d{2}-01$/.test(p.period.from) || p.period.to.slice(0, 7) !== p.period.from.slice(0, 7)) {
  console.error('REFUSING: the window is not a single reporting month — ' + JSON.stringify(p.period));
  process.exit(1);
}
if (!p.agents.length) { console.error('REFUSING: empty payload'); process.exit(1); }
if (!APPLY) { console.log('\ndry run — nothing written. Re-run with --apply to publish.'); process.exit(0); }

const store = 'raw/kv/nba-digest';
const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${store}`, {
  method: 'PUT', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: out.payload });
if (!put.ok) { console.error('storage write failed: ' + put.status + ' ' + (await put.text()).slice(0, 200)); process.exit(1); }
const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?on_conflict=key`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify([{ key: 'kv:nba-digest', value: { store, updated_at: new Date().toISOString() }, updated_by: 'nba-republish' }]) });
if (!r.ok) { console.error('rules write failed: ' + r.status + ' ' + (await r.text()).slice(0, 200)); process.exit(1); }
console.log('\npublished kv:nba-digest — ' + p.agents.length + ' agents over ' + p.period.from + '..' + p.period.to);
console.log('The Worker caches it for 60s; agent and team leader pages pick it up on their next load.');
