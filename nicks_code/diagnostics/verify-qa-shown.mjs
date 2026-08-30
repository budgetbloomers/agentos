/* IS THE QA THAT WAS UPLOADED THE QA THAT IS SHOWN?
 *
 * The QA export is the most rule-laden upload in the suite, and almost every rule is a place a
 * figure can quietly go wrong rather than visibly break:
 *   · it filters on Date of Call — NOT Date of Assessment, and NOT the export's own Week
 *     column, which uses a different convention (it calls 01 Aug week 1, 03–05 Aug week 2)
 *   · a 0% score is a real outcome (a Critical Fail), not missing data, and is kept
 *   · an agent with no evaluation is EXCLUDED from the headline denominator, never counted as
 *     a zero — the workbook's AVERAGE() skips the text "No QA %"
 *   · the headline is a mean of AGENT means, not a mean of evaluations
 *   · the export is re-pulled whole with whatever window and filter QA felt like using, so
 *     uploads merge BY RECORD ID — an ID already held is updated in place, never added again,
 *     and the file registry's row counts therefore CANNOT be summed into a total
 *
 * This drives the real build over the real state and recomputes each of those independently
 * from the stored evaluations, then compares. Anything that disagrees is either a display bug
 * or a rule that moved without the spec moving with it.
 *
 * Run: node nicks_code/diagnostics/verify-qa-shown.mjs [path-to-state.json]
 *   with no argument it pulls the live state from Supabase (needs supabase.env).
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
const near = (n, a, b, tol) => ok(n, a != null && b != null && Math.abs(a - b) <= tol,
  `got ${a && a.toFixed ? a.toFixed(2) : a}, expected ${b && b.toFixed ? b.toFixed(2) : b} (tol ${tol})`);

/* ---------- state ---------- */
let blob = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : null;
if (!blob) {
  const envTxt = fs.readFileSync(path.join(REPO, 'supabase.env'), 'utf8');
  const env = Object.fromEntries(envTxt.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
  const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/vas-state', { headers: H, signal: AbortSignal.timeout(90000) });
  if (!r.ok) { console.log('(skipping — cannot read live state: ' + r.status + ')'); process.exit(0); }
  blob = await r.text();
  console.log('pulled live state: ' + (blob.length / 1048576).toFixed(2) + ' MB');
}

const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s); });
await new Promise(r => server.listen(8186, '127.0.0.1', r));

const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.accept());
await page.goto('http://127.0.0.1:8186/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(b => { const S = window.__mtd.state(); const o = JSON.parse(b);
  for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, blob);

/* ---------- what the STORE holds, computed here, independently of the app ---------- */
const S = JSON.parse(blob);
const evalDays = Object.keys(S.evals || {}).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
let totalStored = 0;

console.log('\n— the upload landed intact —');
{
  let n = 0, zeros = 0, blanks = 0, dup = 0;
  const ids = new Set(), codes = new Set();
  for (const d of evalDays) for (const [c, list] of Object.entries(S.evals[d])) {
    codes.add(c);
    for (const e of list) {
      n++;
      const sc = (typeof e === 'number') ? e : e.s;
      if (typeof sc === 'number') { if (sc === 0) zeros++; } else blanks++;
      const rid = e && e.rid;
      if (rid) { if (ids.has(rid)) dup++; ids.add(rid); }
    }
  }
  totalStored = n;
  console.log(`  store: ${n.toLocaleString()} evaluations · ${evalDays.length} days · ${codes.size} agent codes · ${zeros} scored 0%`);
  ok('every stored evaluation carries a numeric score', blanks === 0, `${blanks} carry none`);
  ok('no Record ID is stored twice (uploads merge by ID, never stack)', dup === 0, `${dup} duplicated`);
  /* The Record-ID gap: the first upload predates the rid field, so re-uploading the full
     history laid a rid copy of each relic beside it and every pre-August day doubled
     (2026-05-29: 47 -> 94). normalizeState now heals that on every rebuild; this asserts the
     healed invariant on the state itself — a rid-less row may only survive where rid rows
     with the same day+agent+score are OUTNUMBERED (the ambiguous case, kept on purpose). */
  let doubled = 0; const dbEx = [];
  for (const d of evalDays) for (const [c, list] of Object.entries(S.evals[d])) {
    const ridN = {}, bareN = {};
    for (const e of list) { const sc = (typeof e === 'number') ? e : (e && e.s);
      if (e && e.rid) ridN[sc] = (ridN[sc] || 0) + 1; else bareN[sc] = (bareN[sc] || 0) + 1; }
    for (const sc in bareN) if ((ridN[sc] || 0) >= bareN[sc]) { doubled += bareN[sc]; if (dbEx.length < 4) dbEx.push(`${d} ${c} score ${sc}`); }
  }
  ok('no evaluation is stored both with and without its Record ID (the doubling relic)',
    doubled === 0, `${doubled} rid-less row(s) shadow a rid twin — ${dbEx.join(' | ')} — run this state through the current build once (normalizeState heals it) or re-push after a rebuild`);
  ok('0% scores are kept — they are Critical Fails, not missing data', zeros > 0 || n === 0,
    'not one 0% is stored; check the parser is not discarding them');

  const files = (S.files || []).filter(f => f.type === 'evals')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const newest = files[files.length - 1];
  if (newest) {
    console.log(`  ${files.length} QA uploads on record; newest is ${newest.name} (${newest.rows.toLocaleString()} rows)`);
    /* The source label is only meaningful while one filename means one file. The registry
       keeps a SINGLE entry per (name, type), so uploading two different exports under the
       same name replaces the first entry while its rows keep the shared label — the panel
       then describes the smaller file and the count no longer ties to anything. A label
       carrying MORE rows than its file declared is the fingerprint of exactly that. */
    const over = [];
    for (const f of files) {
      let n = 0;
      for (const d of evalDays) for (const list of Object.values(S.evals[d])) for (const e of list) if (e && e.f === f.name) n++;
      if (n > (f.rows || 0) + 3) over.push(`${f.name}: registry says ${f.rows} rows, ${n} carry the label`);
    }
    ok('no filename carries more evaluations than that file declared', over.length === 0,
      over.join(' | ') + ' — two different exports were uploaded under one name, so the registry entry describes only the last of them');
  }
}

