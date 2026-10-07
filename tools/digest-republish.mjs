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
 *
 * Since 2026-10-01 (spec 001-cm-view-signoff) it ALSO publishes the BILLING-MONTH digests the campaign managers
 * open — kv:agent-digest-cycle-YYYY-MM (26th of the month before to the 25th of YYYY-MM) for the last complete
 * cycle and the one in progress, built by the same engine through the period switch setPeriod(m,'cycle').
 * Browsers never publish a cycle, and this never touches the live kv:agent-digest from a cycle build.
 *
 * Since 2026-10-06 (spec 006-cm-custom-range) it ALSO builds the custom date ranges campaign managers ask for: the Worker
 * queues an unbuilt range in kv:cm-range-requests; this run builds each waiting one (and rebuilds one still filling)
 * through __mtd.setRange(from,to), publishes kv:agent-digest-range-… + kv:agent-reports-variance|leads-range-… with a
 * pointer {store, period, kind:'range'}, and writes {status:'built'|'refused', reason?} back to the request. Same rules as
 * the cycles: its own keys only, under --apply only, each range an island that can never fail the live publish.
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
/* the billing-cycle definition is the Worker's (one definition, imported — never re-derived here) */
const { cyclesNow } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'cycle.mjs')).href);
/* …and the custom-range definition + queue rules are the Worker's too (spec 006) */
const { rangeOf, rangeFilling, queueList, settleQueue, RANGE_QUEUE_KEY } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'range.mjs')).href);
const movesFailed = new Set();   // months whose campaign-moves read threw — a cycle touching one is refused
/*CYCLE-JOBS-BEGIN*/
/* the two cycles a manager can open at nowMs: the last complete one, then the one in progress — each with the
   Storage name it publishes under and the calendar months whose campaign moves its days need */
const cycleJobsFor = (nowMs) => { const c = cyclesNow(nowMs);
  return [c.last, c.current].map((x) => ({ key: x.key, name: 'agent-digest-' + x.key, from: x.from, to: x.to, complete: x.complete,
    months: [...new Set([x.from.slice(0, 7), x.to.slice(0, 7)])] })); };
/* a cycle is only published WHOLE: refused (with the reason) when a campaign-moves read failed for either month it
   touches, or when the engine's data does not reach back to the cycle's start (first covered day more than 3 days
   after `from` — a weekend or a holiday may open it, a missing week may not). '' = fine. */
const cycleRefusal = (job, cp) => {
  const bad = job.months.filter((mo) => movesFailed.has(mo));
  if (bad.length) return 'the campaign-moves read failed for ' + bad.join(', ') + ' — its movers would be blended';
  const first = [...((cp && cp.dates) || [])].sort()[0];
  if (!first) return 'the payload carries no dates';
  const late = Math.round((Date.parse(first + 'T00:00:00Z') - Date.parse(job.from + 'T00:00:00Z')) / 86400000);
  return late > 3 ? 'its data starts ' + first + ', ' + late + ' days after the cycle begins (' + job.from + ') — the start is missing' : '';
};
/*CYCLE-JOBS-END*/
/*RANGE-JOBS-BEGIN*/
/* THE CUSTOM RANGES THE CAMPAIGN MANAGERS ASKED FOR (spec 006-cm-custom-range, contract C5). The Worker queues a range in
   kv:cm-range-requests the first time a manager asks for it. This run builds every WAITING one (oldest ask first), then
   rebuilds every one still FILLING — its last day within the last 2 days, so its figures can still move (FR-008) — a
   refused one included, since the missing days may have landed since. Every entry is re-validated with the Worker's own
   rangeOf (the queue is never trusted): an invalid key or a duplicate is never built. At most RANGE_BUILDS_MAX builds and
   RANGE_BUDGET_MS of building per run — a burst waits for the next tick rather than overrunning this one. */
const RANGE_BUILDS_MAX = 8;
const RANGE_BUDGET_MS = 240000;
const monthsOf = (from, to) => { const out = [], d = new Date(from.slice(0, 7) + '-01T00:00:00Z');
  while (d.toISOString().slice(0, 7) <= to.slice(0, 7)) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return out; };
