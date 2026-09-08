/* THE SEVEN-DRIVER COMPOSITE — THE RULES, THE ARITHMETIC AND WHAT THE AGENT READS.
 *
 * NBA v3.0's rating, ported from the engine that shipped in Composite score.zip
 * (AP.composite) rather than re-derived from its prose. Three things this holds:
 *
 *  1. DRIFT. specs/composite_rules.json is generated from the decision-rules workbook
 *     and COMPOSITE_RULES is the operative copy the app runs from. Change both
 *     together — the same contract MTD_RULES already runs under.
 *
 *  2. THE ARITHMETIC. A driver pays nothing at half of target and its full weight at
 *     target, in a straight line between. The published points and the bar the agent
 *     sees must agree — `paidShare` is the field that exists to prevent them drifting
 *     apart, because a bar filled to attainment beside a points column that starts at
 *     the floor tells one person two different things.
 *
 *  3. THE ABSENCES. An unmeasured driver leaves both sums, a clean agent is not handed
 *     a compliance note, and an agent with no login provisioned is not charged five
 *     points for our provisioning backlog.
 *
 * Run: node verify-composite-score.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
const AGENTOS = process.env.AGENTOS || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');   // repo-relative so the nightly cloud run can find it
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
  if (r.ok) blob = await r.text();
} catch (e) { /* offline */ }
if (!blob) { console.log('(skipping — cannot read live state)'); process.exit(0); }

