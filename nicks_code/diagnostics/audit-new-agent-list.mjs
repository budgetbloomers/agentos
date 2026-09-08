/* WHAT HAPPENS TO MONTH-TO-DATE WHEN YOU UPLOAD A NEW AGENT LIST?
 *
 * Nick, 2026-08-30: "if I upload a new agent list, for the month to date do the old
 * agents still show, or only the new agents?"
 *
 * This is an AUDIT, not a pass/fail test: it takes the live state, uploads a modified
 * Agent List through the real ingest path, and reports what moved. Three shapes, because
 * they behave differently and only one of them is obvious:
 *
 *   A  a LEAVER  — on the old list, absent from the new one
 *   B  an INTAKE — absent from the old list, on the new one
 *   C  a MOVER   — on both, but under a different leader / campaign
 *
 * Nothing is written anywhere: the state is loaded into a headless page, edited there,
 * and thrown away when the browser closes. The live blob is never saved back.
 *
 * Run: node nicks_code/diagnostics/audit-new-agent-list.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const HTML = path.join(AGENTOS, 'nicks_code', 'index.html');

const envTxt = fs.readFileSync(path.join(AGENTOS, 'supabase.env'), 'utf8');
const env = Object.fromEntries(envTxt.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
process.stdout.write('loading the live VAS state … ');
const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/vas-state',
  { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY }, signal: AbortSignal.timeout(120000) });
if (!r.ok) { console.log('FAILED ' + r.status); process.exit(1); }
const blob = await r.text();
console.log((blob.length / 1048576).toFixed(1) + ' MB');

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
await new Promise(x => srv.listen(8251, '127.0.0.1', x));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
await page.goto('http://127.0.0.1:8251/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 60000 });
await page.evaluate(x => { const S = window.__mtd.state(); const o = JSON.parse(x);
  for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, blob);

const out = await page.evaluate(async () => {
  const S = window.__mtd.state();
  const HEAD = ['Employee Code', 'Agent Name', 'Sales Force', 'Team Leader', 'Campaign', 'Tenure', 'Call x', 'Target', 'Start Date'];
  const q = (v) => { const t = String(v == null ? '' : v); return /[",]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const toCsv = (rows) => [HEAD.join(',')].concat(rows.map(a => [a.code, a.name, a.sf || a.name, a.tl || '',
    a.campaign || '', a.tenure || '', a.callx || '', a.target, a.start || ''].map(q).join(','))).join('\n');
  const ORIGINAL = (S.roster || []).map(a => ({ ...a }));

  /* M.agents carries IDENTITY only; the numbers are per-agent-per-day rows in
     M.facts. Aggregating from facts is also the honest way to read this: it is
     the same set the money model sums. */
  const perAgent = (M) => {
    const by = {};
    for (const f of (M.facts || [])) {
      const o = by[f.code] = by[f.code] || { code: f.code, name: f.agent, tl: f.tl, campaign: f.campaign, sales: 0, gwp: 0 };
      o.sales += (f.sales || 0); o.gwp += (f.gwpEx || 0);
      o.tl = f.tl; o.campaign = f.campaign;          // last seen wins — the period's org
    }
    return Object.values(by);
  };
  const snap = () => {
    const M = window.__mtd.model();
    const byCamp = {};
    for (const f of (M.facts || [])) {
      const c = String(f.campaign || '?');
      const o = byCamp[c] = byCamp[c] || { codes: new Set(), sales: 0, gwp: 0 };
      o.codes.add(f.code); o.sales += (f.sales || 0); o.gwp += (f.gwpEx || 0);
    }
    const outC = {};
    for (const [c, v] of Object.entries(byCamp)) outC[c] = { agents: v.codes.size, sales: v.sales, gwp: Math.round(v.gwp) };
    return {
      roster: (S.roster || []).length,
      onMtd: (M.agents || []).length,
      factRows: (M.facts || []).length,
      grandSales: (M.grand && M.grand.sales) || 0,
      grandGwp: Math.round((M.grand && M.grand.gwpEx) || 0),
      byCamp: outC,
    };
  };
  const restore = async () => { await window.__mtd.ingest('Matrix - Agent List.csv', toCsv(ORIGINAL), 'roster', 'audit-restore'); window.__mtd.rebuild(); };

  const base = snap();

  /* ---- A · LEAVERS: three real agents WITH month-to-date sales, dropped from the file */
  const withSales = perAgent(window.__mtd.model()).filter(a => a.sales > 0)
    .sort((x, y) => y.sales - x.sales);
  if (!withSales.length) throw new Error('no agent in the model has any sales — cannot audit');
  const leavers = withSales.slice(0, 3).map(a => ({ code: a.code, name: a.name, tl: a.tl, campaign: a.campaign, sales: a.sales, gwp: Math.round(a.gwp) }));
  const leaverCodes = new Set(leavers.map(l => l.code));
  await window.__mtd.ingest('Matrix - Agent List.csv', toCsv(ORIGINAL.filter(a => !leaverCodes.has(a.code))), 'roster', 'audit-leaver');
  window.__mtd.rebuild();
  const afterLeaver = snap();
  const leaverStillOnMtd = (window.__mtd.model().agents || []).filter(a => leaverCodes.has(a.code)).length;
  await restore();

  /* ---- B · INTAKE: a person who has never existed, added to the file */
  const newCode = 'CB' + (Math.max(...ORIGINAL.map(a => parseInt(String(a.code).replace(/\D/g, ''), 10) || 0)) + 1);
  const host = ORIGINAL.find(a => a.campaign === 'Courtesy') || ORIGINAL[0];
  await window.__mtd.ingest('Matrix - Agent List.csv', toCsv(ORIGINAL.concat([{
    code: newCode, name: 'Audit Newstarter', sf: 'Audit Newstarter', tl: host.tl,
    campaign: host.campaign, tenure: 'M0', callx: '-', target: 2, start: new Date().toISOString().slice(0, 10),
  }])), 'roster', 'audit-intake');
  window.__mtd.rebuild();
  const afterIntake = snap();
  const intakeOnRoster = !!(S.roster || []).find(a => a.code === newCode);   // BEFORE restore()
  const intakeIdent = (window.__mtd.model().agents || []).find(a => a.code === newCode) || null;
  const intakeRow = perAgent(window.__mtd.model()).find(a => a.code === newCode)
    || (intakeIdent ? { code: newCode, sales: 0, gwp: 0, tl: intakeIdent.tl, campaign: intakeIdent.campaign, noFacts: true } : null);
  await restore();

  /* ---- C · MOVER: an agent whose leader AND campaign both change */
  const mover = withSales.find(a => a.campaign === 'Courtesy' && (a.sales || 0) > 0) || withSales[0];
  const otherTl = [...new Set(ORIGINAL.filter(a => a.campaign === 'Cuddle').map(a => a.tl))][0];
  const movedRows = ORIGINAL.map(a => a.code === mover.code
    ? { ...a, tl: otherTl, campaign: 'Cuddle' } : a);
  await window.__mtd.ingest('Matrix - Agent List.csv', toCsv(movedRows), 'roster', 'audit-mover');
  window.__mtd.rebuild();
  const afterMove = snap();
  const movedRow = perAgent(window.__mtd.model()).find(a => a.code === mover.code) || null;
  await restore();

  /* ---- D1 · A BRAND NEW TEAM LEADER WITH BRAND NEW AGENTS (nobody has any data) */
  const baseNum = Math.max(...ORIGINAL.map(a => parseInt(String(a.code).replace(/[^0-9]/g, ''), 10) || 0));
  const freshTeam = [1, 2, 3].map((i) => ({
    code: 'CB' + (baseNum + 10 + i), name: 'Audit Fresh ' + i, sf: 'Audit Fresh ' + i,
    tl: 'Audit Newleader', campaign: 'Courtesy', tenure: 'M0', callx: '-', target: 2,
    start: new Date().toISOString().slice(0, 10),
  }));
  await window.__mtd.ingest('Matrix - Agent List.csv', toCsv(ORIGINAL.concat(freshTeam)), 'roster', 'audit-newtl');
  window.__mtd.rebuild();
  const afterNewTl = snap();
  const M1 = window.__mtd.model();
  const newTlOnRoster = (S.roster || []).filter(a => a.tl === 'Audit Newleader').length;
  const newTlInModel = [...new Set((M1.agents || []).map(a => a.tl))].includes('Audit Newleader');
  const newTlAggRows = Object.keys(M1.tlAgg || {}).filter(k => k.indexOf('Audit Newleader') >= 0).length;
  await restore();

  /* ---- D2 · A NEW TEAM LEADER WHO INHERITS AN EXISTING TEAM (the realistic one).
     The people already have a full month behind them and the list owns the month, so
     the question is whether a leader who started yesterday is handed all of it. */
  const victimTl = withSales[0].tl;
  const inherited = ORIGINAL.filter(a => String(a.tl || '').trim() === victimTl);
  const inheritedCodes = new Set(inherited.map(a => a.code));
  const bv = perAgent(window.__mtd.model()).filter(a => inheritedCodes.has(a.code))
    .reduce((o, a) => ({ sales: o.sales + a.sales, gwp: o.gwp + a.gwp }), { sales: 0, gwp: 0 });
  await window.__mtd.ingest('Matrix - Agent List.csv',
    toCsv(ORIGINAL.map(a => inheritedCodes.has(a.code) ? { ...a, tl: 'Audit Takeover' } : a)), 'roster', 'audit-takeover');
  window.__mtd.rebuild();
  const afterTakeover = snap();
  const M2 = window.__mtd.model();
  const tt = perAgent(M2).filter(a => a.tl === 'Audit Takeover')
    .reduce((o, a) => ({ n: o.n + 1, sales: o.sales + a.sales, gwp: o.gwp + a.gwp }), { n: 0, sales: 0, gwp: 0 });
  const oldTlLeft = perAgent(M2).filter(a => a.tl === victimTl).length;
  await restore();

  const restored = snap();
  return { base, leavers, afterLeaver, leaverStillOnMtd,
    newCode, afterIntake, onRoster: intakeOnRoster,
    intakeRow: intakeRow && { code: intakeRow.code, sales: intakeRow.sales, gwp: Math.round(intakeRow.gwp || 0), tl: intakeRow.tl, campaign: intakeRow.campaign, noFacts: !!intakeRow.noFacts },
    intakeIdentOnMtd: !!intakeIdent,
    mover: { code: mover.code, name: mover.name, from: mover.tl + ' · ' + mover.campaign, sales: mover.sales, gwp: Math.round(mover.gwp || 0) },
    movedTo: otherTl, afterMove, movedRow: movedRow && { tl: movedRow.tl, campaign: movedRow.campaign, sales: movedRow.sales, gwp: Math.round(movedRow.gwp) },
    afterNewTl, newTlOnRoster, newTlInModel, newTlAggRows,
    victimTl, inheritedN: inherited.length, beforeVictim: { sales: bv.sales, gwp: Math.round(bv.gwp) },
    afterTakeover, takeoverTotals: { n: tt.n, sales: tt.sales, gwp: Math.round(tt.gwp) }, oldTlLeft,
    restored };
});