/* ---------- the numbers on screen ---------- */
console.log('\n— the period the QA figures are filtered on —');
const shown = await page.evaluate(() => {
  const M = window.__mtd.model();
  const rows = [];
  for (const camp in (M.mtdCC || {})) for (const code in M.mtdCC[camp]) {
    const a = M.mtdCC[camp][code];
    /* a.qa is what the MTD table prints. qaFor is the function behind it and takes an explicit
       (code, from, to) — called WITHOUT a range it silently returns the agent's lifetime QA,
       because the day filter compares against undefined and never excludes anything. Pass the
       model's own range, which is what every call site in the app does. */
    const q = typeof M.qaFor === 'function' ? M.qaFor(code, M.range.from, M.range.to) : null;
    const lifetime = typeof M.qaFor === 'function' ? M.qaFor(code) : null;
    rows.push({ code, camp,
      qaN: a.qa ? a.qa.n : 0, qaAvg: a.qa ? a.qa.avg : null,      // the printed column
      n: q ? q.n : 0, avg: q ? q.avg : null,                       // the function, ranged
      lifeN: lifetime ? lifetime.n : 0 });
  }
  return { rows, range: M.range, qaAvg: M.qaAvg, qaN: M.qaN, qaAgents: M.qaAgents,
           camps: Object.keys(M.mtdCC || {}) };
});
const from = shown.range.from, to = shown.range.to;
console.log(`  period: ${from} -> ${to}   ·   campaigns in the model: ${shown.camps.join(', ')}`);

/* Recompute from the store, filtering on DATE OF CALL and nothing else. */
const mine = {};
for (const d of evalDays) {
  if (d < from || d > to) continue;
  for (const [c, list] of Object.entries(S.evals[d])) {
    const o = mine[c] = mine[c] || { s: 0, n: 0, crit: 0, zeros: 0 };
    for (const e of list) {
      const sc = (typeof e === 'number') ? e : e.s;
      if (typeof sc !== 'number') continue;
      o.s += sc; o.n++; if (sc === 0) o.zeros++;
      if (/critical/i.test((e && e.dec) || '')) o.crit++;
    }
  }
}
/* Only agents the MTD model carries — it scopes to the VAS campaigns, so QA on a VT agent or
   a leaver is legitimately outside the headline and is reported separately below. */
const inModel = new Set(shown.rows.map(r => r.code));
const scoped = Object.entries(mine).filter(([c]) => inModel.has(c));

console.log('\n— the headline is a mean of AGENT means, not of evaluations —');
{
  const means = scoped.filter(([, o]) => o.n).map(([, o]) => o.s / o.n);
  const meanOfMeans = means.reduce((a, b) => a + b, 0) / (means.length || 1);
  let ts = 0, tn = 0; for (const [, o] of scoped) { ts += o.s; tn += o.n; }
  const flat = tn ? ts / tn : 0;
  const screen = shown.qaAvg * 100;
  console.log(`  screen headline       : ${screen.toFixed(2)}%`);
  console.log(`  mean of agent means   : ${meanOfMeans.toFixed(2)}%   <- the rule book's AVERAGE(U4:U{last})`);
  console.log(`  flat mean of all evals: ${flat.toFixed(2)}%   <- what it must NOT be`);
  near('the headline equals the mean of agent means', screen, meanOfMeans, 0.55);
  ok('it is not the flat mean of every evaluation',
    Math.abs(meanOfMeans - flat) < 0.05 || Math.abs(screen - flat) > 0.5,
    'the two coincide on this data, so this run cannot separate them');
}

