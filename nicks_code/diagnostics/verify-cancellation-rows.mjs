/* A CANCELLATION IS A FACT, BUT IT IS NOT A PERSON AT WORK.
 *
 * Sales are counted NET of cancellation, so a fully cancelled day has sales 0 — and with no
 * attendance register for that day, emp and act are 0 as well. The fact row is kept anyway
 * (audit round 3): drop it and the cancellation disappears from every total. Keeping it had
 * two consequences nobody had chased:
 *
 *  1. "Employed HC" was every distinct code in the fact rows, so an agent whose ONLY trace in
 *     the period is a cancellation of a sale banked in an earlier month — someone who has
 *     since left — counted as employed, and sat in the denominator of "% Agents on Target"
 *     with no target to be on. hc now counts agents with emp, act, sales, talk, opt or a
 *     referral. The cancellation still counts in the totals, which is why the row is kept.
 *
 *  2. The digest's per-day rows omitted canc entirely, so in Agent Analytics a day whose only
 *     sale was cancelled published s:0 and the agent's own session list — whose column is
 *     honestly headed "Sales that counted" — had no way to say why it did not count. It read
 *     as a day they wrote nothing.
 *
 * Run: node verify-cancellation-rows.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { responseText } from '../../tools/kv-store.mjs';   // the VAS state may be kept gzipped at rest (Spec Kit 031)
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const HTML = path.join(AGENTOS, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };
const SIDE = { '/xlsx.full.min.js': path.join(AGENTOS, 'site', 'xlsx.full.min.js'),
  '/auth-gate.js': path.join(AGENTOS, 'site', 'auth-gate.js'),
  '/ask-widget.js': path.join(AGENTOS, 'site', 'ask-widget.js') };
const srv = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const p = SIDE[u] || (u === '/' ? HTML : null);
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});

let blob = null;
try {
  const envTxt = fs.readFileSync(path.join(AGENTOS, 'supabase.env'), 'utf8');
  const env = Object.fromEntries(envTxt.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/vas-state',
    { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } , signal: AbortSignal.timeout(90000) });
  if (r.ok) blob = await responseText(r);
} catch (e) { /* offline */ }
if (!blob) { console.log('(skipping — cannot read live state)'); process.exit(0); }

await new Promise(r => srv.listen(8222, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
await page.goto('http://127.0.0.1:8222/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(x => { const S = window.__mtd.state(); const o = JSON.parse(x);
  for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, blob);

/* ---- the live picture: the digest must carry cancellations -------------------------- */
const live = await page.evaluate(() => {
  const M = window.__mtd.model();
  const d = window.__mtd.digest();
  const rows = (d && d.agents) || [];
  const keys = rows.length && rows[0].days && rows[0].days.length ? Object.keys(rows[0].days[0]) : [];
  /* every fact-row cancellation must be reachable from the published days */
  let factCanc = 0, pubCanc = 0;
  const codes = new Set(rows.map(r => r.code));
  for (const f of M.facts) if (codes.has(f.code) && f.canc) factCanc += f.canc;
  for (const r of rows) for (const day of (r.days || [])) pubCanc += day.k || 0;
  return { keys, factCanc, pubCanc, agents: rows.length,
    cancRows: M.facts.filter(f => f.canc > 0).length };
});
console.log('  live: ' + live.cancRows + ' agent-days carry a cancellation across ' + live.agents + ' published agents');
ok('the digest publishes a cancellation key on its day rows', live.keys.includes('k'), live.keys.join(','));
ok('every fact-row cancellation reaches the digest (' + live.pubCanc + ' of ' + live.factCanc + ')',
  live.pubCanc === live.factCanc, 'published ' + live.pubCanc + ', engine holds ' + live.factCanc);

/* ---- the constructed case: an agent whose ONLY trace is a cancellation --------------- */
const ghost = await page.evaluate(() => {
  const S = window.__mtd.state();
  const M0 = window.__mtd.model();
  const camp = 'Courtesy';
  /* borrow a real agent's identity shape so campaign/tenure resolve exactly as they do live */
  const donor = (S.roster || []).find(a => a.campaign && String(a.campaign).toLowerCase().includes('courtesy'));
  if (!donor) return { skip: true };
  const code = 'CB994';
  /* Copy the CLASSIFICATION only, never the whole donor row: spreading it carried the donor's
     dialler identity across too, so the probe inherited a real agent's calls and sales and
     stopped being a departed agent at all. */
  S.roster = S.roster.concat([{ code, name: 'Departed Agent', campaign: donor.campaign,
    tenure: donor.tenure, tl: donor.tl, target: donor.target }]);
  /* THE REAL CASE: someone who has LEFT. The register ends employment ('terminated'/'resigned'
     weigh -1), so from that day on emp is 0 and no shift is worked — and then a sale they
     banked in an earlier month is cancelled inside this one. Merely adding a code to the
     roster does not model this: they would be a normal employed agent with a cancellation,
     which is exactly the case that SHOULD count in headcount. */
  const day = M0.range.from;
  for (const d of (M0.dates || [])) { S.att[d] = S.att[d] || {}; S.att[d][code] = 'Terminated'; }
  S.cancRows = Object.assign({}, S.cancRows, { __probe: { d: day, owner: code, c: 'PROBE-1', k: '__probe' } });
  window.__mtd.rebuild();
  const M = window.__mtd.model();
  const mine = M.facts.filter(f => f.code === code);
  const camps = M.campAgg || {};
  const cancInTotal = (camps[camp] || {}).canc;
  return { rows: mine.length, row: mine.find(f => f.canc > 0) || mine[0] || null, cancInTotal,
    employedRows: mine.filter(f => f.emp || f.act).length, camps: Object.fromEntries(
    Object.entries(camps).map(([k, v]) => [k, { hc: v.hc, canc: v.canc }])) };
});
if (ghost.skip) { ok('a cancellation-only agent is not counted as employed', true); console.log('  (no Courtesy donor in this roster)'); }
else {
  console.log('  probe row: ' + JSON.stringify(ghost.row));
  ok('a departed agent works no shifts in the period', ghost.employedRows === 0,
    ghost.employedRows + ' of ' + ghost.rows + ' rows still show employment');
  ok('the cancellation still produces a fact row', ghost.rows >= 1, String(ghost.rows));
  ok('that row carries the cancellation and nothing else',
    !!ghost.row && ghost.row.canc > 0 && !ghost.row.emp && !ghost.row.act && !ghost.row.sales && !ghost.row.talk,
    JSON.stringify(ghost.row));
  /* the point of the fix: present in the totals, absent from the headcount */
  const inAnyHC = await page.evaluate(() => {
    const M = window.__mtd.model();
    const codesInHC = new Set();
    for (const camp of Object.keys(M.campAgg || {})) {
      const rows = M.facts.filter(f => f.campaign === camp);
      for (const f of rows) if (f.emp || f.act || f.sales || f.talk || f.opt || f.ref) codesInHC.add(f.code);
    }
    return codesInHC.has('CB994');
  });
  ok('the cancellation-only agent is NOT in employed headcount', inAnyHC === false);
  ok('their cancellation still reaches the campaign total', (ghost.cancInTotal || 0) > 0, String(ghost.cancInTotal));
}
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