const money = (n) => 'R' + Number(n || 0).toLocaleString('en-ZA');
const camps = (s) => Object.entries(s.byCamp).sort().map(([k, v]) => `${k} ${v.agents}a/${v.sales}s/${money(v.gwp)}`).join('  ·  ');

console.log('\n\x1b[1mBASELINE — the live month to date\x1b[0m');
console.log(`  roster ${out.base.roster} · on Month to Date ${out.base.onMtd} · ${out.base.grandSales} sales · ${money(out.base.grandGwp)}`);
console.log('  ' + camps(out.base));

console.log('\n\x1b[1mA · A LEAVER IS DROPPED FROM THE NEW LIST\x1b[0m');
console.log('  removed: ' + out.leavers.map(l => `${l.code} ${l.name} (${l.campaign}, ${l.sales} sales, ${money(l.gwp)})`).join('\n           '));
console.log(`  roster ${out.base.roster} → ${out.afterLeaver.roster} · on MTD ${out.base.onMtd} → ${out.afterLeaver.onMtd}`);
console.log(`  \x1b[31mmonth to date ${out.base.grandSales} → ${out.afterLeaver.grandSales} sales  (${out.afterLeaver.grandSales - out.base.grandSales})\x1b[0m`);
console.log(`  \x1b[31mGWP ${money(out.base.grandGwp)} → ${money(out.afterLeaver.grandGwp)}  (${money(out.afterLeaver.grandGwp - out.base.grandGwp)})\x1b[0m`);
console.log('  ' + camps(out.afterLeaver));
console.log(`  they still appear on Month to Date: ${out.leaverStillOnMtd ? 'YES' : 'NO'}`);

