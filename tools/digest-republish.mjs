/* REPUBLISH THE AGENT DIGEST FROM THE LIVE STATE — the bridge after a digest-shape change.
 *
 * Agent Analytics is a VIEW over VAS's data (Nick, 2026-08-26: "all the data should pull —
 * we are just giving the TL and agents separate views"). The digest normally republishes
 * within ~90s of a signed-in VAS session being open — but a change to the digest's SHAPE
 * (score, per-day rows, weeks) leaves the copy in Supabase in the old shape until someone
 * opens VAS on the new build, and every portal page depending on the new fields shows its
 * degrade text until then. Same gap tools/digest-backfill-tl.mjs bridged for `tl`.
 *
 * This closes it without waiting and without a second implementation of anything: it drives
 * the DEPLOYED build (site/pulse) headlessly over the live kv:vas-state, lets the real
 * engine build the real payload (agentDigestPayload — the same function the app publishes
 * with), and writes it where the Worker reads it, exactly as digest-backfill-tl.mjs writes.
 * Nothing here computes a figure.
 *
 *   node tools/digest-republish.mjs           # dry run: build + report, write nothing
 *   node tools/digest-republish.mjs --apply   # build + publish
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* playwright lives in nicks_code/diagnostics' node_modules — resolve it from
   there so this tool runs from anywhere without its own install. */
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const APPLY = process.argv.includes('--apply');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };

/* ---- the live state, read-only ---- */
const st = await fetch(`${env.SUPABASE_URL}/storage/v1/object/raw/kv/vas-state`, { headers: H });
if (!st.ok) { console.error('cannot read vas-state: ' + st.status); process.exit(2); }
const blob = await st.text();
console.log('live state: ' + (blob.length / 1048576).toFixed(2) + ' MB');

