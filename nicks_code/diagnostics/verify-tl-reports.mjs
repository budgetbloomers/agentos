#!/usr/bin/env node
/**
 * verify-tl-reports.mjs — the team leader's Variance and Lead management tabs (2026-09-21).
 *
 *   node nicks_code/diagnostics/verify-tl-reports.mjs
 *
 * Nick: "bring variance report and lead management report to team leader view and map it out just for
 * that team leader." Three halves, one doctrine — PULSE computes, the Worker slices, the page paints:
 *   A · the Worker slice (portal.mjs tlReports over a fixture digest + fixture reports): a team leader
 *       receives ONLY their own agents and their own team block; an agent and a campaign manager are
 *       refused; staff see all; an unpublished key is a 404; team blocks agree with the rows served.
 *   B · the PULSE payloads over the LIVE state (site/pulse, headless): every published variance row is
 *       the engine's own row (buildVariance), every lead figure is the page's own export value
 *       (window.__exp of PAGES.leads), no name/leader/comment/case field travels, nulls stay null,
 *       the digest is untouched and both keys stay under the size cap.
 *   C · the page (site/agent, headless): both tabs render from a fixture for one team leader, the
 *       toolbar carries the report's own stamp, the export sheets carry the on-screen headers, and an
 *       unpublished report is a plain card — never a sign-out.
 */
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { responseText } from '../../tools/kv-store.mjs';   // the VAS state may be kept gzipped at rest (Spec Kit 031)
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const W = (f) => pathToFileURL(path.join(ROOT, 'worker', 'src', f)).href;