const rangeJobsFor = (requests, nowMs) => {
  const seen = new Set(), waiting = [], filling = [];
  for (const q of Array.isArray(requests) ? requests : []) {
    const r = q ? rangeOf(q.key, nowMs) : null;
    if (!r || seen.has(r.key)) continue;
    seen.add(r.key);
    const job = { key: r.key, name: 'agent-digest-' + r.key, from: r.from, to: r.to, label: r.label, at: String(q.at || ''), months: monthsOf(r.from, r.to),
      was: q.status || 'waiting' };   // 'built' = already published: a refused REBUILD must not flip it (rangeOutcome)
    if ((q.status || 'waiting') === 'waiting') waiting.push({ ...job, why: 'waiting' });
    else if (rangeFilling(r.to, nowMs)) filling.push({ ...job, why: 'filling' });
  }
  waiting.sort((a, b) => a.at.localeCompare(b.at));
  return [...waiting, ...filling].slice(0, RANGE_BUILDS_MAX);
};
/* a range is only published WHOLE. Refused — with a reason the manager reads on the page — when the engine has no rows
   for it, built a different window than asked (review 2026-10-06: a silent skip kept it "being built" for 7 days and took
   a build slot every run), or its first covered day is more than 3 days after `from` (a weekend or a holiday may open it,
   a missing week may not). '' = fine. */
const rangeRefusal = (job, cp) => {
  const none = 'There are no figures for ' + job.label + ' — nothing has been uploaded for those days yet.';
  if (!cp || cp.empty || !(cp.agents || []).length) return none;
  const pw = cp.period || {};
  if (pw.from !== job.from || pw.to !== job.to)
    return 'The engine built a different window (' + (pw.from || '?') + '–' + (pw.to || '?') + ') than ' + job.label + ' — the range was not built.';
  const first = [...(cp.dates || [])].sort()[0];
  if (!first) return none;
  const late = Math.round((Date.parse(first + 'T00:00:00Z') - Date.parse(job.from + 'T00:00:00Z')) / 86400000);
  return late > 3 ? 'The figures for ' + job.label + ' start on ' + first + ', ' + late + ' days after the range begins — the start of the range is missing, so it was not built. Pick a range that starts on or after ' + first + '.' : '';
};
/* what a refusal writes back: a range ALREADY PUBLISHED ('built') whose rebuild is refused keeps 'built' — its last good
   digest is still what the Worker serves, so "refused" would be untrue (null = write nothing); a waiting or refused range
   is recorded refused with the reason (review 2026-10-06) */
const rangeOutcome = (job, why) => (job.was === 'built' ? null : { key: job.key, status: 'refused', reason: why });
/* HELD, not refused: a failed campaign-moves read is this run's problem, not the range's — it waits for the next run */
const rangeHeld = (job) => { const bad = job.months.filter((mo) => movesFailed.has(mo));
  return bad.length ? 'the campaign-moves read failed for ' + bad.join(', ') + ' — its movers would be blended; it waits for the next run' : ''; };
/*RANGE-JOBS-END*/
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

/*REFERRALS-INGEST-BEGIN*/
/* ---- the scheduled referrals (spec 002-live-month-sync-coaching, contract C3) ---- tools/sync-referrals.mjs files the
   HighLevel pull at 08:00 and 14:00 SAST as kv:referrals-latest. When it is NEWER than the state's own S.refs (a signed-in
   tab's manual sync wins if later) it goes into the headless engine through PULSE's own adoption — the same record
   mapping and INGEST.referrals as "Sync now" — and the model rebuilds. Nothing is saved: the next real PULSE session adopts
   the same pull itself. */
try {
  const rp = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=eq.kv:referrals-latest&select=value`, { headers: H });
  const row = rp.ok ? (await rp.json())[0] : null;
  let rv = row && row.value; if (typeof rv === 'string') { try { rv = JSON.parse(rv); } catch { rv = null; } }
  let text = rv && rv.data ? String(rv.data) : '';
  if (!text && rv && rv.store) { const so = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${rv.store}`, { headers: H }); if (so.ok) text = await so.text(); }
  if (text) {
    const res = await page.evaluate((rec) => { const r = refsAdoptRecord(rec); if (r.adopted) window.__mtd.rebuild(); return r; }, JSON.parse(text));
    console.log('referrals of record: ' + (res.adopted ? 'adopted the ' + res.slot + ' pull from ' + res.pulled_at + ' (' + res.total + ' referrals, ' + res.agents + ' agents)' : 'not adopted — ' + res.reason));
  } else console.log('referrals of record: no scheduled pull on file yet');
} catch (e) { console.warn('referrals of record not read (' + String(e && e.message || e).slice(0, 120) + ') — publishing with the copy already in the state'); }
/*REFERRALS-INGEST-END*/

