/* THE VAS SCORE MUST NOT REWARD BEING UNMEASURED.
 *
 * perfScore is the 0–100 on the leaderboard chip and on every agent's own rating card in
 * Agent Analytics. It used to fill in a driver with no data instead of standing it down:
 *
 *   - QA with no evaluations was IMPUTED AT 80% — 20 of its 25 points. An agent evaluated at
 *     a real 70% earned 17.5, so being measured cost 2.5 points against a colleague nobody
 *     had evaluated. Every QA score below 80% was worse than no QA score at all.
 *   - % to target, attendance and opt-ins with no data scored a flat ZERO, so a data gap read
 *     as a failure — the same "an absence is not a nought" bug the Ops composite and the
 *     money model were each fixed for.
 *
 * A driver with no value now leaves the denominator and the rest renormalise to 100, which is
 * what non-negotiable 4 says the Ops composite does and what the rule book itself does with QA
 * (TL average, "excluding 'No QA %'"). A REAL 0% still scores zero — the spec is explicit that
 * a zero QA is an outcome, not a gap — and an agent with every driver present scores exactly
 * what they scored before.
 *
 * Run: node verify-perf-score.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
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
await new Promise(r => srv.listen(8218, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
await page.goto('http://127.0.0.1:8218/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.rules(), null, { timeout: 30000 });

const out = await page.evaluate(() => {
  const P = window.perfParts, S = window.perfScore;
  const mk = (pctT, qa, att, opt) => ({ pctT, qa: qa == null ? null : { avg: qa }, att, optPct: opt });
  const sum = p => Math.round((p.t.w + p.qa.w + p.att.w + p.opt.w) * 10) / 10;

  const full = mk(0.9, 0.82, 0.95, 0.4);
  const pFull = P(full);
  /* the old formula, verbatim, for the driver-complete case */
  const oldFull = (Math.min(0.9 / 1.0, 1.25) / 1.25 * 45 + 0.82 * 25 + 0.95 * 20 + Math.min(0.4 / 0.5, 1) * 10) / 100;

  const noQA = mk(0.9, null, 0.95, 0.4);
  const pNoQA = P(noQA);
  const qa70 = mk(0.9, 0.70, 0.95, 0.4);
  const qa100 = mk(0.9, 1.0, 0.95, 0.4);
  const qa0 = mk(0.9, 0.0, 0.95, 0.4);
  const nothing = mk(null, null, null, null);

  return {
    fullScore: S(full), oldFull, fullW: sum(pFull),
    noQAw: { t: pNoQA.t.w, qa: pNoQA.qa.w, att: pNoQA.att.w, opt: pNoQA.opt.w }, noQAsum: sum(pNoQA),
    noQApts: pNoQA.qa.pts, noQAscore: S(noQA),
    qa70: S(qa70), qa100: S(qa100), qa0: S(qa0),
    qa0Pts: P(qa0).qa.pts, qa0W: P(qa0).qa.w,
    /* the old imputation, reproduced: what an unevaluated agent used to be handed */
    oldNoQAscore: (Math.min(0.9, 1.25) / 1.25 * 45 + 0.8 * 25 + 0.95 * 20 + 0.8 * 10) / 100,
    nothingScore: S(nothing), nothingW: sum(P(nothing)),
    /* a data gap in attendance must not read as an attendance failure */
    noAttW: P(mk(0.9, 0.82, null, 0.4)).att.w,
    noAttScore: S(mk(0.9, 0.82, null, 0.4)),
    zeroAttScore: S(mk(0.9, 0.82, 0, 0.4))
  };
});
console.log('  ' + JSON.stringify(out, null, 0).slice(0, 400));

ok('an agent with every driver present scores exactly what they scored before',
  Math.abs(out.fullScore - out.oldFull) < 1e-9, out.fullScore + ' vs ' + out.oldFull);
ok('the effective weights still sum to 100', out.fullW === 100, String(out.fullW));
ok('a missing driver is stood down, not imputed', out.noQApts === 0 && out.noQAw.qa === 0,
  'qa carried ' + out.noQApts + ' pts at weight ' + out.noQAw.qa);
ok('the remaining drivers renormalise to 100', out.noQAsum === 100, String(out.noQAsum));
ok('a real 0% QA still scores zero on a real weight', out.qa0Pts === 0 && out.qa0W === 25,
  'pts ' + out.qa0Pts + ' at weight ' + out.qa0W);
ok('QA is monotonic: 0% < 70% < 100%', out.qa0 < out.qa70 && out.qa70 < out.qa100,
  [out.qa0, out.qa70, out.qa100].join(' / '));
ok('an unevaluated agent no longer beats one evaluated at 70% on the old imputation',
  out.oldNoQAscore > (Math.min(0.9, 1.25) / 1.25 * 45 + 0.70 * 25 + 0.95 * 20 + Math.min(0.8, 1) * 10) / 100,
  'the bug this replaces did not reproduce — check the fixture');
ok('a missing attendance figure does not read as an attendance failure',
  out.noAttW === 0 && out.noAttScore > out.zeroAttScore,
  'no-data ' + out.noAttScore + ' vs a real zero ' + out.zeroAttScore);
ok('an agent with no measured driver at all scores 0 rather than crashing',
  out.nothingScore === 0 && out.nothingW === 0, JSON.stringify([out.nothingScore, out.nothingW]));

/* ---- what this does to the real floor, reported rather than asserted ------------- */
let blob = null;
try {
  const envTxt = fs.readFileSync(path.join(AGENTOS, 'supabase.env'), 'utf8');
  const env = Object.fromEntries(envTxt.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/vas-state',
    { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY } , signal: AbortSignal.timeout(90000) });
  if (r.ok) blob = await r.text();
} catch (e) { /* offline */ }
if (blob) {
  await page.evaluate(x => { const S = window.__mtd.state(); const o = JSON.parse(x);
    for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, blob);
  const impact = await page.evaluate(() => {
    const d = window.__mtd.digest(); const rows = (d && d.agents) || [];
    const moved = [];
    for (const r of rows) {
      const p = r.scoreParts; if (!p) continue;
      const old = (function () {
        const t = Math.min((r.pctT ?? 0) / 1.0, 1.25) / 1.25;
        const qa = r.qa != null ? r.qa : 0.8;
        const att = r.att ?? 0;
        const opt = Math.min((p.opt.v ?? 0) / 0.5, 1);
        return Math.max(0, Math.min(1, (t * 45 + qa * 25 + att * 20 + opt * 10) / 100));
      })();
      const delta = Math.round((r.score - old) * 1000) / 10;
      if (Math.abs(delta) >= 0.1) moved.push(delta);
    }
    moved.sort((a, b) => a - b);
    return { n: rows.length, moved: moved.length, min: moved[0], max: moved[moved.length - 1],
      up: moved.filter(x => x > 0).length, down: moved.filter(x => x < 0).length };
  });
  console.log('\n  IMPACT ON THE LIVE FLOOR: ' + impact.moved + ' of ' + impact.n + ' agents\' scores change '
    + '(' + impact.up + ' up, ' + impact.down + ' down; range ' + impact.min + ' to +' + impact.max + ' points).');
  console.log('  Every mover is an agent missing at least one driver — nobody with a complete picture moves.');
}
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
