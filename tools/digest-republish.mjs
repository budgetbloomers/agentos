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
    /* THE LEAVERS COME WITH THE RECORD (rule departures, 2026-09-15). /api/roster serves them from
       agent_list_leavers(); this tool reads the same function so the digest credits a leaver's
       days to them the way an open PULSE tab does — otherwise Agent Analytics would lag the rule
       by "until someone opens PULSE", the exact gap this tool exists to close. */
    try {
      const lr = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/agent_list_leavers`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_days: 90 }) });
      if (lr.ok) rv.leavers = (await lr.json()).map((r) => ({ code: r.code, name: r.name || '', sf: r.sf || '', callx: r.callx || '', tl: r.tl || '',
        campaign: r.campaign || '', tenure: r.tenure || '', target: r.target, start: r.start_date || '', left: r.left_on }));
      else console.warn('leavers not fetched (HTTP ' + lr.status + ') — publishing without them');
    } catch (e) { console.warn('leavers not fetched (' + String(e && e.message || e) + ') — publishing without them'); }
    const adopted = await page.evaluate((j) => {
      const S = window.__mtd.state();
      const leaversMoved = Array.isArray(j.leavers) && typeof adoptLeavers === 'function' ? adoptLeavers(j.leavers) : false;
      if (!j.fingerprint || j.fingerprint === S.rosterFp) { if (leaversMoved) window.__mtd.rebuild(); return { same: true, n: (S.roster || []).length, leavers: Object.keys(S.leavers || {}).length }; }
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
    console.log('roster of record: ' + (adopted.same ? 'blob already on this list (' + adopted.n + ' agents' + (adopted.leavers != null ? ', ' + adopted.leavers + ' leavers known — off the reports' : '') + ')'
      : adopted.refused ? 'NOT adopted — ' + adopted.refused
      : 'adopted ' + adopted.n + ' agents (blob had ' + adopted.before + ')' + (adopted.as_of ? ' as of ' + adopted.as_of : '')));
  }
}

/* ---- the campaign moves (sprint 2026-09-29, item 2; D4) ---- An open PULSE tab asks the Worker's
   /api/campaign-moves with its session; this tool has no session, so it runs the SAME derivation
   (worker/src/moves.mjs, imported — never a second implementation) over the same dated agent_list
   snapshots with the service key, and hands the result to the engine exactly as syncCampaignMoves
   stores it. Without this a headless publish would blend every mover's month again. */
{
  const { campaignMoves } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'moves.mjs')).href);
  const DBr = { select: async (q) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers: H });
    if (!r.ok) throw new Error(q.split('?')[0] + ' → ' + r.status); return r.json(); } };
  const live = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7);
  /* --history republishes past months too — they need their own moves or they revert to blended (review, 2026-09-29) */
  const back = (n) => { const d = new Date(live + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 7); };
  /* back(1) always: on the 1st the live month is empty and the month just closed is what publishes (rollover grace, 2026-10-01) */
  const want = [...new Set([live, back(1), (process.argv.find((a) => /^--month=\d{4}-\d{2}$/.test(a)) || '').slice(8),
    ...(process.argv.includes('--history') ? [back(2), back(3)] : [])].filter(Boolean))];
  for (const m of want) {
    try {
      const mv = await campaignMoves(DBr, m);
      await page.evaluate((x) => { const S = window.__mtd.state(); S.campaignMoves = S.campaignMoves || {};
        S.campaignMoves[x.month] = { agents: x.agents, at: x.updatedAt }; window.__mtd.rebuild(); }, mv);
      console.log('campaign moves ' + m + ': ' + Object.keys(mv.agents).length + ' mover(s)' + (Object.keys(mv.agents).length ? ' — ' + Object.keys(mv.agents).join(', ') : ''));
    } catch (e) { console.warn('campaign moves ' + m + ' not read (' + String(e && e.message || e) + ') — publishing with the copy already in the state'); }
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
  let payload0 = await page.evaluate(() => JSON.stringify(agentDigestPayload()));
  /* ROLLOVER GRACE (2026-10-01): on the 1st the new month has no rows, and the tool used to refuse the empty
     digest — so the month just closed never got its final day live ("1–29 September" on 1 October). An empty
     live month publishes the previous month instead; whether it may take the LIVE key is decided below
     against what the key holds (liveDigestAllowed). */
  if (!((JSON.parse(payload0) || {}).agents || []).length) {   // the engine returns null for a month with no rows (and both months empty → refused below)
    const d = new Date(new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1);
    const prev = d.toISOString().slice(0, 7);
    console.log('the live month has no rows yet — building the month just closed (' + prev + ')');
    payload0 = await buildFor(prev);
  }
  /* --dump=<file> writes the live payload locally for inspection (dry run or not) — nothing else */
  const dumpTo = (process.argv.find((a) => a.startsWith('--dump=')) || '').slice(7);
  if (dumpTo) { fs.writeFileSync(dumpTo, payload0); console.log('payload written to ' + dumpTo); }
  const m0 = ((JSON.parse(payload0) || {}).period?.from || '').slice(0, 7);
  jobs.push([null, payload0]);
  if (/^\d{4}-\d{2}$/.test(m0)) jobs.push([m0, payload0]);   // the live month IS its own history key
}
const payload = jobs.find(j => j[0] === null)?.[1] || jobs[0][1];
/* THE TEAM-LEADER REPORT KEYS (2026-09-21): kv:agent-reports-variance / -leads, built by the same
   engine over the same state, published beside the LIVE digest only (never for a history month).
   The leads book here is the vas-state copy of S.opencasesLM — the lake book as of the last PULSE
   session that adopted it (this tool has no session token, so syncLeadBookFromLake does not run). */
const reportJobs = [];
if (!argMonth && !HISTORY) {
  for (const kind of ['variance', 'leads']) {
    const body = await page.evaluate((k) => { const r = window.__mtd.reports && window.__mtd.reports(k); return r ? JSON.stringify(r) : ''; }, kind);
    if (!body) { console.log('report ' + kind + ': nothing to publish (no board/BI, or no case books in the state)'); continue; }
    const rj = JSON.parse(body);
    { const dp = (JSON.parse(payload) || {}).period || {}; if ((rj.period?.from || '') !== (dp.from || '') || (rj.period?.to || '') !== (dp.to || '')) { console.log('report ' + kind + ' is not the digest window — skipped'); continue; } }
    reportJobs.push([kind, body]);
    console.log('report ' + kind + ' built — ' + Object.keys(rj.agents || {}).length + ' agents, ' + Object.keys(rj.teams || {}).length + ' teams, ' + Math.round(body.length / 1024) + ' KB');
  }
}
await b.close(); server.close();
if (errs.length) { console.error('page errors: ' + errs.slice(0, 3).join(' | ')); process.exit(1); }

const p = JSON.parse(payload) || { agents: [] };   // null = both the live month and the month just closed are empty → refused below
const withDays = p.agents.filter(a => a.days && a.days.length).length;
const withScore = p.agents.filter(a => a.score != null).length;
console.log(`digest built by the deployed engine: ${p.agents.length} agents · ${withScore} with a score · ${withDays} with day rows · ${(p.weeks || []).length} weeks · ${Math.round(payload.length / 1024)} KB`);
if (!p.agents.length) { console.error('empty digest — refusing.'); process.exit(1); }
if (!withDays || !withScore) { console.error('the new fields are missing — is site/pulse the current build?'); process.exit(1); }

/* --out <file>: keep the built digest on disk, so a guard (verify-composite-recompute.mjs <file>) can
   prove a new build's numbers BEFORE anything is published (2026-09-28) */
{ const i = process.argv.indexOf('--out'); if (i > 0 && process.argv[i + 1]) { fs.writeFileSync(process.argv[i + 1], payload); console.log('digest written to ' + process.argv[i + 1]); } }
if (!APPLY) { console.log('\ndry run — nothing written. Re-run with --apply to publish.'); process.exit(0); }

/* ---- THE LIVE KEY'S MONTH RULE (2026-10-01) ---- This tool writes Storage directly, so the Worker's 409 never
   sees it — it asks the SAME rule itself (worker/src/rules.mjs, imported): the current month always; the month
   just closed only while the live key does not already hold the current month; nothing older. A refused live
   write still files the month's own history key; the report keys follow the live key. */
const { liveDigestAllowed } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'rules.mjs')).href);
const liveFromNow = async () => {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=eq.kv:agent-digest&select=value`, { headers: H });
  if (!r.ok) throw new Error('live digest not read (HTTP ' + r.status + ')');
  const row = (await r.json())[0];
  if (!row) return '';                                            // nothing has ever been live
  let v = row.value || {}; if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = {}; } }
  if (typeof v.period === 'string') return v.period;             // stamped on the pointer since 2026-10-01
  let t = String(v.data || '');
  if (!t && v.store) { const s = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${v.store}`, { headers: H }); if (s.ok) t = await s.text(); }
  /* a row whose digest will not read is "could not tell", never "nothing live" — fail closed (review, 2026-10-01) */
  if (!t) throw new Error('the live digest has a row but its object did not read');
  return String((JSON.parse(t).period || {}).from || '');
};
let liveWritten = false;
/* ---- publish exactly where the Worker reads (the backfill tool's write, verbatim) ---- */
for (const [mk, body] of jobs) {
  if (!mk) {
    const from = String((JSON.parse(body).period || {}).from || '');
    const liveFrom = await liveFromNow();
    if (!liveDigestAllowed(from, liveFrom, Date.now())) {
      console.log('live key NOT written — ' + (from || 'no period') + ' may not replace the live ' + (liveFrom || 'nothing') + ' (current month always wins; the month just closed only until it publishes)');
      continue;
    }
    liveWritten = true;
  }
  const keyName = mk ? 'agent-digest-' + mk : 'agent-digest';
  const store = 'raw/kv/' + keyName;
  const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${store}`, {
    method: 'PUT', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body });
  if (!put.ok) { console.error(keyName + ' storage write failed: ' + put.status + ' ' + (await put.text()).slice(0, 200)); process.exit(1); }
  /* upsert, not PATCH: a month never published before has no row to patch. */
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?on_conflict=key`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key: 'kv:' + keyName, value: mk ? { store, updated_at: new Date().toISOString() }
      : { store, period: String((JSON.parse(body).period || {}).from || ''), updated_at: new Date().toISOString() } }]) });   // the live pointer carries its period — the Worker's fence reads it cheaply
  if (!r.ok) { console.error(keyName + ' rules write failed: ' + r.status + ' ' + (await r.text()).slice(0, 200)); process.exit(1); }
  const pj = JSON.parse(body);
  console.log('published ' + keyName + ' — ' + pj.agents.length + ' agents, ' + (pj.period ? pj.period.from + '..' + pj.period.to : '?'));
}
for (const [kind, body] of reportJobs) {
  if (!liveWritten) { console.log('agent-reports-' + kind + ' not written — the live digest was not'); continue; }
  const keyName = 'agent-reports-' + kind, store = 'raw/kv/' + keyName;
  const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${store}`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body });
  if (!put.ok) { console.error(keyName + ' storage write failed: ' + put.status + ' ' + (await put.text()).slice(0, 200)); process.exit(1); }
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?on_conflict=key`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key: 'kv:' + keyName, value: { store, updated_at: new Date().toISOString() } }]) });
  if (!r.ok) { console.error(keyName + ' rules write failed: ' + r.status + ' ' + (await r.text()).slice(0, 200)); process.exit(1); }
  console.log('published ' + keyName);
}
console.log('done. The Worker edge/memory caches hold old copies for up to 5 minutes.');