console.log('\n\x1b[1mB · A NEW STARTER IS ADDED\x1b[0m');
console.log(`  added ${out.newCode} "Audit Newstarter"`);
console.log(`  roster ${out.base.roster} → ${out.afterIntake.roster} · on MTD ${out.base.onMtd} → ${out.afterIntake.onMtd}`);
console.log(`  month to date ${out.base.grandSales} → ${out.afterIntake.grandSales} sales · ${money(out.afterIntake.grandGwp)}`);
console.log('  on the roster: ' + (out.onRoster ? 'YES' : 'no') + ' · on Month to Date: ' + (out.intakeIdentOnMtd ? 'YES' : 'no'));
console.log('  their row: ' + (out.intakeRow ? JSON.stringify(out.intakeRow) : 'no fact rows — nothing to report for them yet'));

console.log('\n\x1b[1mC · AN AGENT MOVES TEAM AND CAMPAIGN\x1b[0m');
console.log(`  ${out.mover.code} ${out.mover.name}: ${out.mover.from} → ${out.movedTo} · Cuddle  (${out.mover.sales} sales, ${money(out.mover.gwp)})`);
console.log(`  month to date ${out.base.grandSales} → ${out.afterMove.grandSales} sales · ${money(out.afterMove.grandGwp)}`);
console.log('  ' + camps(out.afterMove));
console.log('  their row now reads: ' + JSON.stringify(out.movedRow));