/* ================= A · the Worker slice ================= */
console.log('\nA · THE WORKER SLICES BY authorise() — nothing else');
{
  const { tlReports } = await import(W('portal.mjs'));
  const digest = { updatedAt: '2026-09-21T10:00:00Z', period: { from: '2026-09-01', to: '2026-09-30' }, diallingDays: 14, workingDays: 22, dates: [], weeks: [],
    agents: [
      { code: 'CB1', name: 'Alpha One', campaign: 'Courtesy', tl: 'Leader A' }, { code: 'CB2', name: 'Alpha Two', campaign: 'Courtesy', tl: 'Leader A' },
      { code: 'CB3', name: 'Beta One', campaign: 'Courtesy', tl: 'Leader B' } ], notCovered: [] };
  const rowV = (d, ss) => [d, 'Courtesy', ss, ss * 86, 86, ss, null, null, ss, null, 0, 0, 0, 3000, null, null, 1, 0, 'exact', 'exact', 'exact', null, null, null, null, []];
  const variance = { v: 1, kind: 'variance', updatedAt: '2026-09-21T10:05:00Z', period: { from: '2026-09-01', to: '2026-09-30' },
    rules: { statusLabels: { exact: ['pgood', 'Exact'] }, rootCauses: {}, diallerCoverage: {} }, cols: ['d', 'camp', 'ss', 'sg', 'gps', 'bs', 'bg', 'br', 'ds', 'dse', 'vs', 'vg', 'sd', 'tk', 'tke', 'ta', 'pr', 'sk', 'vsv', 'vgv', 'st', 'rcs', 'rcg', 'ras', 'rag', 'fl'],
    days: [{ d: '2026-09-17', bi: 1, board: 1, calls: 1, att: 1, skew: 0 }], checks: [{ id: 'VR01', ok: true, sev: 'error', msg: 'fine' }], blocked: [], skew: false,
    agents: { CB1: [rowV('2026-09-17', 3)], CB2: [rowV('2026-09-17', 1), rowV('2026-09-16', 2)], CB3: [rowV('2026-09-17', 5)] },
    teams: { 'Leader A': { agents: 2, rows: 3, exact: 6, rounding: 0, material: 0, blocked: 0, indeterminate: 0, flags: 0, rc: {} }, 'Leader B': { agents: 1, rows: 1, exact: 2, rounding: 0, material: 0, blocked: 0, indeterminate: 0, flags: 0, rc: {} } },
    teamsByCamp: { 'Courtesy|Leader A': { agents: 2, rows: 3, exact: 6, rounding: 0, material: 0, blocked: 0, indeterminate: 0, flags: 0, rc: {} }, 'Courtesy|Leader B': { agents: 1, rows: 1, exact: 2, rounding: 0, material: 0, blocked: 0, indeterminate: 0, flags: 0, rc: {} }, 'Cuddle|Leader B': { agents: 1, rows: 4, exact: 8, rounding: 0, material: 0, blocked: 0, indeterminate: 0, flags: 0, rc: {} } },
    campaigns: { Courtesy: { agents: 3, rows: 4, exact: 8, rounding: 0, material: 0, blocked: 0, indeterminate: 0, flags: 0, rc: {} }, Cuddle: { agents: 1, rows: 4, exact: 8, rounding: 0, material: 0, blocked: 0, indeterminate: 0, flags: 0, rc: {} } } };
  variance.teamsByCamp['Courtesy|VIP|Leader C'] = { agents: 1, rows: 1, exact: 1, rounding: 0, material: 0, blocked: 0, indeterminate: 0, flags: 0, rc: {}, camp: 'Courtesy|VIP', tl: 'Leader C' };
  variance.campaigns['Courtesy|VIP'] = { agents: 1, rows: 1, exact: 1, rounding: 0, material: 0, blocked: 0, indeterminate: 0, flags: 0, rc: {}, camp: 'Courtesy|VIP' };
  const agentL = (open, tc, sales) => ({ sts: { New: open }, open, tc, nofb: 0, sales, canc: 0, ul: open + tc, dd: 5, aveClosed: 1, aveWasted: 0, pSpd: 1, dSpd: 1, convL: 10, convLv: 'good', convC: 20, convCv: 'good', convW: null, cancPct: 0 });
  const leads = { v: 1, kind: 'leads', updatedAt: '2026-09-21T10:06:00Z', period: { from: '2026-09-01', to: '2026-09-30' }, wd: 15, book: { snapshot: '2026-09-19', open: true, closed: true }, statuses: ['New'],
    rules: { convTarget: 10, convClosed: { good: 20, warn: 10 } }, unmatched: { open: 0, closed: 0 },
    agents: { CB1: agentL(10, 4, 2), CB2: agentL(5, 1, 1), CB3: agentL(7, 2, 9) },
    teams: { 'Leader A': { agents: 2, sts: { New: 15 }, open: 15, tc: 5, nofb: 0, sales: 3, canc: 0, ul: 20, aveClosed: 0.3, aveWasted: 0.1, pSpd: 0.2, convL: 15, convLv: 'good', convC: 60, convCv: 'good', convW: null, cancPct: 0 },
             'Leader B': { agents: 1, sts: { New: 7 }, open: 7, tc: 2, nofb: 0, sales: 9, canc: 0, ul: 9, aveClosed: 0.1, aveWasted: 0, pSpd: 0.6, convL: 100, convLv: 'good', convC: 450, convCv: 'good', convW: null, cancPct: 0 } } };
  const blkL = (camp, tl, open) => Object.assign({ agents: 1, sts: { New: open }, open, tc: 1, nofb: 0, sales: 1, canc: 0, ul: open + 1, aveClosed: 0.1, aveWasted: 0, pSpd: 0.2, convL: 10, convLv: 'good', convC: 20, convCv: 'good', convW: null, cancPct: 0 }, { camp, tl });
  leads.teamsByCamp = { 'Courtesy|Leader A': blkL('Courtesy', 'Leader A', 15), 'Courtesy|Leader B': blkL('Courtesy', 'Leader B', 7), 'Cuddle|Leader B': blkL('Cuddle', 'Leader B', 3) };
  leads.campaigns = { Courtesy: Object.assign(blkL('Courtesy', '', 22), { tl: undefined }), Cuddle: Object.assign(blkL('Cuddle', '', 3), { tl: undefined }) };
  const tlA = { username: 'cb100', role: 'team_leader', cb: 'CB100', team: 'Leader A' };
  const v = tlReports(tlA, digest, variance, 'variance');
  ok('a team leader gets their own agents\' variance rows only (CB1, CB2)', v.status === 200 && Object.keys(v.body.agents).sort().join(',') === 'CB1,CB2', JSON.stringify(Object.keys(v.body.agents)));
  ok('…and only their own team block', Object.keys(v.body.teams).join(',') === 'Leader A' && v.body.team === 'Leader A', JSON.stringify(Object.keys(v.body.teams)));
  ok('…the other team\'s code and leader never appear anywhere in the response', !/CB3|Leader B|Beta One/.test(JSON.stringify(v.body)));
  ok('…the team block agrees with the rows served (2 agents, 3 rows)', v.body.teams['Leader A'].rows === Object.values(v.body.agents).reduce((n, a) => n + a.length, 0) && v.body.teams['Leader A'].agents === Object.keys(v.body.agents).length);
  ok('…floor-level blocks travel (rules, cols, days, checks), missing = 0', Array.isArray(v.body.cols) && v.body.days.length === 1 && v.body.checks.length === 1 && v.body.missing === 0);
  const l = tlReports(tlA, digest, leads, 'leads');
  ok('the lead report is sliced the same way', l.status === 200 && Object.keys(l.body.agents).sort().join(',') === 'CB1,CB2' && Object.keys(l.body.teams).join(',') === 'Leader A' && !/CB3|Leader B/.test(JSON.stringify(l.body)));
  ok('…and the team block equals the sum of the rows served (open 15, closed 5, sales 3)', l.body.teams['Leader A'].open === 15 && l.body.teams['Leader A'].tc === 5 && l.body.teams['Leader A'].sales === 3);
  const ag = tlReports({ username: 'cb1', role: 'agent', cb: 'CB1' }, digest, variance, 'variance');
  ok('an agent is refused (403) with no data', ag.status === 403 && !ag.body.agents);
  globalThis.__cmCtx = { assign: { dalwin: { campaigns: ['courtesy'] } }, campaigns: [], leaders: {}, sla: {}, blockages: [] };
  const cm = tlReports({ username: 'dalwin', role: 'campaign_manager', cb: '' }, digest, variance, 'variance');
  ok('a campaign manager gets the agents of their campaigns (all three are Courtesy)', cm.status === 200 && Object.keys(cm.body.agents).sort().join(',') === 'CB1,CB2,CB3', JSON.stringify(cm.body).slice(0, 200));
  ok('…only leader × campaign blocks of THEIR campaigns — Leader B\'s Cuddle block never travels, nor any leader-only block', Object.keys(cm.body.teamsByCamp).sort().join(',') === 'Courtesy|Leader A,Courtesy|Leader B' && Object.keys(cm.body.teams).length === 0 && !/Cuddle/.test(JSON.stringify(cm.body.teamsByCamp)), JSON.stringify(Object.keys(cm.body.teamsByCamp)));
  ok('…and only their campaign totals', Object.keys(cm.body.campaigns).join(',') === 'Courtesy' && cm.body.scope === 'campaign' && cm.body.campBlocks === 'ok');
  ok('…a block whose KEY starts "Courtesy|" but whose campaign is "Courtesy|VIP" never travels (the slice reads the block, not the key)', !/VIP|Leader C/.test(JSON.stringify(cm.body)));
  const cm2 = tlReports({ username: 'dalwin', role: 'campaign_manager', cb: '' }, digest, leads, 'leads');
  ok('the lead report gives a manager their leader × campaign blocks and campaign total only — no leader-only block, no Cuddle',
    cm2.status === 200 && Object.keys(cm2.body.teams).length === 0 && Object.keys(cm2.body.teamsByCamp).sort().join(',') === 'Courtesy|Leader A,Courtesy|Leader B' && Object.keys(cm2.body.campaigns).join(',') === 'Courtesy' && !/Cuddle/.test(JSON.stringify(cm2.body)), JSON.stringify(Object.keys(cm2.body.teamsByCamp)));
  const cmOld = tlReports({ username: 'dalwin', role: 'campaign_manager', cb: '' }, digest, { ...variance, teamsByCamp: undefined, campaigns: undefined }, 'variance');
  ok('a report published before the campaign blocks existed says so (campBlocks = absent), never an empty 200 that paints zeros', cmOld.status === 200 && cmOld.body.campBlocks === 'absent' && Object.keys(cmOld.body.teamsByCamp).length === 0);
  const cmNone = tlReports({ username: 'dalwin', role: 'campaign_manager', cb: '' }, digest, { ...variance, teamsByCamp: { 'Cuddle|Leader B': { ...variance.teamsByCamp['Courtesy|Leader B'], camp: 'Cuddle' } }, campaigns: { Cuddle: variance.campaigns.Cuddle } }, 'variance');
  ok('…and a report with nothing under the manager\'s campaigns says so (campBlocks = none)', cmNone.status === 200 && cmNone.body.campBlocks === 'none' && Object.keys(cmNone.body.teamsByCamp).length === 0);
  const st = tlReports({ username: 'aarav', role: 'admin', cb: '' }, digest, variance, 'variance');
  ok('staff preview sees every agent and every team', st.status === 200 && Object.keys(st.body.agents).length === 3 && Object.keys(st.body.teams).length === 2);
  const un = tlReports(tlA, digest, null, 'leads');
  ok('an unpublished key is a 404 that says so', un.status === 404 && /not been published/.test(un.body.error));
  const unknown = tlReports({ username: 'cb999', role: 'team_leader', cb: 'CB999', team: 'Leader Z' }, digest, variance, 'variance');
  ok('a leader with no agents on the digest is refused by authorise, not served an empty slice (' + unknown.status + ')', unknown.status >= 400 && !unknown.body.agents);
}

