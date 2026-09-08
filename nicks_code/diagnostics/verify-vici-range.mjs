/* Verify three claimed defects in the ViciDial RANGE path (audit round 3):
   A. a non-reported campaign (VT) in a range pull crashes buildModel
   B. an excluded agent (MTD_RULES.excludeAgents) leaks in through the range path
   C. two overlapping range files double-count the same agent's talk           */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const HTML = path.join(AGENTOS, 'nicks_code', 'index.html');
const SERVE = { '/': HTML, '/xlsx.full.min.js': path.join(AGENTOS, 'site', 'xlsx.full.min.js') };
const srv = http.createServer((q, s) => { const p = SERVE[q.url.split('?')[0]];
  if (!p) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s); });
await new Promise(r => srv.listen(8193, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
await page.goto('http://127.0.0.1:8193/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });

const out = await page.evaluate(() => {
  const S = window.__mtd.state();
  const R = window.__mtd.rules();
  const excluded = Object.keys(R.excludeAgents || {})[0] || 'CB67';
  S.roster = [
    { code: 'CB800', name: 'Cuddle Person', sf: 'Cuddle Person', callx: 'Cuddle Person CB-800', campaign: 'Cuddle', tenure: 'Exp', tl: 'TL A', target: 5 },
    { code: 'CB801', name: 'Tracker Person', sf: 'Tracker Person', callx: 'Tracker Person CB-801', campaign: 'VT', tenure: 'Exp', tl: 'TL A', target: 5 },
    { code: excluded, name: 'Excluded Person', sf: 'Excluded Person', callx: 'Excluded Person CB-' + excluded.replace(/\D/g, ''), campaign: 'Cuddle', tenure: 'Exp', tl: 'TL A', target: 5 },
  ];
  S.att = { '2026-08-03': { CB800: 'P', CB801: 'P', [excluded]: 'P' } };
  S.ui.preset = 'custom'; S.ui.from = '2026-08-03'; S.ui.to = '2026-08-05';
  const res = { reported: R.reportedCampaigns, excluded };

  // --- A: a VT agent inside a range pull ---
  S.vici = { '2026-08-03..2026-08-05': { from: '2026-08-03', to: '2026-08-05',
    rows: [{ name: 'Tracker Person', talk: 3600, calls: 10, opt: 0 }] } };
  try { window.__mtd.rebuild(); res.vtCrash = null; const M = window.__mtd.model();
    res.vtFacts = (M.facts || []).filter(f => f.code === 'CB801').length; }
  catch (e) { res.vtCrash = String(e.message).slice(0, 100); }

  // --- B: an excluded agent inside a range pull ---
  S.vici = { '2026-08-03..2026-08-05': { from: '2026-08-03', to: '2026-08-05',
    rows: [{ name: 'Excluded Person', talk: 7200, calls: 20, opt: 0 }] } };
  try { window.__mtd.rebuild(); const M = window.__mtd.model();
    res.exclFacts = (M.facts || []).filter(f => f.code === excluded).length;
    res.exclInModel = (M.agents || []).some(a => a.code === excluded); }
  catch (e) { res.exclErr = String(e.message).slice(0, 100); }

  // --- C: two overlapping range pulls for one agent ---
  S.vici = {
    'r1': { from: '2026-08-03', to: '2026-08-04', rows: [{ name: 'Cuddle Person', talk: 3600, calls: 10, opt: 0 }] },
    'r2': { from: '2026-08-03', to: '2026-08-05', rows: [{ name: 'Cuddle Person', talk: 5400, calls: 15, opt: 0 }] },
  };
  try { window.__mtd.rebuild(); const M = window.__mtd.model();
    const rows = (M.facts || []).filter(f => f.code === 'CB800');
    res.dupRows = rows.length;
    res.dupTalk = rows.reduce((t, f) => t + (f.talk || 0), 0);
    res.dupExpected = 5400;   // the fuller single pull, never the sum
  } catch (e) { res.dupErr = String(e.message).slice(0, 100); }
  /* --- C2: THE SAME TWO PULLS, LOADED THE OTHER WAY ROUND ---
     A rangeAgg row is anchored at its range's END date, so a NARROWER pull loaded after a
     wider one could not see it and pushed a second row. The talk then read as the SUM.
     Proven order-dependent 2026-08-28; both orders must now give the fuller pull. */
  try {
    S.vici = {
      'wide':   { from: '2026-08-03', to: '2026-08-05', rows: [{ name: 'Cuddle Person', talk: 5400, calls: 15, opt: 0 }] },
      'narrow': { from: '2026-08-03', to: '2026-08-04', rows: [{ name: 'Cuddle Person', talk: 3600, calls: 10, opt: 0 }] },
    };
    window.__mtd.rebuild();
    const M2 = window.__mtd.model();
    res.wideFirstTalk = (M2.facts || []).filter(f => f.code === 'CB800').reduce((t, f) => t + (f.talk || 0), 0);
  } catch (e) { res.wideFirstErr = String(e.message).slice(0, 100); }

  /* --- D: one campaign per agent-day, and V09 must not cry wolf ---
     The range row and the day row are pushed by DIFFERENT code paths; if they derive the
     campaign differently the same agent-day lands in two campaigns, which splits one
     person's day across two floors — and V09 (error severity) reports it. */
  try {
    const M = window.__mtd.model();
    const seen = {}; const clash = [];
    for (const f of (M.facts || [])) {
      const k = f.code + '|' + f.date;
      if (seen[k] && seen[k] !== f.campaign) clash.push(k + ': ' + seen[k] + '+' + f.campaign);
      seen[k] = f.campaign;
    }
    res.campClash = clash.slice(0, 3);
    const v9 = (window.__mtd.checks() || []).find(c => c.id === 'V09');
    res.v09 = v9 ? (v9.ok ? 'pass' : 'FAIL:' + v9.msg) : '(absent)';
  } catch (e) { res.campClash = ['err:' + e.message]; }
  return res;
});
console.log(JSON.stringify(out, null, 1));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };
ok('a non-reported campaign (VT) in a range pull does not crash buildModel', out.vtCrash === null, String(out.vtCrash));
ok('...and produces no fact row for that agent', out.vtFacts === 0, String(out.vtFacts));
ok('an excluded agent cannot enter through the range path', out.exclFacts === 0 && out.exclInModel === false,
  'facts=' + out.exclFacts + ' inModel=' + out.exclInModel);
ok('two overlapping range pulls keep the FULLER one, never their sum',
  out.dupTalk === out.dupExpected, out.dupTalk + ' vs ' + out.dupExpected);
ok('the fuller pull wins WHICHEVER ORDER the two range files arrive in',
  out.wideFirstTalk === out.dupExpected, 'wide-first=' + out.wideFirstTalk + ' vs ' + out.dupExpected);
ok('no agent-day is split across two campaigns by the range path',
  Array.isArray(out.campClash) && out.campClash.length === 0, JSON.stringify(out.campClash));
ok('V09 does not false-alarm with a range file loaded', out.v09 === 'pass', String(out.v09));
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
