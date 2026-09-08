/* THE CALLX RETIREMENT, PROVED IN BOTH APPS — the whole floor dials on ViciDial from
 * 2026-09-01 (Nick, 2026-09-01), and every guard that existed before this change encodes
 * the OLD contract, so the new one gets its own.
 *
 * What must be true, and is checked here in both directions:
 *
 *   PULSE  · MTD_RULES.callxRetired matches the spec's date
 *          · a CallX file loads its pre-cutover days and REFUSES its post-cutover rows
 *            (registered with a retired count — acknowledged, never silently dropped)
 *          · a ViciDial EXPORT_CALL_REPORT lands post-cutover talk in the call book (v:1)
 *
 *   Ops    · CALLX_RETIRED matches
 *          · the CallX intake keeps pre-cutover rows and refuses the rest (batch says so)
 *          · the scoring context C.call unions Vici rows ON/AFTER the cutover only —
 *            September talk exists, August scoring does not move, system logins stay out
 *          · diallerRows() serves the page views a normalised cross-cutover series
 *
 * Run:  node verify-vici-cutover.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const SPEC = JSON.parse(fs.readFileSync(path.join(AGENTOS, 'specs', 'mtd_engine_rules.json'), 'utf8'));
const SPEC_CUT = (SPEC.sources || []).find(s => s.id === 'call_x_call')?.retired;

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };

const SIDE = { '/xlsx.full.min.js': path.join(AGENTOS, 'site', 'xlsx.full.min.js'),
  '/auth-gate.js': path.join(AGENTOS, 'site', 'auth-gate.js'),
  '/ask-widget.js': path.join(AGENTOS, 'site', 'ask-widget.js') };
const serve = (html, port) => new Promise(res => {
  const srv = http.createServer((q, s) => {
    const u = q.url.split('?')[0];
    const p = SIDE[u] || (u === '/' ? html : null);
    if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
    s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
    fs.createReadStream(p).pipe(s);
  });
  srv.listen(port, '127.0.0.1', () => res(srv));
});

const b = await chromium.launch();

/* ================================ PULSE ================================ */
console.log('\n== PULSE — the station refuses retired days, Vici fills the call book ==');
{
  const srv = await serve(path.join(AGENTOS, 'nicks_code', 'index.html'), 8262);
  const page = await b.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await page.goto('http://127.0.0.1:8262/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.ingest, null, { timeout: 30000 });

  const out = await page.evaluate(async () => {
    const S = window.__mtd.state();
    const cut = (typeof MTD_RULES !== 'undefined') ? MTD_RULES.callxRetired : null;

    /* a CallX export straddling the cutover: one day each side */
    const cx = ['Date & Time,Agent,Call Type,Bridge,Lead Disposition,Duration,Billable Seconds',
      '2026-08-28 09:00:00,Probe Agent,outbound,ANSWERED,Interested,00:03:20,120',
      '2026-09-02 09:00:00,Probe Agent,outbound,ANSWERED,Interested,00:03:20,120'].join('\n');
    await window.__mtd.ingest('probe-callx.csv', cx);
    const aug = S.calls['2026-08-28'] && S.calls['2026-08-28']['Probe Agent'];
    const sep = S.calls['2026-09-02'] && S.calls['2026-09-02']['Probe Agent'];
    const reg = S.files.find(f => f.name === 'probe-callx.csv');

    /* a Vici per-call export for a post-cutover day */
    const vh = ['call_date', 'user', 'full_name', 'status', 'lead_id', 'length_in_sec', 'campaign_id'].join('\t');
    const vr = ['2026-09-02 09:15:00', 'CB901', 'Probe Agent', 'SALE', 'L1', '200', 'PROBE'].join('\t');
    await window.__mtd.ingest('probe-vici.txt', vh + '\n' + vr);
    const vsep = S.calls['2026-09-02'] && S.calls['2026-09-02']['CB901'];

    /* clean up the probe state so nothing lingers if a save were to fire */
    delete S.calls['2026-08-28']; delete S.calls['2026-09-02'];
    S.files = S.files.filter(f => !/^probe-/.test(f.name));
    return { cut, augTalk: aug ? aug.talk : null, sepLoaded: !!sep,
      regRetired: reg ? reg.retired : null, viciTalk: vsep ? vsep.talk : null, viciV: vsep ? vsep.v : null };
  });

  ok('MTD_RULES.callxRetired matches the spec', out.cut === SPEC_CUT && !!SPEC_CUT, `${out.cut} vs ${SPEC_CUT}`);
  ok('pre-cutover CallX day loads (history corrections stay possible)', out.augTalk === 120, 'talk=' + out.augTalk);
  ok('post-cutover CallX day is REFUSED', !out.sepLoaded);
  ok('the refusal is registered, never silent (retired count on the file entry)', out.regRetired === 1, String(out.regRetired));
  ok('post-cutover Vici talk lands in the call book', out.viciTalk === 200, 'talk=' + out.viciTalk);
  ok('…flagged as Vici-sourced (v:1)', out.viciV === 1, 'v=' + out.viciV);
  ok('PULSE: no page errors', !errs.length, errs.join(' | '));
  await page.close(); srv.close();
}

/* ================================= OPS ================================= */
console.log('\n== Ops — intake gate, scoring union, page series ==');
{
  const srv = await serve(path.join(AGENTOS, 'Chatterbox_AgentOS_Analytics.html'), 8263);
  const page = await b.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await page.goto('http://127.0.0.1:8263/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof applyLoad === 'function' && typeof acCtx === 'function', null, { timeout: 30000 });
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('cbx-authed', { detail: { user: 'harness' } })));

  const out = await page.evaluate(() => {
    const cut = (typeof CALLX_RETIRED !== 'undefined') ? CALLX_RETIRED : null;

    /* --- intake gate: raw CallX rows straddling the cutover --- */
    const mk = (dt) => ({ 'Date & Time': dt, 'Call Type': 'outbound', 'Agent': 'Probe Agent',
      'Bridge': 'ANSWERED', 'Lead Disposition': 'Interested', 'Duration': '00:03:20', 'Billable Seconds': '120' });
    state.facts.CALLX_CALL_RECORDS = [];
    applyLoad('CALLX_CALL_RECORDS', { name: 'probe.xlsx' }, { data: [mk('2026-08-28 09:00'), mk('2026-09-02 09:00'), mk('2026-09-03 09:00')], textHash: 'probe-hash-1' }, []);
    const facts = state.facts.CALLX_CALL_RECORDS || [];
    const preRows = facts.filter(r => r._d < cut).length, postRows = facts.filter(r => r._d >= cut).length;
    const batch = state.batches.find(bt => bt.file_hash === 'probe-hash-1');

    /* --- scoring union: Vici rows both sides of the cutover, plus a system login --- */
    state.cbInfo['CB901'] = state.cbInfo['CB901'] || { name: 'Probe Agent', queue: 'Courtesy Calls', tl: 'Probe TL' };
    state.rules.viciSystemUsers = { vals: ['SYSPROBE'] };
    const vrow = (d, u, sec) => ({ user_raw: u, user_cb: u === 'SYSPROBE' ? null : u, full_name: 'Probe Agent Vici',
      user_group: 'Probe_WC', status: 'SALE', lead_id: 'L' + d, call_dt: d + ' 09:00:00', length_in_sec: sec, _d: d });
    state.facts.VICI_CALL_REPORT = (state.facts.VICI_CALL_REPORT || []).concat([
      vrow('2026-08-30', 'CB901', 300), vrow('2026-09-02', 'CB901', 200), vrow('2026-09-02', 'SYSPROBE', 999)]);
    const Csep = acCtxBuild({ from: '2026-09-01', to: '2026-09-30' });
    const Caug = acCtxBuild({ from: '2026-08-01', to: '2026-08-31' });
    const sep = Csep.call['CB901'] || null, aug = Caug.call['CB901'] || null;

    /* --- the page series --- */
    const dr = diallerRows({ from: '2026-09-01', to: '2026-09-30' });
    const vi = dr.filter(r => r._vici);

    /* clean up */
    state.facts.CALLX_CALL_RECORDS = []; state.facts.VICI_CALL_REPORT = [];
    state.batches = state.batches.filter(bt => bt.file_hash !== 'probe-hash-1');
    delete state.cbInfo['CB901'];
    return { cut, preRows, postRows, refusedInBatch: batch ? batch.callx_retired_rows : null,
      sepSec: sep && sep.sec, sepN: sep && sep.n, sepDays: sep && sep.days.size, augInCall: !!aug,
      viN: vi.length, viSec: vi[0] && vi[0].billable_seconds, viAns: vi[0] && vi[0].answered, viCamp: vi[0] && vi[0].campaign };
  });

  ok('CALLX_RETIRED matches the spec', out.cut === SPEC_CUT, `${out.cut} vs ${SPEC_CUT}`);
  ok('intake keeps pre-cutover CallX rows', out.preRows === 1, String(out.preRows));
  ok('intake refuses post-cutover CallX rows', out.postRows === 0, String(out.postRows));
  ok('the batch audit records the refusal count', out.refusedInBatch === 2, String(out.refusedInBatch));
  ok('September scoring reads the Vici row (talk driver exists)', out.sepSec === 200 && out.sepN === 1 && out.sepDays === 1,
    JSON.stringify({ sec: out.sepSec, n: out.sepN, days: out.sepDays }));
  ok('August scoring does NOT move (pre-cutover Vici stays out of C.call)', !out.augInCall);
  ok('system logins never score', out.sepSec !== 999 + 200);
  ok('diallerRows serves the normalised Vici series to the pages', out.viN === 1 && out.viSec === 200 && out.viAns === 1 && out.viCamp === 'Probe_WC',
    JSON.stringify({ n: out.viN, sec: out.viSec, ans: out.viAns, camp: out.viCamp }));
  ok('Ops: no page errors', !errs.length, errs.join(' | '));
  await page.close(); srv.close();
}

await b.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