/* ================= B · the PULSE payloads over the live state ================= */
console.log('\nB · PULSE PUBLISHES WHAT ITS OWN PAGES SHOW');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const blob = await responseText(await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/vas-state', { headers: H }));
const PULSE = path.join(ROOT, 'site', 'pulse', 'index.html'), AGENT = path.join(ROOT, 'site', 'agent', 'index.html');
const SITE = path.join(ROOT, 'site');
const server = http.createServer((q, s) => {
  const u = q.url.split('?')[0];
  if (/\.js$/.test(u)) { const f = path.join(SITE, u.replace(/^\/agent/, '')); if (fs.existsSync(f)) { s.writeHead(200, { 'Content-Type': 'text/javascript' }); fs.createReadStream(f).pipe(s); } else { s.writeHead(404); s.end(); } return; }
  const f = u.startsWith('/agent') ? AGENT : PULSE; s.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => server.listen(8271, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
try {
  const page = await b.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto('http://127.0.0.1:8271/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  const month = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7);
  const B = await page.evaluate(async ([x, month]) => {
    const S = window.__mtd.state(); const o = JSON.parse(x); for (const k of Object.keys(o)) S[k] = o[k]; normalizeState(); window.toast = () => {};
    window.__mtd.setPeriod(month, 'month');
    const M = window.__mtd.model();
    const v = window.__mtd.reports('variance'), l = window.__mtd.reports('leads');
    const VR = window.__mtd.variance(M.range.from, M.range.to);
    const engineRows = VR.rows.filter((r) => r.camp !== 'VT');
    const pubRows = v ? Object.values(v.agents).reduce((n, a) => n + a.length, 0) : 0;
    /* one engine row, found in the payload by code+day, compared field by field */
    const idx = {}; (v ? v.cols : []).forEach((c, i) => { idx[c] = i; });
    let mismatch = null, checked = 0, nullKept = 0, gwpRoundedOnce = true;
    for (const r of engineRows) {
      const arr = (v.agents[r.code] || []).find((a) => a[idx.d] === r.d); if (!arr) { mismatch = 'missing ' + r.code + ' ' + r.d; break; }
      checked++;
      const pairs = [['ss', r.sfSales], ['sg', r.sfGwp], ['bs', r.bdSales], ['bg', r.bdGwp], ['ds', r.dlSales], ['vs', r.salesVar], ['vg', r.gwpVar], ['tk', r.talk], ['vsv', r.v.sales], ['vgv', r.v.gwp], ['st', vrRowStat(r)], ['rcs', r.rcSales || null]];
      for (const [k, want] of pairs) { const got = arr[idx[k]]; if ((want == null ? null : want) !== (got == null ? null : got)) { mismatch = r.code + ' ' + r.d + ' ' + k + ': engine ' + want + ' payload ' + got; break; } }
      if (mismatch) break;
      if (r.bdSales == null && arr[idx.bs] !== null) { mismatch = 'null board became ' + arr[idx.bs]; break; }
      if (r.bdSales == null) nullKept++;
      if (r.sfGwp != null && arr[idx.sg] !== r.sfGwp) gwpRoundedOnce = false;
    }
    /* the team blocks: rows per team ≡ the engine rows grouped on the digest's tl */
    const teamOf = {}; M.agents.forEach((a) => { teamOf[a.code] = a.tl || ''; });
    const byTeam = {}; engineRows.forEach((r) => { const t = teamOf[r.code] || ''; byTeam[t] = (byTeam[t] || 0) + 1; });
    const teamsAgree = v && Object.keys(byTeam).every((t) => v.teams[t] && v.teams[t].rows === byTeam[t]);
    const byTC = {}; engineRows.forEach((r) => { const k = (r.camp || '') + '|' + (teamOf[r.code] || ''); byTC[k] = (byTC[k] || 0) + 1; });
    const tcAgree = v && Object.keys(byTC).every((k) => v.teamsByCamp[k] && v.teamsByCamp[k].rows === byTC[k]) && Object.keys(v.teamsByCamp).length === Object.keys(byTC).length;
    const campAgree = v && Object.keys(v.campaigns).every((c) => v.campaigns[c].rows === engineRows.filter((r) => (r.camp || '') === c).length && v.campaigns[c].camp === c)
      && Object.keys(v.campaigns).length === new Set(engineRows.map((r) => r.camp || '')).size
      && Object.keys(v.teamsByCamp).every((k) => v.teamsByCamp[k].camp + '|' + v.teamsByCamp[k].tl === k);
    /* the lead figures against the page's own export */
    S.ui.camp = ''; S.ui.team = ''; PAGES.leads(); const exp = window.__exp; let leadMismatch = null, leadChecked = 0, uniqueOk = null;
    if (exp && exp.name === 'lead_management' && l) {
      const col = (h) => exp.cols.find((c) => c.h === h);
      for (const row of exp.rows) { if (row.gt) continue; const a = l.agents[row.cb]; if (!a) { leadMismatch = 'not published: ' + row.cb; break; }
        leadChecked++;
        const want = { open: col('Total open').csv(row), tc: col('Total closed').csv(row), sales: col('Sales').csv(row), aveClosed: col('Ave closed p/d').csv(row), pSpd: col('Payroll SPD').csv(row), convL: col('Conv % (leads)').csv(row), convC: col('Conv % (closed)').csv(row), cancPct: col('Canc to sales %').csv(row) };
        for (const k in want) { const w = want[k] === '' ? null : want[k]; if (w !== a[k]) { leadMismatch = row.cb + ' ' + k + ': page ' + want[k] + ' payload ' + a[k]; break; } }
        if (leadMismatch) break; }
      const gt = exp.rows.find((r) => r.gt); const ul = gt ? gt.leads.size : null;
      const allTeamsUl = Object.values(l.teams).reduce((n, t) => n + t.ul, 0);
      uniqueOk = ul != null && allTeamsUl >= ul;   // per-team unions can only sum to ≥ the floor's union
    }
    const src = (fn) => String(fn);
    const banned = /\b\w*(crit|coach|risk|discipl|contact|phone|email|account_no|case_number)\w*\s*:/i;
    const bannedHit = [src(agentReportsVariancePayload), src(agentReportsLeadsPayload)].map((t) => (t.match(banned) || [])[0]).filter(Boolean);
    const rowKeys = v ? v.cols.join(',') : '';
    return { vKB: v ? Math.round(JSON.stringify(v).length / 1024) : 0, lKB: l ? Math.round(JSON.stringify(l).length / 1024) : 0, dKB: Math.round(JSON.stringify(agentDigestPayload()).length / 1024),
      engineRows: engineRows.length, pubRows, checked, mismatch, nullKept, gwpRoundedOnce, teamsAgree, tcAgree, campAgree, leadChecked, leadMismatch, uniqueOk, bannedHit, rowKeys,
      vPeriod: v && v.period, lPeriod: l && l.period, hasNames: v ? /"name"|"tl"|"agent"|"comment"/.test(JSON.stringify(v.agents)) : null, lNames: l ? /"name"|"tl"/.test(JSON.stringify(l.agents)) : null };
  }, [blob, month]);
  ok('the variance payload carries every engine row (' + B.pubRows + ' of ' + B.engineRows + ', non-VT)', B.pubRows === B.engineRows && B.engineRows > 0);
  ok('every published field is the engine\'s own value (' + B.checked + ' rows checked)', !B.mismatch && B.checked === B.engineRows, B.mismatch || '');
  ok('a board-less day publishes null, never 0 (' + B.nullKept + ' null board cells kept)', B.nullKept > 0 || B.engineRows === 0);
  ok('Sales Force GWP travels as the engine\'s own DV02 value (rounded once, never re-derived)', B.gwpRoundedOnce);
  ok('team blocks ≡ the engine rows grouped on the digest\'s team', B.teamsAgree === true);
  ok('leader × campaign blocks and campaign totals ≡ the engine rows grouped on the row\'s campaign', B.tcAgree === true && B.campAgree === true);
  ok('every lead figure equals the page\'s own export value (' + B.leadChecked + ' agents)', B.leadChecked > 0 && !B.leadMismatch, B.leadMismatch || '');
  ok('unique leads are per-team unions (they sum to at least the floor\'s union)', B.uniqueOk === true);
  ok('no agent name, leader or comment travels in either payload\'s rows', B.hasNames === false && B.lNames === false, B.rowKeys);
  ok('no banned field token in either payload function (verify-agent-analytics rule)', !B.bannedHit.length, B.bannedHit.join(','));
  ok('both keys stay under the cap: variance ' + B.vKB + ' KB, leads ' + B.lKB + ' KB (< 400)', B.vKB < 400 && B.lKB < 400 && B.vKB > 0);
  ok('the digest is untouched (' + B.dKB + ' KB)', B.dKB > 100 && B.dKB < 600);
  ok('both payloads describe the same month as the digest (' + month + ')', B.vPeriod && B.vPeriod.from === month + '-01' && B.lPeriod && B.lPeriod.from === month + '-01');
  ok('no page errors', errs.length === 0, errs.join(' | '));

  /* ================= C · the page ================= */
  console.log('\nC · THE TEAM LEADER PAGE PAINTS, EXPORTS, AND NEVER SIGNS OUT ON A MISSING KEY');
  const ap = await b.newPage(); const aerr = []; ap.on('pageerror', (e) => aerr.push(String(e.message).slice(0, 160)));
  await ap.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"stub"}' }));
  await ap.goto('http://127.0.0.1:8271/agent/index.html', { waitUntil: 'domcontentloaded' });
  await ap.waitForFunction(() => typeof pageVarianceTeam === 'function' && typeof reportsTabs === 'function', null, { timeout: 30000 });
  const C = await ap.evaluate(() => {
    const rowV = (d, ss, bs, st) => [d, 'Courtesy', ss, ss == null ? null : ss * 86, ss ? 86 : null, bs, null, null, ss, null, (ss != null && bs != null) ? ss - bs : null, null, 0, 3000, null, null, 1, 0, st, st, st, st === 'material' ? 'RC3' : null, null, null, null, st === 'material' ? [['warning', 'SF 3 vs board 1', 'DV01']] : []];
    window.D = { role: 'team_leader', scope: 'team', team: 'Leader A', name: 'Leader A', period: { from: '2026-09-01', to: '2026-09-30' }, updatedAt: '2026-09-21T10:00:00Z',
      agents: [{ code: 'CB1', name: 'Alpha One', covered: true }, { code: 'CB2', name: 'Alpha Two', covered: true }], totals: {}, summary: null, weeks: [] };
    REP.variance.d = { kind: 'variance', updatedAt: '2026-09-21T10:05:00Z', period: D.period, rules: { gwpTolerance: 1, statusLabels: { exact: ['pgood', 'Exact'], material: ['pcrit', 'MATERIAL'], blocked: ['pmuted', 'blocked'] }, rootCauses: { RC3: 'Identity break' }, diallerCoverage: {} },
      cols: ['d', 'camp', 'ss', 'sg', 'gps', 'bs', 'bg', 'br', 'ds', 'dse', 'vs', 'vg', 'sd', 'tk', 'tke', 'ta', 'pr', 'sk', 'vsv', 'vgv', 'st', 'rcs', 'rcg', 'ras', 'rag', 'fl'],
      days: [{ d: '2026-09-17', bi: 1, board: 1, calls: 1, att: 1, skew: 0 }, { d: '2026-09-16', bi: 1, board: 0, calls: 1, att: 1, skew: 0 }], checks: [{ id: 'VR01', ok: true, sev: 'error', msg: 'fine' }], blocked: [], skew: false,
      agents: { CB1: [rowV('2026-09-17', 3, 1, 'material'), rowV('2026-09-16', 2, null, 'blocked')], CB2: [rowV('2026-09-17', 1, 1, 'exact')] },
      teams: { 'Leader A': { agents: 2, rows: 3, exact: 2, rounding: 0, material: 2, blocked: 2, indeterminate: 0, flags: 1, rc: { RC3: 1 } } }, team: 'Leader A', missing: 0 };
    REP.leads.d = { kind: 'leads', updatedAt: '2026-09-21T10:06:00Z', period: D.period, wd: 15, book: { snapshot: '2026-09-19', open: true, closed: true }, statuses: ['1st attempt', 'New'], rules: { convTarget: 10, convClosed: { good: 20, warn: 10 } }, unmatched: { open: 0, closed: 0 },
      agents: { CB1: { sts: { '1st attempt': 4, New: 6 }, open: 10, tc: 4, nofb: 1, sales: 2, canc: 0, ul: 14, dd: 5, aveClosed: 0.3, aveWasted: 0.1, pSpd: 0.1, dSpd: 0.4, convL: 14.3, convLv: 'good', convC: 50, convCv: 'good', convW: 100, cancPct: 0 },
                CB2: { sts: { '1st attempt': 5, New: 0 }, open: 5, tc: 1, nofb: 0, sales: 0, canc: 0, ul: 6, dd: 3, aveClosed: 0.1, aveWasted: 0.1, pSpd: 0, dSpd: 0, convL: 0, convLv: 'crit', convC: 0, convCv: 'crit', convW: 0, cancPct: null } },
      teams: { 'Leader A': { agents: 2, sts: { '1st attempt': 9, New: 6 }, open: 15, tc: 5, nofb: 1, sales: 2, canc: 0, ul: 20, aveClosed: 0.3, aveWasted: 0.2, pSpd: 0.1, convL: 10, convLv: 'good', convC: 40, convCv: 'good', convW: 66.7, cancPct: 0 } }, team: 'Leader A', missing: 0 };
    VIEW = 'variance_team'; VAR_DAY = '';
    const vh = pageVarianceTeam();
    VIEW = 'leads_team';
    const lh = pageLeadsTeam();
    const sheets = []; let written = null;
    window.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: (aoa) => ({ aoa }), book_append_sheet: (wb, ws, nm) => sheets.push([nm, ws.aoa]) }, writeFile: (wb, name) => { written = name; } };
    exportReports('variance_team'); exportReports('leads_team');
    const vHeads = [...vh.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    const lHeads = [...lh.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    /* the campaign manager paints the SAME fixtures through pageCmReport: one leader × campaign row, one tab strip */
    const tlD = D;
    window.D = { role: 'campaign_manager', scope: 'campaign', team: '', name: 'Dalwin', period: D.period, updatedAt: D.updatedAt, agents: [],
      cm: { campaigns: [{ key: 'courtesy', label: 'Courtesy', agents: 2, agentIndex: [{ code: 'CB1', name: 'Alpha One', covered: true }, { code: 'CB2', name: 'Alpha Two', covered: true }] }] } };
    CMSEL = 'courtesy';
    REP.variance.d.teamsByCamp = { 'Courtesy|Leader A': Object.assign({}, REP.variance.d.teams['Leader A'], { camp: 'Courtesy', tl: 'Leader A' }) };
    REP.variance.d.campaigns = { Courtesy: Object.assign({}, REP.variance.d.teams['Leader A'], { camp: 'Courtesy' }) };
    REP.variance.d.campBlocks = 'ok'; REP.variance.d.scope = 'campaign';
    REP.leads.d.teamsByCamp = { 'Courtesy|Leader A': Object.assign({}, REP.leads.d.teams['Leader A'], { camp: 'Courtesy', tl: 'Leader A' }) };
    REP.leads.d.campaigns = { Courtesy: Object.assign({}, REP.leads.d.teams['Leader A'], { camp: 'Courtesy' }) };
    REP.leads.d.campBlocks = 'ok'; REP.leads.d.scope = 'campaign';
    VIEW = 'cm_variance'; const cvh = pageCmReport('variance');
    VIEW = 'cm_leads'; const clh = pageCmReport('leads');
    const cmSheets = sheets.length; exportReports('cm_variance'); const cmWritten = written;
    REP.variance.d.campBlocks = 'none'; VIEW = 'cm_variance'; const cvNone = pageCmReport('variance'); REP.variance.d.campBlocks = 'ok';
    window.D = tlD; CMSEL = '';
    /* an unpublished key */
    REP.leads.d = null; REP.leads.err = 'unpublished';
    const lu = pageLeadsTeam();
    try { sessionStorage.setItem('cbx_agent_token', 'keep'); } catch (e) {}
    return { vh, lh, lu, vHeads, lHeads, cvh, clh, cvNone, cmSheetsAdded: sheets.length - cmSheets, cmWritten, sheets: sheets.map((s) => [s[0], s[1][0], s[1].length]), written, tokenKept: (function () { try { return sessionStorage.getItem('cbx_agent_token') === 'keep'; } catch (e) { return true; } })() };
  });
  ok('the Variance tab renders the summary tiles and 3 agent-day rows, worst status first', /My team/.test(C.vh) && /Agents compared/.test(C.vh) && (C.vh.match(/<tr>/g) || []).length >= 3 && C.vh.indexOf('MATERIAL') < C.vh.indexOf('Exact</span>'));
  ok('…with the report\'s own Published stamp (not the digest\'s)', /Published 21 Sep/.test(C.vh) && /:05/.test(C.vh) && !/Published not yet/.test(C.vh), (C.vh.match(/Published [^<]*/) || [])[0]);
  ok('…a board-less day is named beside its rows, and a null cell is a dash', /no Manual Stats sheet for this day/.test(C.vh) && /–/.test(C.vh));
  ok('…the root cause and the flag travel as published, never derived', /RC3/.test(C.vh) && /SF 3 vs board 1/.test(C.vh));
  ok('the Lead management tab renders the four tiles and the funnel per agent in the VAS column order', /Open leads/.test(C.lh) && /Conversion \(leads\)/.test(C.lh) && C.lHeads.indexOf('Currently on: 1st attempt') === 1 && C.lHeads.indexOf('Canc to sales %') === C.lHeads.length - 1 && /Grand Total/.test(C.lh));
  ok('…verdict pills come from the published verdict (crit → red pill for CB2)', /pill r">0[.,]0%/.test(C.lh) && /pill g">14[.,]3%/.test(C.lh));
  ok('the Variance export sheet header is the on-screen header plus Code', C.sheets[0] && C.sheets[0][0] === 'Variance' && C.sheets[0][1].join('|') === ['Date', 'Agent', 'Code'].concat(C.vHeads.slice(2)).join('|') && C.sheets[0][2] === 4, JSON.stringify(C.sheets[0]));
  ok('the Lead management sheet carries every on-screen column and a Grand Total row', C.sheets[1] && C.sheets[1][0] === 'Lead management' && C.sheets[1][1].length === C.lHeads.length + 1 && C.sheets[1][2] === 4, JSON.stringify(C.sheets[1] && C.sheets[1][1]));
  ok('an unpublished report is a plain card that says so — and the session token is untouched', /not published this report yet/.test(C.lu) && C.tokenKept);
  ok('the campaign-manager Variance page paints ONE tab strip (cm_variance / cm_leads), the leader × campaign table and the agent rows', (C.cvh.match(/data-report="cm_variance"/g) || []).length === 1 && !/data-report="variance_team"/.test(C.cvh) && /Team leaders — reconciliation/.test(C.cvh) && /Leader A/.test(C.cvh) && /Campaign reconciliation/.test(C.cvh) && (C.cvh.match(/<tr>/g) || []).length >= 4, C.cvh.slice(0, 300));
  ok('…and the Lead management page likewise (one strip, the funnel per leader, the agent funnel)', (C.clh.match(/data-report="cm_leads"/g) || []).length === 1 && !/data-report="leads_team"/.test(C.clh) && /Team leaders — the funnel/.test(C.clh) && /Alpha One/.test(C.clh));
  ok('…the manager\'s export goes through the same builders (one sheet, named after the campaign)', C.cmSheetsAdded === 1 && /Courtesy/.test(String(C.cmWritten)), String(C.cmWritten));
  ok('…and a report with nothing under their campaign is a sentence naming the campaign, never a zero tile', /Nothing on the published report is filed under your campaign \(Courtesy\)/.test(C.cvNone) && !/Agents compared/.test(C.cvNone), C.cvNone.slice(0, 300));
  ok('no page errors on the agent app', aerr.length === 0, aerr.join(' | '));
} finally { await b.close(); server.close(); }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