/* ---- the deployed build, headless ---- */
const HTML = path.join(ROOT, 'site', 'pulse', 'index.html');
const SERVE = { '/': HTML, '/index.html': HTML };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(p).pipe(s); });
await new Promise(r => server.listen(8185, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto('http://127.0.0.1:8185/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(x => { const S = window.__mtd.state(); const o = JSON.parse(x);
  for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, blob);

/* ---- the roster of record ---- The blob's roster is whatever the last signed-in PULSE tab
   saved; the LIST is what /api/roster serves (kv:roster-current), which a headless publish
   (tools/publish-agent-list.mjs) or the other station may have moved on since. Adopt it the
   way PULSE's adoptRosterFromRecord does — same row mapping, same INGEST.roster, same
   fingerprint — so the digest never lags the list by "until someone opens PULSE". Nothing
   is written back to vas-state here; the next real PULSE session adopts and saves itself. */
const rc = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=eq.kv:roster-current&select=value`, { headers: H });
if (rc.ok) {
  let rv = ((await rc.json())[0] || {}).value; if (typeof rv === 'string') { try { rv = JSON.parse(rv); } catch {} }
  if (rv && Array.isArray(rv.roster) && rv.roster.length) {
    const adopted = await page.evaluate((j) => {
      const S = window.__mtd.state();
      if (!j.fingerprint || j.fingerprint === S.rosterFp) return { same: true, n: (S.roster || []).length };
      const rows = j.roster.filter(a => a && String(a.code || '').trim() && String(a.name || '').trim())
        .map(a => ({ 'Employee Code': a.code, 'Agent Name': a.name, 'Sales Force': a.sf || a.name,
          'Team Leader': a.tl || '', 'Campaign': a.campaign || '', 'Tenure': a.tenure || '',
          'Call x': a.callx || '', 'Target': a.target, 'Start Date': a.start || '' }));
      if (!rows.length) return { refused: 'empty payload' };
      const before = (S.roster || []).length;
      const res = INGEST.roster(rows, 'Agent List — published' + (j.as_of ? ' as of ' + j.as_of : ''), null);
      if (!res || !(S.roster || []).length) return { refused: 'ingest refused', before };
      S.rosterFp = j.fingerprint; window.__mtd.rebuild();
      return { before, n: S.roster.length, as_of: j.as_of || null };
    }, rv);
    console.log('roster of record: ' + (adopted.same ? 'blob already on this list (' + adopted.n + ' agents)'
      : adopted.refused ? 'NOT adopted — ' + adopted.refused
      : 'adopted ' + adopted.n + ' agents (blob had ' + adopted.before + ')' + (adopted.as_of ? ' as of ' + adopted.as_of : '')));
  }
}

/* --month YYYY-MM builds a PAST month: the engine's own period switch, then the same
   payload function — the portal's month filter reads what this publishes. --history walks
   every month the sales data covers and publishes each, so the filter has a past to offer
   the day it ships. No flag = the live month, exactly as before. */
const argMonth = (process.argv.find(a => /^--month=\d{4}-\d{2}$/.test(a)) || '').slice(8);
const HISTORY = process.argv.includes('--history');
const buildFor = async (month) => {
  await page.evaluate((m) => { window.__mtd.setPeriod(m, 'calendar'); }, month);
  return await page.evaluate(() => JSON.stringify(agentDigestPayload()));
};
const monthsAvailable = await page.evaluate(() => {
  const S = window.__mtd.state(); const ms = new Set();
  for (const d in (S.sales || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) ms.add(d.slice(0, 7));
  return [...ms].sort();
});
console.log('months with sales data: ' + monthsAvailable.join(' '));

const jobs = [];   // [monthKeyOrNull, payload] — null key = the live kv:agent-digest
if (argMonth) {
  jobs.push([argMonth, await buildFor(argMonth)]);
} else if (HISTORY) {
  for (const m of monthsAvailable) jobs.push([m, await buildFor(m)]);
  jobs.push([null, await buildFor(monthsAvailable[monthsAvailable.length - 1])]);
} else {
  const payload0 = await page.evaluate(() => JSON.stringify(agentDigestPayload()));
  const m0 = (JSON.parse(payload0).period?.from || '').slice(0, 7);
  jobs.push([null, payload0]);
  if (/^\d{4}-\d{2}$/.test(m0)) jobs.push([m0, payload0]);   // the live month IS its own history key
}
const payload = jobs.find(j => j[0] === null)?.[1] || jobs[0][1];
await b.close(); server.close();
if (errs.length) { console.error('page errors: ' + errs.slice(0, 3).join(' | ')); process.exit(1); }

const p = JSON.parse(payload);
const withDays = p.agents.filter(a => a.days && a.days.length).length;
const withScore = p.agents.filter(a => a.score != null).length;
console.log(`digest built by the deployed engine: ${p.agents.length} agents · ${withScore} with a score · ${withDays} with day rows · ${(p.weeks || []).length} weeks · ${Math.round(payload.length / 1024)} KB`);
if (!p.agents.length) { console.error('empty digest — refusing.'); process.exit(1); }
if (!withDays || !withScore) { console.error('the new fields are missing — is site/pulse the current build?'); process.exit(1); }

if (!APPLY) { console.log('\ndry run — nothing written. Re-run with --apply to publish.'); process.exit(0); }

/* ---- publish exactly where the Worker reads (the backfill tool's write, verbatim) ---- */
for (const [mk, body] of jobs) {
  const keyName = mk ? 'agent-digest-' + mk : 'agent-digest';
  const store = 'raw/kv/' + keyName;
  const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${store}`, {
    method: 'PUT', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body });
  if (!put.ok) { console.error(keyName + ' storage write failed: ' + put.status + ' ' + (await put.text()).slice(0, 200)); process.exit(1); }
  /* upsert, not PATCH: a month never published before has no row to patch. */
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?on_conflict=key`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key: 'kv:' + keyName, value: { store, updated_at: new Date().toISOString() } }]) });
  if (!r.ok) { console.error(keyName + ' rules write failed: ' + r.status + ' ' + (await r.text()).slice(0, 200)); process.exit(1); }
  const pj = JSON.parse(body);
  console.log('published ' + keyName + ' — ' + pj.agents.length + ' agents, ' + (pj.period ? pj.period.from + '..' + pj.period.to : '?'));
}
console.log('done. The Worker edge/memory caches hold old copies for up to 5 minutes.');