/* ---- the custom-range queue (spec 006-cm-custom-range) ---- read here, before the campaign moves, because a range's months
   need their moves too. Read-only: the outcomes go back after the builds, by compare-and-set, and only under --apply. A
   queue that cannot be read builds no range this run (said, never fatal). --month runs build no range, like the cycles. */
let rangeJobs = [];
if (!process.argv.some((a) => /^--month=/.test(a))) {
  try {
    const rq = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=eq.${encodeURIComponent(RANGE_QUEUE_KEY)}&select=value,updated_at`, { headers: H });
    if (!rq.ok) throw new Error('HTTP ' + rq.status);
    const row = (await rq.json())[0];
    let qv = row && row.value; if (typeof qv === 'string') { try { qv = JSON.parse(qv); } catch { qv = null; } }
    rangeJobs = rangeJobsFor(queueList(qv), Date.now());
    console.log('custom ranges: ' + (rangeJobs.length ? rangeJobs.map((j) => j.key + ' (' + j.why + ')').join(', ') : 'none waiting or filling'));
  } catch (e) { console.warn('custom-range queue not read (' + String(e && e.message || e).slice(0, 120) + ') — no range is built this run'); rangeJobs = []; }
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
    ...(process.argv.includes('--history') ? [back(2), back(3)] : []),
    /* …and both months of each billing cycle: a cycle spans two, and a mover's days in each follow that month's moves */
    ...cycleJobsFor(Date.now()).flatMap((j) => j.months),
    /* …and every month a queued custom range touches (spec 006) — up to four for a 93-day range */
    ...rangeJobs.flatMap((j) => j.months)].filter(Boolean))];
  for (const m of want) {
    try {
      const mv = await campaignMoves(DBr, m);
      await page.evaluate((x) => { const S = window.__mtd.state(); S.campaignMoves = S.campaignMoves || {};
        S.campaignMoves[x.month] = { agents: x.agents, at: x.updatedAt }; window.__mtd.rebuild(); }, mv);
      console.log('campaign moves ' + m + ': ' + Object.keys(mv.agents).length + ' mover(s)' + (Object.keys(mv.agents).length ? ' — ' + Object.keys(mv.agents).join(', ') : ''));
    } catch (e) { movesFailed.add(m); console.warn('campaign moves ' + m + ' not read (' + String(e && e.message || e) + ') — publishing with the copy already in the state'); }
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
  /* THE LIVE MONTH IS ALWAYS THE CURRENT MONTH (spec 002, C1). Until its first data lands the engine answers with the
     honest EMPTY payload (empty:true, null figures, the list's agents) — published live, so Agent Analytics says "No
     October figures yet" instead of keeping the month just closed on the live key. The month just closed no longer
     takes the live key: it is rebuilt once more and filed under its own history key as its FINAL. */
  const liveMonth = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7);
  let payload0 = await page.evaluate(() => JSON.stringify(agentDigestPayload()));
  if ((((JSON.parse(payload0) || {}).period || {}).from || '').slice(0, 7) !== liveMonth) payload0 = await buildFor(liveMonth);   // the blob's own period may be another month
  /* --dump=<file> writes the live payload locally for inspection (dry run or not) — nothing else */
  const dumpTo = (process.argv.find((a) => a.startsWith('--dump=')) || '').slice(7);
  if (dumpTo) { fs.writeFileSync(dumpTo, payload0); console.log('payload written to ' + dumpTo); }
  const live0 = JSON.parse(payload0) || {};
  const m0 = (live0.period?.from || '').slice(0, 7);
  jobs.push([null, payload0]);
  if (live0.empty) {
    console.log('the live month ' + liveMonth + ' has no rows yet — publishing it EMPTY (' + (live0.agents || []).length + ' agents, null figures); the month just closed is filed as its (final)');
    const d = new Date(liveMonth + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1);
    const prev = d.toISOString().slice(0, 7);
    const prevBody = await buildFor(prev);
    const pj = JSON.parse(prevBody);
    if (pj && (pj.agents || []).length && !pj.empty) jobs.push([prev, prevBody]);   // agent-digest-<prev> — the portal's "(final)" link reads it
    else console.log('previous month ' + prev + ' has no rows — its history key is left as it is');
    await page.evaluate((m) => { window.__mtd.setPeriod(m, 'calendar'); }, liveMonth);   // back on the live month for the report builds below
  } else if (/^\d{4}-\d{2}$/.test(m0)) jobs.push([m0, payload0]);   // the live month IS its own history key
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
/* ---- BILLING CYCLES (spec 001-cm-view-signoff) ---- built LAST: the period switch moves the engine off the live
   month, and the live digest + report keys above are already in hand. A cycle with no rows yet, or a payload that
   is not that whole cycle, is skipped and said so — never published thin. */
const cycleBuilt = [];
const errsBeforeCycles = errs.length;
if (!argMonth) {
  for (const job of cycleJobsFor(Date.now())) {
    /* each cycle is its own island: whatever goes wrong building one is logged and the run goes on — the live digest
       and the report keys never depend on a cycle succeeding */
    try {
      const body = await page.evaluate((mo) => { window.__mtd.setPeriod(mo, 'cycle'); return JSON.stringify(agentDigestPayload()); }, job.key.slice(6));
      const cp = JSON.parse(body);   // 'null' = the engine has no rows for it
      if (!cp || !(cp.agents || []).length) { console.log('cycle ' + job.key + ' skipped — no agents with rows in ' + job.from + '..' + job.to); continue; }
      if ((cp.period || {}).kind !== 'cycle' || cp.period.from !== job.from || cp.period.to !== job.to) {
        console.log('cycle ' + job.key + ' skipped — the engine built ' + JSON.stringify(cp.period) + ', not the cycle ' + job.from + '..' + job.to); continue; }
      const why = cycleRefusal(job, cp);
      if (why) { console.log('cycle ' + job.key + ' skipped — ' + why); continue; }
      cycleBuilt.push({ job, body, n: cp.agents.length, period: cp.period });
    } catch (e) { console.warn('cycle ' + job.key + ' skipped — the build failed (' + String(e && e.message || e).slice(0, 160) + ')'); continue; }
  }
  /* a page error raised while building a cycle must not abort the live publish below */
  if (errs.length > errsBeforeCycles) { console.warn('page errors during the cycle builds (ignored for the live digest): ' + errs.slice(errsBeforeCycles, errsBeforeCycles + 3).join(' | ')); errs.length = errsBeforeCycles; }
}
/* ---- CUSTOM RANGES (spec 006) ---- built LAST, like the cycles: __mtd.setRange moves the engine off the live month, and
   the live digest, the report keys and the cycles above are already in hand. Each range is its own island — whatever goes
   wrong is logged and the run goes on. A refusal (no rows / the start missing) is recorded with its reason for the
   manager; a held range (moves read failed) or one past this run's budget simply stays waiting for the next tick. */
const rangeBuilt = [], rangeResults = [];
const errsBeforeRanges = errs.length;
const rangeStarted = Date.now();
for (const job of rangeJobs) {
  try {
    if (Date.now() - rangeStarted > RANGE_BUDGET_MS) { console.log('range ' + job.key + ' left for the next run — this run\'s range budget (' + Math.round(RANGE_BUDGET_MS / 1000) + ' s) is spent'); continue; }
    const held = rangeHeld(job);
    if (held) { console.log('range ' + job.key + ' held — ' + held); continue; }
    const body = await page.evaluate((j) => { window.__mtd.setRange(j.from, j.to); return JSON.stringify(agentDigestPayload()); }, { from: job.from, to: job.to });
    const cp = JSON.parse(body);   // 'null' = the engine has no rows for it
    const why = rangeRefusal(job, cp);
    if (why) {
      const out = rangeOutcome(job, why);
      console.log('range ' + job.key + ' refused — ' + why + (out ? '' : ' (its published figures stay; the request stays built)'));
      if (out) rangeResults.push(out);
      continue;
    }
    /* a range is a range — even one that matches a billing month exactly (the engine marks that one kind:'cycle') */
    cp.period = { from: job.from, to: job.to, kind: 'range', key: job.key, label: job.label };
    const reports = [];
    for (const kind of ['variance', 'leads']) {
      const rb = await page.evaluate((k) => { const r = window.__mtd.reports && window.__mtd.reports(k); return r ? JSON.stringify(r) : ''; }, kind);
      if (!rb) { console.log('range ' + job.key + ' report ' + kind + ': nothing to publish (no board/BI, or no case books for those days)'); continue; }
      const rj = JSON.parse(rb);
      if ((rj.period || {}).from !== job.from || (rj.period || {}).to !== job.to) { console.log('range ' + job.key + ' report ' + kind + ' is not the range\'s window — skipped'); continue; }
      reports.push({ kind, body: rb });
    }
    rangeBuilt.push({ job, body: JSON.stringify(cp), n: cp.agents.length, reports });
  } catch (e) { console.warn('range ' + job.key + ' skipped — the build failed (' + String(e && e.message || e).slice(0, 160) + ')'); continue; }
}
/* a page error raised while building a range must not abort the live publish below either */
if (errs.length > errsBeforeRanges) { console.warn('page errors during the custom-range builds (ignored for the live digest): ' + errs.slice(errsBeforeRanges, errsBeforeRanges + 3).join(' | ')); errs.length = errsBeforeRanges; }
await b.close(); server.close();
if (errs.length) { console.error('page errors: ' + errs.slice(0, 3).join(' | ')); process.exit(1); }

const p = JSON.parse(payload) || { agents: [] };   // null = the engine has nothing to publish (no Agent List) → refused below
const withDays = p.agents.filter(a => a.days && a.days.length).length;
const withScore = p.agents.filter(a => a.score != null).length;
console.log(`digest built by the deployed engine: ${p.agents.length} agents · ${withScore} with a score · ${withDays} with day rows · ${(p.weeks || []).length} weeks · ${Math.round(payload.length / 1024)} KB` + (p.empty ? ' · EMPTY month (no figures yet)' : ''));
if (!p.agents.length) { console.error('empty digest — refusing.'); process.exit(1); }
/* an EMPTY month legitimately has no day rows and no scores; a month with data must carry both */
if (!p.empty && (!withDays || !withScore)) { console.error('the new fields are missing — is site/pulse the current build?'); process.exit(1); }
if (p.empty && p.agents.some((a) => a.sales != null || (a.days && a.days.length))) { console.error('an empty-month payload carries figures — refusing (absence is not a nought).'); process.exit(1); }

/* --out <file>: keep the built digest on disk, so a guard (verify-composite-recompute.mjs <file>) can
   prove a new build's numbers BEFORE anything is published (2026-09-28) */
{ const i = process.argv.indexOf('--out'); if (i > 0 && process.argv[i + 1]) { fs.writeFileSync(process.argv[i + 1], payload); console.log('digest written to ' + process.argv[i + 1]); } }
for (const c of cycleBuilt) console.log((APPLY ? 'will write ' : 'would write ') + 'kv:' + c.job.name + ' — cycle ' + c.period.from + '..' + c.period.to + ' (' + (c.job.complete ? 'complete' : 'in progress') + '), ' + c.n + ' agents, ' + Math.round(c.body.length / 1024) + ' KB');
for (const rb of rangeBuilt) console.log((APPLY ? 'will write ' : 'would write ') + 'kv:' + rb.job.name + ' — custom range ' + rb.job.from + '..' + rb.job.to + ' (' + rb.job.why + '), ' + rb.n + ' agents' + (rb.reports.length ? ' + ' + rb.reports.map((x) => x.kind).join(' + ') : ' (no report built)') + ', ' + Math.round(rb.body.length / 1024) + ' KB');
for (const x of rangeResults) console.log((APPLY ? 'will mark ' : 'would mark ') + x.key + ' ' + x.status + (x.reason ? ' — ' + x.reason : ''));
/* ---- THE LIVE KEY'S MONTH RULE — ROLLOVER GRACE (2026-10-01, kept by spec 002) ---- This tool writes Storage directly, so the Worker's 409 never
   sees it — it asks the SAME rule itself (worker/src/rules.mjs, imported): the current month always; the month
   just closed only while the live key does not already hold the current month; nothing older. A refused live
   write still files the month's own history key; the report keys follow the live key. Since spec 002 the tool no longer
   NEEDS the grace (the empty current month publishes), but the rule stays: an older month never takes the live key. */
const { liveDigestAllowed } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'rules.mjs')).href);
/*EMPTY-FENCE-BEGIN*/
/* Contract C2 (spec 002), mirrored from the Worker's `empty_over_data`: an EMPTY payload never replaces a NON-empty
   live digest of the SAME month (a stale tab or a tool run on an old state). `live` = {from, empty} as the live pointer
   states it. Another month (the rollover) or an empty live key is fine. */
const emptyOverData = (payloadIsEmpty, from, live) => !!(payloadIsEmpty && live && live.from
  && String(live.from).slice(0, 7) === String(from).slice(0, 7) && !live.empty);
/*EMPTY-FENCE-END*/
const liveStateNow = async () => {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=eq.kv:agent-digest&select=value`, { headers: H });
  if (!r.ok) throw new Error('live digest not read (HTTP ' + r.status + ')');
  const row = (await r.json())[0];
  if (!row) return { from: '', empty: false };                    // nothing has ever been live
  let v = row.value || {}; if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = {}; } }
  if (typeof v.period === 'string') return { from: v.period, empty: v.empty === true };   // stamped on the pointer since 2026-10-01 (empty since spec 002)
  let t = String(v.data || '');
  if (!t && v.store) { const s = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${v.store}`, { headers: H }); if (s.ok) t = await s.text(); }
  /* a row whose digest will not read is "could not tell", never "nothing live" — fail closed (review, 2026-10-01) */
  if (!t) throw new Error('the live digest has a row but its object did not read');
  const d = JSON.parse(t);
  return { from: String((d.period || {}).from || ''), empty: d.empty === true };
};
/* what a live write would do — said in the dry run too (a read-only look at the live pointer) */
const fenceVerdict = async (mk, body) => {
  if (mk) return { write: true, why: '' };
  const pj = JSON.parse(body);
  const from = String((pj.period || {}).from || '');
  const live = await liveStateNow();
  if (emptyOverData(!!pj.empty, from, live))
    return { write: false, why: 'live key NOT written — an empty ' + from.slice(0, 7) + ' may not replace the live ' + live.from.slice(0, 7) + ', which already has data (empty_over_data)' };
  const liveFrom = live.from;
  if (!liveDigestAllowed(from, liveFrom, Date.now()))
    return { write: false, why: 'live key NOT written — ' + (from || 'no period') + ' may not replace the live ' + (live.from || 'nothing') + ' (current month always wins; the month just closed only until it publishes)' };
  return { write: true, why: '' };
};
const liveEmpty = jobs.some((j) => !j[0] && (JSON.parse(j[1]) || {}).empty);
const describe = (mk, body) => { const pj = JSON.parse(body); const per = pj.period ? pj.period.from + '..' + pj.period.to : '?';
  return mk ? 'kv:agent-digest-' + mk + (liveEmpty ? ' (final)' : '') + ' — ' + pj.agents.length + ' agents, ' + per
    : 'kv:agent-digest (LIVE) — ' + (pj.empty ? 'EMPTY ' : '') + pj.agents.length + ' agents, ' + per; };
if (!APPLY) {
  for (const [mk, body] of jobs) {
    let v;
    try { v = await fenceVerdict(mk, body); } catch (e) { v = { write: false, why: 'live pointer not read (' + String(e && e.message || e).slice(0, 100) + ')' }; }
    console.log((v.write ? 'would write ' : 'would NOT write ') + describe(mk, body) + (v.write ? '' : ' — ' + v.why));
  }
  console.log('\ndry run — nothing written. Re-run with --apply to publish.'); process.exit(0); }

let liveWritten = false;
/* ---- publish exactly where the Worker reads (the backfill tool's write, verbatim) ---- */
for (const [mk, body] of jobs) {
  if (!mk) {
    const v = await fenceVerdict(null, body);
    if (!v.write) { console.log(v.why); continue; }
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
      : { store, period: String((JSON.parse(body).period || {}).from || ''), ...(JSON.parse(body).empty ? { empty: true } : {}), updated_at: new Date().toISOString() } }]) });   // the live pointer carries its period — the Worker's fence reads it cheaply
  if (!r.ok) { console.error(keyName + ' rules write failed: ' + r.status + ' ' + (await r.text()).slice(0, 200)); process.exit(1); }
  const pj = JSON.parse(body);
  console.log('published ' + keyName + (pj.empty ? ' (EMPTY month)' : '') + ' — ' + pj.agents.length + ' agents, ' + (pj.period ? pj.period.from + '..' + pj.period.to : '?'));
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
/* THE BILLING-CYCLE KEYS — their own names, never the live key; the pointer says what it is */
for (const c of cycleBuilt) {
  try {
  const keyName = c.job.name, store = 'raw/kv/' + keyName;
  const put = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${store}`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: c.body });
  if (!put.ok) throw new Error(keyName + ' storage write failed: ' + put.status + ' ' + (await put.text()).slice(0, 200));
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?on_conflict=key`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key: 'kv:' + keyName, value: { store, period: c.period.from, kind: 'cycle', updated_at: new Date().toISOString() } }]) });
  if (!r.ok) throw new Error(keyName + ' rules write failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  console.log('published ' + keyName + ' — ' + c.n + ' agents, ' + c.period.from + '..' + c.period.to);
  } catch (e) { console.error('cycle ' + c.job.name + ' NOT published — ' + String(e && e.message || e)); }   // the live key is already written; one cycle failing never undoes it
}
/* THE CUSTOM-RANGE KEYS (spec 006) — their own names, never the live key; each pointer says what it is. Each range is its
   own island: a failed write is logged, its request is NOT marked built (it stays waiting for the next run) and the run goes
   on. The reports go first and the digest last — the digest is what makes a range "built" for the Worker. */
const putRangeKey = async (keyName, body, from) => {
  const store = 'raw/kv/' + keyName;
  const s = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${store}`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true' }, body });
  if (!s.ok) throw new Error(keyName + ' storage write failed: ' + s.status + ' ' + (await s.text()).slice(0, 200));
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?on_conflict=key`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key: 'kv:' + keyName, value: { store, period: from, kind: 'range', updated_at: new Date().toISOString() } }]) });
  if (!r.ok) throw new Error(keyName + ' rules write failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
};
for (const rb of rangeBuilt) {
  try {
    for (const { kind, body } of rb.reports) await putRangeKey('agent-reports-' + kind + '-' + rb.job.key, body, rb.job.from);
    await putRangeKey(rb.job.name, rb.body, rb.job.from);
    rangeResults.push({ key: rb.job.key, status: 'built' });
    console.log('published ' + rb.job.name + ' — ' + rb.n + ' agents, ' + rb.job.from + '..' + rb.job.to + (rb.reports.length ? ' + ' + rb.reports.map((x) => x.kind).join(' + ') : ''));
  } catch (e) { console.error('range ' + rb.job.key + ' NOT published — ' + String(e && e.message || e)); }
}
/* every range's outcome back onto its request ({status:'built'|'refused', reason?, statusAt} — range.mjs settleQueue) by
   COMPARE-AND-SET on the queue row's updated_at: a manager's request queued while this ran is never overwritten — a lost
   race re-reads and re-applies (constitution VI). Failing here is said and left for the next run, never fatal. */
if (rangeResults.length) {
  try {
    const qk = encodeURIComponent(RANGE_QUEUE_KEY);
    let settled = false;
    for (let attempt = 0; attempt < 3 && !settled; attempt++) {
      const rq = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=eq.${qk}&select=value,updated_at`, { headers: H });
      if (!rq.ok) throw new Error('queue not read (HTTP ' + rq.status + ')');
      const row = (await rq.json())[0];
      if (!row) { console.log('custom-range queue row is gone — no status to write'); break; }
      let qv = row.value; if (typeof qv === 'string') { try { qv = JSON.parse(qv); } catch { qv = null; } }
      const next = settleQueue(queueList(qv), rangeResults, Date.now());
      const at = new Date(Math.max(Date.now(), (Date.parse(row.updated_at) || 0) + 1)).toISOString();
      const w = await fetch(`${env.SUPABASE_URL}/rest/v1/rules?key=eq.${qk}&updated_at=eq.${encodeURIComponent(row.updated_at)}`, {
        method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ value: { v: 1, requests: next }, updated_by: 'digest-republish', updated_at: at }) });
      if (!w.ok) throw new Error('queue write failed: ' + w.status + ' ' + (await w.text()).slice(0, 200));
      settled = ((await w.json()) || []).length > 0;
      if (!settled) console.log('custom-range queue moved while this ran — re-reading (attempt ' + (attempt + 2) + ' of 3)');
    }
    console.log(settled ? 'custom-range queue: ' + rangeResults.map((x) => x.key + ' ' + x.status).join(', ')
      : 'custom-range queue NOT updated — it kept moving; the next run settles it');
  } catch (e) { console.error('custom-range queue NOT updated — ' + String(e && e.message || e)); }
}
console.log('done. The Worker edge/memory caches hold old copies for up to 5 minutes.');