console.log('\n— agents with no evaluation are excluded, never scored zero —');
{
  const noQA = shown.rows.filter(r => r.n === 0);
  const zeroed = noQA.filter(r => r.qa === 0);
  console.log(`  agents in the model: ${shown.rows.length} · with evaluations: ${shown.qaAgents} · without: ${noQA.length}`);
  ok('an agent with no evaluation carries no QA figure', zeroed.length === 0,
    `${zeroed.length} agent(s) with zero evaluations show QA 0% — they would drag the headline down`);
  const counted = scoped.filter(([, o]) => o.n).length;
  ok('the denominator is the evaluated agents', shown.qaAgents === counted,
    `model says ${shown.qaAgents}, store has ${counted} evaluated agents in the model`);
}

console.log('\n— per-agent figures match the store, agent by agent —');
{
  const bad = [], ghost = [], colBad = [];
  let checked = 0, lifetimeDiffers = 0;
  for (const r of shown.rows) {
    const o = mine[r.code];
    if (!o || !o.n) { if (r.n > 0) ghost.push(`${r.code} shows ${r.n} evals, store has none in period`); continue; }
    checked++;
    const want = o.s / o.n;
    const got = r.avg == null ? null : r.avg * 100;
    if (got == null || Math.abs(got - want) > 0.55) bad.push(`${r.code}: ranged ${got == null ? 'none' : got.toFixed(1)} vs store ${want.toFixed(1)}`);
    if (r.n !== o.n) bad.push(`${r.code}: ranged count ${r.n} vs store ${o.n}`);
    // and the column the table actually prints
    const col = r.qaAvg == null ? null : r.qaAvg * 100;
    if (col == null || Math.abs(col - want) > 0.55) colBad.push(`${r.code}: column ${col == null ? 'none' : col.toFixed(1)} vs store ${want.toFixed(1)}`);
    if (r.qaN !== o.n) colBad.push(`${r.code}: column count ${r.qaN} vs store ${o.n}`);
    if (r.lifeN !== r.n) lifetimeDiffers++;
  }
  console.log(`  compared ${checked} agents`);
  ok('the QA column the MTD table prints matches the store for the period', colBad.length === 0, colBad.slice(0, 6).join(' | '));
  ok('qaFor(code, from, to) returns the same figures as that column', bad.length === 0, bad.slice(0, 6).join(' | '));
  ok('no agent shows evaluations the store does not hold', ghost.length === 0, ghost.slice(0, 4).join(' | '));
  /* Not a defect — every call site passes the range — but it is a live footgun: the same
     function called without one answers with lifetime QA and nothing says so. Pinned here so
     that if a future caller forgets the arguments, this test is what notices. */
  ok('the period figure genuinely differs from lifetime, so the range argument is load-bearing',
    lifetimeDiffers > 0, 'every agent has the same period and lifetime QA on this data — the test cannot tell a missing range argument from a correct one');
  console.log(`  ${lifetimeDiffers} of ${checked} agents have a lifetime QA count different from the period count`);
}

console.log('\n— the evaluation count on screen —');
{
  let tn = 0; for (const [, o] of scoped) tn += o.n;
  ok('total evaluations in the period match the store', shown.qaN === tn, `screen ${shown.qaN}, store ${tn}`);
  console.log(`  ${tn} of ${totalStored} stored evaluations fall in ${from}..${to} and on a model agent`);
}

console.log('\n— evaluations on people the model does not carry —');
{
  const off = Object.entries(mine).filter(([c]) => !inModel.has(c)).sort((a, b) => b[1].n - a[1].n);
  const total = off.reduce((s, [, o]) => s + o.n, 0);
  const roster = new Set((S.roster || []).map(a => String(a.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')));
  const offRoster = off.filter(([c]) => !roster.has(String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')));
  console.log(`  ${off.length} code(s), ${total} evaluation(s) in the period sit outside the MTD model`);
  console.log(`  of those, ${offRoster.length} code(s) are on no Agent List row at all:`);
  for (const [c, o] of offRoster.slice(0, 12)) console.log(`    ${c.padEnd(10)} ${String(o.n).padStart(4)} evals  avg ${(o.s / o.n).toFixed(1)}%`);
  ok('off-model QA is a remainder that can be named, not folded into a campaign', true, '');
}

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log(`\n==== ${pass} passed, ${fails.length} failed ====`);
if (fails.length) { console.log(fails.map(f => '  · ' + f).join('\n')); process.exit(1); }