console.log('\n\x1b[1mD1 \u00b7 A BRAND NEW TEAM LEADER WITH BRAND NEW AGENTS\x1b[0m');
console.log('  added "Audit Newleader" with 3 new people (no history, no activity)');
console.log(`  roster ${out.base.roster} \u2192 ${out.afterNewTl.roster} \u00b7 on MTD ${out.base.onMtd} \u2192 ${out.afterNewTl.onMtd}`);
console.log(`  their agents on the roster: ${out.newTlOnRoster} \u00b7 leader appears on Month to Date: ${out.newTlInModel ? 'YES' : 'NO'} \u00b7 team rows: ${out.newTlAggRows}`);
console.log(`  month to date ${out.base.grandSales} \u2192 ${out.afterNewTl.grandSales} sales`);

console.log('\n\x1b[1mD2 \u00b7 A NEW TEAM LEADER INHERITS AN EXISTING TEAM\x1b[0m');
console.log(`  "${out.victimTl}" replaced by "Audit Takeover" over their ${out.inheritedN} people`);
console.log(`  that team had ${out.beforeVictim.sales} sales / ${money(out.beforeVictim.gwp)} this month BEFORE the change`);
console.log(`  \x1b[33mthe new leader now shows ${out.takeoverTotals.n} agents \u00b7 ${out.takeoverTotals.sales} sales \u00b7 ${money(out.takeoverTotals.gwp)}\x1b[0m`);
console.log(`  the old leader has ${out.oldTlLeft} agents left`);
console.log(`  floor total unchanged: ${out.base.grandSales === out.afterTakeover.grandSales}`);

console.log('\n\x1b[1mRESTORED\x1b[0m');
console.log(`  roster ${out.restored.roster} · on MTD ${out.restored.onMtd} · ${out.restored.grandSales} sales · ${money(out.restored.grandGwp)}`);
console.log('  (nothing was written — the live blob is untouched)');
if (errs.length) console.log('\n  page errors: ' + errs.slice(0, 3).join(' | '));

await b.close(); srv.close();