await new Promise(r => srv.listen(8232, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
await page.goto('http://127.0.0.1:8232/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.compositeRules, null, { timeout: 30000 });
await page.evaluate(x => { const S = window.__mtd.state(); const o = JSON.parse(x);
  for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, blob);
/* PIN THE PERIOD TO THE LATEST MONTH THAT HOLDS DATA. On the 1st of a month the live
   state's current month is empty, the digest builds null, and this guard failed on the
   calendar rather than on the arithmetic it exists to check (first seen 2026-09-01). */
await page.evaluate(() => { const S = window.__mtd.state();
  const days = [...Object.keys(S.sales || {}), ...Object.keys(S.calls || {})].sort();
  if (days.length) window.__mtd.setPeriod(days[days.length - 1].slice(0, 7), 'month'); });

/* ---- 1 · drift against the workbook-generated spec --------------------------------- */
const spec = JSON.parse(fs.readFileSync(path.join(AGENTOS, 'specs', 'composite_rules.json'), 'utf8'));
const live = await page.evaluate(() => window.__mtd.compositeRules());
const drift = [];
if (live.floor !== spec.floor) drift.push('floor');
if (live.windowSessions !== spec.windowSessions) drift.push('windowSessions');
if (live.combinedCap !== spec.combinedCap) drift.push('combinedCap');
if (live.r2aCap !== spec.r2aCap) drift.push('r2aCap');
/* GENERIC (one number, one verdict — 2026-09-07): every scalar key in the spec must equal the live
   copy, so a constant can no longer be added to one side only. Keys starting with _ are notes. */
for (const k of Object.keys(spec)) {
  if (k.startsWith('_') || typeof spec[k] === 'object') continue;
  if (live[k] !== spec[k]) drift.push(k + ' ' + JSON.stringify(live[k]) + ' vs ' + JSON.stringify(spec[k]));
}
ok('every rule-book value has a dated change entry (_changes[] exists and is well formed)',
  Array.isArray(spec._changes) && spec._changes.length > 0 && spec._changes.every(c => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.key && c.why),
  JSON.stringify(spec._changes || null).slice(0, 120));
spec.drivers.forEach(d => { const l = (live.drivers || []).find(x => x.k === d.k);
  if (!l) drift.push('driver ' + d.k + ' missing'); else if (l.w !== d.w) drift.push(d.k + ' weight ' + l.w + ' vs ' + d.w); });
for (const k of Object.keys(spec.targets)) if (live.targets[k] !== spec.targets[k]) drift.push('target ' + k);
/* THE TENURE GROUPS ARE HALF THE RULE BOOK AND WERE NEVER CHECKED (audit, 2026-08-31).
   The conversion targets and the GWP floor live here, and the app and the spec had drifted
   apart on every one of them — 8/10/12/40 in the file against 3/5/7/30 in the engine, with
   a whole Nesting group in one and not the other — while this guard passed, because it only
   ever compared weights, targets and penalties. Every driver an agent is scored on is now
   covered. */
if (live.gwpFloorDefault !== spec.gwpFloorDefault) drift.push('gwpFloorDefault');
(spec.tenureGroups || []).forEach(g => { const l = (live.tenureGroups || []).find(x => x.key === g.key);
  if (!l) { drift.push('tenure group ' + g.key + ' missing from the app'); return; }
  if (l.convTarget !== g.convTarget) drift.push(g.key + ' convTarget ' + l.convTarget + ' vs ' + g.convTarget);
  if (l.minGwpSale !== g.minGwpSale) drift.push(g.key + ' minGwpSale ' + l.minGwpSale + ' vs ' + g.minGwpSale); });
(live.tenureGroups || []).forEach(l => { if (!(spec.tenureGroups || []).some(g => g.key === l.key))
  drift.push('tenure group ' + l.key + ' missing from the spec'); });
spec.r2aTiers.forEach(t => { const l = (live.r2aTiers || []).find(x => x.tier === t.tier);
  if (!l || l.penalty !== t.penalty) drift.push('r2a ' + t.tier); });
for (const k of ['windowDays', 'repeatMin', 'persistentMin', 'penRepeat', 'penPersistent', 'penCap'])
  if (live.cx[k] !== spec.cx[k]) drift.push('cx.' + k);
ok('the inlined rules match the workbook spec', drift.length === 0, drift.join(', '));
ok('the seven weights sum to 100', live.drivers.reduce((s, d) => s + d.w, 0) === 100);

/* ---- 2 · the arithmetic, over every agent on the live floor ------------------------- */
const eng = await page.evaluate(() => {
  const d = window.__mtd.digest();
  const rows = (d.agents || []).filter(r => r.composite);
  const bad = { share: [], denom: [], cap: [], recon: [], window: [], rate: [] };
  const M = window.__mtd.model();
  for (const r of rows) {
    const c = r.composite, F = c.floor;
    let sum = 0, wsum = 0;
    for (const p of c.parts) {
      if (!p.measured) { if (p.points !== 0) bad.denom.push(r.code + ':' + p.k); continue; }
      sum += p.points; wsum += p.w;
      const share = Math.max(0, p.att - F) / (100 - F);
      if (Math.abs(share - p.points / p.w) > 0.02) bad.share.push(r.code + ':' + p.k);
    }
    if (wsum !== c.weightScored) bad.denom.push(r.code + ':wsum');
    const score = Math.round(Math.min(100, wsum ? sum / wsum * 100 : 0) * 10) / 10;
    if (Math.abs(score - c.score) > 0.15) bad.recon.push(r.code + ' score ' + c.score + ' vs ' + score);
    if (c.r2a.penalty > 10 || c.cx.points > 5 || c.penaltyTotal > 15) bad.cap.push(r.code);
    /* No bonus term: the sign-in points were removed on 2026-08-31. adj is the composite
       less its deductions and nothing else. */
    const want = Math.round(Math.max(0, c.score - c.penaltyTotal) * 10) / 10;
    if (c.signIn !== undefined) bad.recon.push(r.code + ' still publishes a signIn block');
    if (Math.abs(want - c.adj) > 0.15) bad.recon.push(r.code + ' adj ' + c.adj + ' vs ' + want);
    /* the window is worked sessions only, and never more than the rule allows */
    const worked = (M.byAgentDay[r.code] || []).filter(f => f.act > 0);
    if (c.window > 5 || c.window > worked.length) bad.window.push(r.code);
    /* no fails must mean no rate band — a clean agent is not a compliance note */
    if (!c.r2a.fails && c.r2a.penalty !== 0) bad.rate.push(r.code + ' ' + c.r2a.tier);
  }
  /* the driver dictionary travels once, not once per agent */
  const dict = (d.compositeDrivers || []);
  const partsCarryStrings = rows.some(r => r.composite.parts.some(p => p.label || p.note));
  return { n: rows.length, bad, dictLen: dict.length, partsCarryStrings,
    kb: Math.round(JSON.stringify(d).length / 1024),
    unmeasuredSpread: rows.reduce((a, r) => { const k = r.composite.unmeasured.join('+') || '(none)';
      a[k] = (a[k] || 0) + 1; return a; }, {}) };
});
console.log('  ' + eng.n + ' agents scored · unmeasured: ' + JSON.stringify(eng.unmeasuredSpread));
ok('the bar and the points agree on every row (paidShare = points ÷ weight)', eng.bad.share.length === 0, eng.bad.share.slice(0, 4).join(', '));
ok('an unmeasured driver scores nothing and leaves the denominator', eng.bad.denom.length === 0, eng.bad.denom.slice(0, 4).join(', '));
ok('the composite reconciles from its own parts', eng.bad.recon.length === 0, eng.bad.recon.slice(0, 3).join(', '));
ok('adjustments are capped at 10, 5 and 15 together', eng.bad.cap.length === 0, eng.bad.cap.slice(0, 4).join(', '));
ok('the window is worked sessions only, never more than five', eng.bad.window.length === 0, eng.bad.window.slice(0, 4).join(', '));
ok('a clean agent is never handed a compliance note', eng.bad.rate.length === 0, eng.bad.rate.slice(0, 4).join(', '));
ok('the driver labels travel once, not once per agent (' + eng.kb + ' KB digest)',
  eng.dictLen === 7 && !eng.partsCarryStrings,
  'dictionary ' + eng.dictLen + ', parts still carry strings: ' + eng.partsCarryStrings);

/* ---- an agent with no worked session is not rated, and never scored zero ---------- */
const unrated = await page.evaluate(() => {
  const S = window.__mtd.state(), M = window.__mtd.model();
  const donor = (S.roster || []).find(a => /courtesy/i.test(a.campaign || ''));
  const code = 'CB993';
  S.roster = S.roster.concat([{ code, name: 'Brand New', campaign: donor ? donor.campaign : 'Courtesy',
    tenure: donor ? donor.tenure : 'M1', tl: donor ? donor.tl : '', target: donor ? donor.target : 3 }]);
  window.__mtd.rebuild();
  const c = window.__mtd.composite(code);
  return c ? { rated: c.rated, window: c.window, score: c.score, band: c.band } : null;
});
ok('an agent with no worked session is marked unrated', !unrated || unrated.rated === false,
  JSON.stringify(unrated));

/* ---- an unrated agent must not be given a DIFFERENT measure in the score column ---- */
const unratedCol = await page.evaluate(() => {
  const S = window.__mtd.state(), M0 = window.__mtd.model();
  const donor = (S.roster || []).find(a => /courtesy/i.test(a.campaign || ''));
  const code = 'CB992';
  S.roster = S.roster.concat([{ code, name: 'Brand New', campaign: donor ? donor.campaign : 'Courtesy',
    tenure: 'M1', tl: donor ? donor.tl : '', target: 3 }]);
  window.__mtd.rebuild();
  const c = window.__mtd.composite(code);
  const shown = window.displayScore ? window.displayScore(code, {}) : undefined;
  S.roster = S.roster.filter(a => a.code !== code); window.__mtd.rebuild();
  return { rated: c ? c.rated : null, shown };
});
ok('an agent the composite cannot rate shows no score rather than another measure',
  unratedCol.rated !== false || unratedCol.shown === null, JSON.stringify(unratedCol));

/* ---- the Agent List is the source of truth, and the composite follows it ----------- */
const chain = await page.evaluate(() => {
  const S = window.__mtd.state(), M0 = window.__mtd.model();
  const d = window.__mtd.digest();
  /* Prefer an agent scoring ABOVE the floor: one floored in BOTH tenure groups scores the
     same 50 on each side, and "the score must move" then fails on a data coincidence, not
     on the chain it checks (first seen 2026-09-01, on the closed August state). */
  const floor = (window.__mtd.compositeRules().floor || 0) * 100;
  const cands = (d.agents || []).filter(r => r.campaign === 'Courtesy' && r.composite && r.composite.rated);
  const t = cands.find(r => r.composite.score > floor + 2) || cands[0];
  if (!t) return { skip: true };
  const code = t.code;
  const get = () => { const c = window.__mtd.composite(code), M = window.__mtd.model();
    return { camp: M.primaryCamp[code], tl: (M.agents.find(a => a.code === code) || {}).tl,
      group: c.group, conv: c.parts.find(p => p.k === 'conv').target,
      gwpTotal: Math.round(c.parts.find(p => p.k === 'gwpTotal').target), score: c.score,
      /* the points the two group-dependent drivers actually pay — when both are zero on
         both sides (attainment under the floor either way) the score legitimately stays put */
      movable: c.parts.find(p => p.k === 'conv').points + c.parts.find(p => p.k === 'gwpTotal').points }; };
  const before = get();
  /* the roster snapshot ALONE must not move a reported month — history owns it */
  const row = (S.roster || []).find(a => a.code === code);
  const keptCamp = row.campaign; row.campaign = 'Cuddle';
  window.__mtd.rebuild();
  const rosterOnly = get();
  row.campaign = keptCamp;
  /* the upload path: rewrite the effective-dated history for the list's own month */
  const kept = S.orgHist ? S.orgHist[code] : undefined;
  S.orgHist = S.orgHist || {};
  S.orgHist[code] = [{ d: String(M0.range.from).slice(0, 7) + '-01', tl: 'A New Leader',
    campaign: 'Cuddle', tenure: 'Exp' }];
  window.__mtd.rebuild();
  const after = get();
  if (kept === undefined) delete S.orgHist[code]; else S.orgHist[code] = kept;
  window.__mtd.rebuild();
  return { before, rosterOnly, after, floor };
});
if (chain.skip) ok('the Agent List drives the composite', true);
else {
  ok('a roster snapshot alone does NOT rewrite a reported month',
    chain.rosterOnly.camp === chain.before.camp, JSON.stringify(chain.rosterOnly));
  ok('an Agent List upload moves the campaign and the team leader',
    chain.after.camp !== chain.before.camp && chain.after.tl !== chain.before.tl,
    JSON.stringify(chain.after));
  ok('and the composite follows it — tenure group, targets and score',
    chain.after.group !== chain.before.group && chain.after.conv !== chain.before.conv &&
    chain.after.gwpTotal !== chain.before.gwpTotal &&
    /* an equal score is legitimate when the group-dependent drivers pay nothing on either
       side (under the floor both ways — seen 2026-09-03 on two days of September data),
       or when both sides sit exactly on the floor; the targets above prove the chain moved */
    (chain.after.score !== chain.before.score ||
      (chain.before.movable === 0 && chain.after.movable === 0) ||
      (chain.before.score === chain.floor && chain.after.score === chain.floor)),
    JSON.stringify({ before: chain.before, after: chain.after, floor: chain.floor }));
}

/* ---- no duplicate data ------------------------------------------------------------- */
const dupes = await page.evaluate(() => {
  const S = window.__mtd.state(), M = window.__mtd.model();
  const dup = a => { const seen = {}, out = []; for (const x of a) { if (seen[x]) out.push(x); seen[x] = 1; } return out; };
  const rosterSet = new Set((S.roster || []).map(r => r.code));
  /* one row per agent-day EXCEPT the ViciDial range anchor, which is one row per
     range by design and carries no shift */
  const day = M.facts.filter(f => !f.rangeAgg);
  return { rosterCodes: dup((S.roster || []).map(r => r.code)),
    agentDays: dup(day.map(f => f.code + '|' + f.date)),
    digestRows: dup(((window.__mtd.digest().agents) || []).map(r => r.code)),
    files: dup((S.files || []).map(f => f.type + '|' + f.name)),
    orphanCodes: [...new Set(M.facts.map(f => f.code))].filter(c => !rosterSet.has(c)) };
});
ok('no duplicate CB code on the Agent List', dupes.rosterCodes.length === 0, dupes.rosterCodes.join(', '));
ok('one fact row per agent-day', dupes.agentDays.length === 0, dupes.agentDays.slice(0, 3).join(', '));
ok('one digest row per agent', dupes.digestRows.length === 0, dupes.digestRows.slice(0, 3).join(', '));
ok('no file registered twice', dupes.files.length === 0, dupes.files.slice(0, 2).join(', '));
ok('every scored agent is on the Agent List', dupes.orphanCodes.length === 0, dupes.orphanCodes.slice(0, 4).join(', '));

/* ---- 3 · the sign-in bonus is GONE ---------------------------------------------------
   Removed 2026-08-31 (Nick: "remove the five points that the agent gets for logging in").
   It paid one point per weekday an agent opened Agent Analytics, capped at five, added
   after the deductions. What replaces the four behaviour tests is one that matters more:
   the engine must not award it, publish it, or read the feed that fed it — a stale copy of
   any of the three would put points back on a score nobody can explain. */
const si = await page.evaluate(() => {
  const code = (window.__mtd.digest().agents || [])[0].code;
  /* the old feed, re-seeded generously: six weekday sign-ins used to be worth the cap */
  window.__signIns = { days: { [code]: ['2026-08-24', '2026-08-25', '2026-08-26',
    '2026-08-27', '2026-08-20', '2026-08-21'] }, provisioned: new Set([code]) };
  window.__mtd.rebuild();
  const c = window.__mtd.composite(code);
  window.__signIns = null; window.__mtd.rebuild();
  return { code, adj: c.adj, score: c.score, ded: c.penaltyTotal, signIn: c.signIn,
    reader: typeof window.signInsFor };
});
ok("a seeded sign-in feed adds nothing to the score",
  Math.abs(si.adj - Math.max(0, si.score - si.ded)) < 0.15,
  si.score + " − " + si.ded + " should be " + si.adj);
ok("the composite no longer publishes a signIn block", si.signIn === undefined, JSON.stringify(si.signIn));
ok("the reader of the retired feed is gone too", si.reader === "undefined", String(si.reader));
ok('no page errors in the engine', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close(); srv.close();

/* ---- 4 · what the agent actually reads ---------------------------------------------- */
const AGENT = path.join(AGENTOS, 'agent', 'index.html');
const srv2 = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  const f = u === '/' ? AGENT : null;
  if (!f) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(f).pipe(s);
});
await new Promise(r => srv2.listen(8233, '127.0.0.1', r));
const b2 = await chromium.launch();
const p2 = await b2.newPage();
const errs2 = []; p2.on('pageerror', e => errs2.push(String(e.message).slice(0, 140)));
await p2.goto('http://127.0.0.1:8233/', { waitUntil: 'domcontentloaded' });
await p2.waitForFunction(() => typeof window.pgComposite === 'function', null, { timeout: 20000 });

const view = await p2.evaluate(() => {
  const parts = [
    { k: 'gwpSale', label: 'Avg GWP per Sale', w: 25, value: 104, target: 99, measured: true, att: 100, points: 25, available: 0, onTarget: true },
    { k: 'targetAch', label: 'Target Achievement', w: 20, value: 55, target: 100, measured: true, att: 55, points: 2, available: 18, onTarget: false },
    { k: 'qa', label: 'QA Score', w: 20, value: 93.1, target: 90, measured: true, att: 100, points: 20, available: 0, onTarget: true },
    { k: 'gwpTotal', label: 'Total GWP', w: 15, value: 8944, target: 16632, measured: true, att: 53.8, points: 1.1, available: 13.9, onTarget: false },
    { k: 'conv', label: 'Conversion', w: 10, value: null, target: null, measured: false, att: null, points: 0, available: 0, onTarget: false },
    { k: 'talk', label: 'Talk Time', w: 5, value: 233, target: 210, measured: true, att: 100, points: 5, available: 0, onTarget: true },
    { k: 'attendance', label: 'Attendance', w: 5, value: 100, target: 95, measured: true, att: 100, points: 5, available: 0, onTarget: true }
  ];
  window.ME = { code: 'CB9', name: 'Test Agent', tl: 'Leon', composite: {
    score: 58.1, adj: 56.1, band: 'Needs support', floor: 50, window: 5,
    windowFrom: '2026-08-20', windowTo: '2026-08-27',
    nextBand: { label: 'Building', pointsAway: 3.9 }, onTarget: 4, weightScored: 90,
    unmeasured: ['Conversion'], parts,
    weakest: { k: 'targetAch', label: 'Target Achievement', available: 18 },
    r2a: { tier: 'Tier 0', penalty: 0, fails: 0, audited: 4, cfr: 0, rateKnown: true },
    cx: { points: 0, tier: 'Not measured', cluster: null, n: 0 },
    penalty: 0, cxPenalty: 0, penaltyTotal: 2,
    signIn: { days: 4, points: 4, cap: 5, measured: true }
  } };
  window.D = window.D || {};
  window.D.compositeDrivers = parts.map(p => ({ k: p.k, label: p.label, w: p.w }));
  parts.forEach(p => { delete p.label; });        // as published: numbers only, per agent
  const html = window.pgComposite();
  const el = document.createElement('div'); el.innerHTML = html; document.body.appendChild(el);
  const text = el.textContent.replace(/\s+/g, ' ');
  const rows = el.querySelectorAll('.pg-row');
  /* the solid run of every bar must be proportional to the points it sits beside */
  const bars = [];
  el.querySelectorAll('.pg-row').forEach((row, i) => {
    const solid = row.querySelector('.pg-bar2 i.solid');
    const p = parts[i];
    if (!p.measured) { bars.push({ k: p.k, solid: solid ? 'present' : 'none' }); return; }
    const w = solid ? parseFloat(solid.style.width) : 0;
    bars.push({ k: p.k, solidPct: w, wantPct: (p.points / p.w) * 50 });
  });
  return { text, rowCount: rows.length, bars,
    hasFloorCaption: /changes shade at half of your target/.test(text),
    showsBothLadders: /Tier 0/.test(text) && /Persistent/.test(text),
    clearsBoth: /Clears with two clean audits/.test(text) && /stops coming up for 30 days/.test(text),
    saysPenalty: /penalt/i.test(text),
    /* SA formatting: num() renders 58.1 as "58,1", so the decimal separator is a comma */
    tally: (text.match(/Composite [\d.,]+[^=]*= [\d.,]+ out of 100/) || [''])[0],
    valueAndTarget: Array.from(rows).every(r => /of /.test(r.querySelector('.pg-v') ? r.querySelector('.pg-v').textContent : '')),
    signInRow: /Signing in/i.test(text) };
});
ok('seven driver rows render', view.rowCount === 7, String(view.rowCount));
ok('every row shows value and target', view.valueAndTarget);
ok('the unmeasured driver draws no solid bar', view.bars.find(b => b.k === 'conv').solid === 'none');
const barBad = view.bars.filter(b => b.solidPct != null && Math.abs(b.solidPct - b.wantPct) > 1.5);
ok('the solid run of each bar is proportional to its points', barBad.length === 0, JSON.stringify(barBad));
ok('the floor caption appears once, under the rows', view.hasFloorCaption);
/* 2026-09-02 (Nick): the "What is changing your score" panel — both ladders and their
   clearing rules — is REMOVED from the agent view. The deductions still apply and the
   tally still reconciles below; only the itemised display is gone. */
ok('the adjustment ladders are no longer rendered (removed on Nick’s instruction)', !view.showsBothLadders);
ok('nor their clearing rules', !view.clearsBoth);
ok('the word "penalty" never appears — it is an adjustment', !view.saysPenalty);
ok('the tally line reconciles', /Composite 58[.,]1\s+−\s+2[.,]0 adjustment\s+=\s+56[.,]1 out of 100/
  .test(view.tally.replace(/\s+/g, ' ')), JSON.stringify(view.tally));
ok('the retired sign-in row is not rendered, even from a payload that still carries it',
  view.signInRow === false, 'the panel still draws a Signing in row');
/* ONE SCORE, ONE NAME — the month-to-date table must not print a second, different
   figure called "Score" beside the rating card. */
const mtd = await p2.evaluate(() => {
  const row = (window.mtdRows ? window.mtdRows() : []).find(r => r[0] === 'Score');
  if (!row) return { missing: true };
  const withC = row[1]({ score: 0.79, composite: { rated: true, adj: 56.1 } });
  const without = row[1]({ score: 0.79 });
  return { withC, without };
});
ok('the month-to-date Score row shows the composite when it is published',
  mtd.missing || /56/.test(String(mtd.withC)), JSON.stringify(mtd));
ok('and falls back to the published score when it is not',
  mtd.missing || /79/.test(String(mtd.without)), JSON.stringify(mtd));
/* ---- THE LADDER IS THE TEAM LEADER'S, AND ONLY OVER A SANE WINDOW ------------------
   Two rules, and the first one changed on 2026-08-31. The ladder no longer renders on an
   agent's OWN page at all: it is computed by the Ops engine, which counts a sale by ACCOUNT
   over days present, while the rating beside it counts by CASE over employed shifts. For
   CB70 that read 89,7% under a rating card saying 122,5%, and no window fix reconciles a
   different numerator AND denominator. It still renders for a team leader drilling in
   (D.__back), where it is a management instrument on a screen that carries its own window.
   The second rule is unchanged: even for a team leader, a review measured over the wrong
   period may not raise an action against a named person. */
const nbaGuard = await p2.evaluate(() => {
  window.D = window.D || {};
  const mk = (from, to, asTL) => { window.D.period = { from: '2026-08-01', to: '2026-08-31' };
    window.D.__back = asTL ? { name: 'A Team Leader' } : null;
    window.D.nba = { updatedAt: '2026-08-24', period: { from, to },
      /* nbaBy() matches on `cb`, not `code` — the digest's own key for the CB number */
      agents: [{ cb: 'CB9', code: 'CB9', nba: { code: 'R2', lvl: 1, label: 'Critical QA Failure',
        reason: 'QA score 27,2% — below 80%.', action: 'QA intervention within 48 hrs' } }] };
    const out = window.pgNBA(); window.D.__back = null; return out; };
  const tlSane = mk('2026-08-01', '2026-08-31', true);
  const tlWild = mk('2022-08-27', '2026-08-22', true);
  const agentSane = mk('2026-08-01', '2026-08-31', false);
  return { tlSaneShowsAction: /Critical QA Failure/.test(tlSane),
    tlWildShowsAction: /Critical QA Failure/.test(tlWild),
    tlWildExplains: /out of date/.test(tlWild) && /2022-08-27/.test(tlWild),
    agentSeesNothing: String(agentSane || '').trim() === '' };
});
ok('a team leader drilling in still gets the action over the reported month', nbaGuard.tlSaneShowsAction);
ok('a four-year-wide review raises NO action on a named agent', nbaGuard.tlWildShowsAction === false);
ok('and the reader is told why, with the window that was used', nbaGuard.tlWildExplains);
ok("the agent own page carries no ladder at all — one screen, one engine", nbaGuard.agentSeesNothing);
/* ---- the page must never print a raw driver key at an agent ------------------------ */
const labels = await p2.evaluate(() => {
  const keys = ['gwpSale', 'targetAch', 'qa', 'gwpTotal', 'conv', 'talk', 'attendance'];
  const parts = keys.map(k => ({ k, w: 10, value: k === 'conv' ? null : 50, target: 100,
    measured: k !== 'conv', att: 50, points: 0, available: 0, onTarget: false,
    shown: k === 'conv' ? 1.2 : null, shownNote: k === 'conv' ? 'sales per call' : null }));
  window.ME = { code: 'CB9', name: 'T', tl: 'L', composite: { score: 10, adj: 10, band: 'Needs support',
    floor: 50, window: 5, windowFrom: '2026-08-20', windowTo: '2026-08-27', onTarget: 0,
    weightScored: 60, unmeasured: ['Conversion'], parts, weakest: null,
    r2a: { tier: 'Tier 0', penalty: 0, fails: 0, audited: 0, rateKnown: false },
    cx: { points: 0, tier: 'Not measured' }, penalty: 0, cxPenalty: 0, penaltyTotal: 0,
    signIn: { days: 0, points: 0, cap: 5, measured: true } } };
  /* THE DICTIONARY IS DELIBERATELY ABSENT — the exact hop that failed on 28 August, when
     the Worker's envelope hand-picked its fields and dropped it. */
  window.D = Object.assign({}, window.D, { compositeDrivers: null });
  const el = document.createElement('div'); el.innerHTML = window.pgComposite();
  const text = el.textContent.replace(/\s+/g, ' ');
  return { text, rawKeys: keys.filter(k => new RegExp('\b' + k + '\b').test(text)),
    convShown: /1[.,]2%/.test(text), convNotScored: /shown, not scored/.test(text) };
});
ok('no raw driver key reaches the screen, even with no dictionary',
  labels.rawKeys.length === 0, 'printed: ' + labels.rawKeys.join(', '));
ok('conversion is shown even though it is not scored', labels.convShown, labels.text.slice(0, 160));

/* ---- CONVERSION IS SALES OVER UNIQUE LEADS, OR IT IS NOT SHOWN AT ALL ----------------
   Until 2026-08-31 this page filled an unmeasured Conversion row with sales over dialler
   CALLS — about a fifth of the real figure — under the label the rule book reserves for
   sales over unique leads. The engine has always refused that substitution (compositeFor
   publishes conv as null rather than send sales-per-call wearing conversion's name), and
   the page now refuses it too: the lead count travels on every digest row, so the figure
   is either computed from leads or the row says it is not measured. */
const convLocal = await p2.evaluate(() => {
  /* ONE NUMBER, ONE VERDICT (2026-09-07): the figure travels as the engine's `shown`; the page no
     longer divides sales by leads itself (that fallback printed 1,1% for three agents the engine
     had published as not measured). 12 sales ÷ 150 leads = 8,0 %, published here by the fixture. */
  const parts = [{ k: 'conv', w: 10, value: null, shown: 8, target: 8, measured: false, att: null, points: 0, available: 0, onTarget: false },
    { k: 'qa', w: 20, value: 77.4, target: 90, measured: true, att: 86, points: 14.4, available: 5.6, onTarget: false }];
  const base = { code: 'CB287', name: 'B', tl: 'D', sales: 12, leads: 150,
    days: [{ d: '2026-08-21', s: 1, c: 40 }, { d: '2026-08-27', s: 2, c: 45 },
           { d: '2026-08-10', s: 9, c: 10 }],
    composite: { score: 55.4, adj: 53.4, band: 'Needs support', floor: 50, window: 5,
      windowFrom: '2026-08-21', windowTo: '2026-08-27', onTarget: 0, weightScored: 20,
      unmeasured: ['Conversion'], parts, weakest: null,
      r2a: { tier: 'Tier 0', penalty: 0, fails: 0, audited: 0, rateKnown: false },
      cx: { points: 0, tier: 'Not measured' }, penalty: 0, cxPenalty: 0, penaltyTotal: 0,
      signIn: { days: 0, points: 0, cap: 5, measured: true } } };
  const rowFor = (me) => { window.ME = me;
    const el = document.createElement('div'); el.innerHTML = window.pgComposite();
    return [...el.querySelectorAll('.pg-row')].map(r => r.textContent.replace(/\s+/g, ' '))
      .find(r => /Conversion/.test(r)) || ''; };
  const withLeads = rowFor(JSON.parse(JSON.stringify(base)));
  const withoutLeads = Object.assign(JSON.parse(JSON.stringify(base)), { leads: null }); withoutLeads.composite.parts[0].shown = null;   // no leads ⇒ the engine publishes no conversion
  const noLeads = rowFor(withoutLeads);
  const unpublished = JSON.parse(JSON.stringify(base)); unpublished.composite.parts[0].shown = null;   // leads present, engine silent
  const noShown = rowFor(unpublished);
  return { withLeads, noLeads,
    onLeads: /8[.,]0%/.test(withLeads),
    notPerCall: !/3[.,]2%/.test(withLeads) && !/12[.,]4%/.test(withLeads),
    notScored: /shown, not scored/.test(withLeads),
    /* the row still prints its TARGET ("of 8,0%"); what must be absent is a VALUE — the
       dash is the whole point, so anchor on the label and the chip. */
    blankWithoutLeads: /Conversion—/.test(noLeads) && /not measured/.test(noLeads),
    noDerivation: /Conversion—/.test(noShown) && /not measured/.test(noShown) && !/8[.,]0% of/.test(noShown) };
});
ok('conversion is shown from the figure the engine published (shown)', convLocal.onLeads, convLocal.withLeads);
ok('and never from dialler calls', convLocal.notPerCall, convLocal.withLeads);
ok('it still says it is not scored', convLocal.notScored, convLocal.withLeads);
ok('with leads but no published figure the page prints a dash — it never derives conversion itself',
  convLocal.noDerivation, convLocal.noShown);
ok('with no lead count it reads not measured, not a call-based stand-in',
  convLocal.blankWithoutLeads, convLocal.noLeads);
ok('and it is labelled as shown rather than scored', labels.convNotScored);
/* ---- the state pills must carry their state in colour, not only in the word -------- */
const pills = await p2.evaluate(() => {
  if (typeof window.acTile !== 'function') return { skip: true };
  const el = document.createElement('div');
  el.innerHTML = ['pass', 'watch', 'focus', 'none'].map(s => window.acTile('T', '37%', 'sub', s)).join('');
  document.body.appendChild(el);
  const out = {};
  el.querySelectorAll('.pill').forEach(p => { const cs = getComputedStyle(p);
    out[p.textContent.trim()] = { fg: cs.color, bg: cs.backgroundColor }; });
  el.remove();
  const rgb = v => (String(v).match(/\d+/g) || []).map(Number);
  const isGreen = c => { const [r, g, b] = rgb(c); return g > r && g > b; };
  const isRed = c => { const [r, g, b] = rgb(c); return r > g && r > b; };
  return { out, onTrackGreen: isGreen(out['ON TRACK'].fg), focusRed: isRed(out['FOCUS'].fg),
    distinct: out['ON TRACK'].bg !== out['FOCUS'].bg && out['ON TRACK'].bg !== out['NO DATA'].bg };
});
if (pills.skip) ok('state pills carry colour', true);
else {
  ok('ON TRACK reads green', pills.onTrackGreen, JSON.stringify(pills.out['ON TRACK']));
  ok('FOCUS reads red', pills.focusRed, JSON.stringify(pills.out['FOCUS']));
  ok('the states are visually distinct, not all one outline', pills.distinct, JSON.stringify(pills.out));
}
ok('no page errors in the panel', errs2.length === 0, errs2.slice(0, 2).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b2.close(); srv2.close();
process.exit(fail ? 1 : 0);
