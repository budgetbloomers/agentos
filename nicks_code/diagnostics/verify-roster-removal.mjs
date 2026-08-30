/* REMOVE A TEAM FROM THE AGENT LIST AND THEY LEAVE THE DASHBOARD.
 *
 * Nick, 2026-08-28: "if I remove Renolan and his entire team, and upload it to VAS, when
 * it's ingested would Renolan and his agents show on month to date and other tabs, or
 * would they not be there?"
 *
 * They were still there. A sheet replaces only the campaigns it COVERS — which is right,
 * because the VAS and VT tabs are separate sheets of one workbook and neither may delete
 * the other's people. But removing a whole team can empty a campaign completely, and then
 * nothing covers it: on the live roster, dropping Renolan Pillay's 20 agents removed his
 * 10 Cuddle people and KEPT his 10 Nesting ones, so he went on showing as a Nesting team
 * leader with a team on Month to Date.
 *
 * The workbook is now the whole truth: once every sheet has been read, anyone the FILE
 * never names has left. The trap that guards is in here too — "named by the file" is not
 * "accepted by this sheet", and recording only the accepted rows deleted all 46 Vehicle
 * Tracking agents on the first run of this test.
 *
 * Run: node verify-roster-removal.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const AGENTOS = 'C:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos';
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
const HTML = path.join(AGENTOS, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };

let blob = null;
try {
  const envTxt = fs.readFileSync(path.join(AGENTOS, 'supabase.env'), 'utf8');
  const env = Object.fromEntries(envTxt.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const r = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/vas-state',
    { headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY }, signal: AbortSignal.timeout(90000) });
  if (r.ok) blob = await r.text();
} catch (e) { /* offline */ }
if (!blob) { console.log('(skipping — cannot read live state)'); process.exit(0); }

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
await new Promise(r => srv.listen(8247, '127.0.0.1', r));
const b = await chromium.launch();
const page = await b.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 130)));
await page.goto('http://127.0.0.1:8247/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
await page.evaluate(x => { const S = window.__mtd.state(); const o = JSON.parse(x);
  for (const k of Object.keys(o)) S[k] = o[k]; window.__mtd.rebuild(); }, blob);

const out = await page.evaluate(async () => {
  const S = window.__mtd.state();
  /* the leader with the most agents spread across more than one campaign — the shape that
     exposes the bug, chosen from the live roster rather than hard-coded to a name */
  const byTl = {};
  (S.roster || []).forEach(a => { const t = String(a.tl || '').trim(); if (!t) return;
    (byTl[t] = byTl[t] || { n: 0, camps: new Set() }); byTl[t].n++; byTl[t].camps.add(a.campaign); });
  const TL = Object.entries(byTl).sort((x, y) => (y[1].camps.size - x[1].camps.size) || (y[1].n - x[1].n))[0][0];
  const team = (S.roster || []).filter(a => String(a.tl || '').trim() === TL);
  const codes = new Set(team.map(a => a.code));
  const M = window.__mtd.model();
  const snap = (m) => ({
    roster: (S.roster || []).length,
    theirs: (S.roster || []).filter(a => codes.has(a.code)).length,
    onMtd: (m.agents || []).filter(a => codes.has(a.code)).length,
    tlPresent: [...new Set((m.agents || []).map(a => a.tl))].includes(TL),
    tlRows: Object.keys(m.tlAgg || {}).filter(k => k.endsWith('|' + TL)).length,
    facts: (m.facts || []).filter(f => codes.has(f.code)).length,
    theirSales: (m.facts || []).filter(f => codes.has(f.code)).reduce((n, f) => n + (f.sales || 0), 0),
    grandSales: m.grand && m.grand.sales,
  });
  const before = snap(M);
  const vtBefore = (S.roster || []).filter(a => /^vt$/i.test(String(a.campaign || ''))).length;

  /* upload the list without them, exactly as a file — the path a real upload takes */
  const keep = (S.roster || []).filter(a => String(a.tl || '').trim() !== TL);
  const head = ['Employee Code', 'Agent Name', 'Sales Force', 'Team Leader', 'Campaign', 'Tenure', 'Call x', 'Target', 'Start Date'];
  const q = (v) => { const t = String(v == null ? '' : v); return /[",]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const csv = [head.join(',')].concat(keep.map(a => [a.code, a.name, a.sf || a.name, a.tl || '', a.campaign || '',
    a.tenure || '', a.callx || '', a.target, a.start || ''].map(q).join(','))).join(String.fromCharCode(10));
  await window.__mtd.ingest('Matrix - Agent List.csv', csv, 'roster', 'removal-test');
  window.__mtd.rebuild();
  const after = snap(window.__mtd.model());
  const vtAfter = (S.roster || []).filter(a => /^vt$/i.test(String(a.campaign || ''))).length;

  /* and a degenerate file must never empty the floor */
  const held = (S.roster || []).length;
  await window.__mtd.ingest('empty.csv', head.join(',') + String.fromCharCode(10), 'roster', 'empty-test');
  const afterEmpty = (S.roster || []).length;

  return { TL, teamSize: team.length, campaigns: [...byTl[TL].camps], before, after,
    vtBefore, vtAfter, held, afterEmpty };
});

console.log('  removing ' + out.TL + ' and all ' + out.teamSize + ' of their agents (' + out.campaigns.join(' + ') + ')\n');
ok('the leader spans more than one campaign — the shape that hid the bug', out.campaigns.length > 1, out.campaigns.join(','));
ok('every one of their agents leaves the roster', out.after.theirs === 0,
  out.after.theirs + ' still on the roster');
ok('the roster shrinks by exactly the team size (' + out.before.roster + ' → ' + out.after.roster + ')',
  out.before.roster - out.after.roster === out.teamSize,
  'expected -' + out.teamSize + ', got -' + (out.before.roster - out.after.roster));
ok('none of them appear on Month to Date', out.after.onMtd === 0, String(out.after.onMtd));
ok('the team leader is gone from the model', out.after.tlPresent === false);
ok('...and has no team-leader rows left', out.after.tlRows === 0, String(out.after.tlRows));
ok('they produce no fact rows at all', out.after.facts === 0, String(out.after.facts));
/* THE TRAP: agents the file NAMES but this sheet does not accept must survive */
ok('Vehicle Tracking agents named in the file are NOT deleted (' + out.vtBefore + ' → ' + out.vtAfter + ')',
  out.vtAfter === out.vtBefore, 'lost ' + (out.vtBefore - out.vtAfter) + ' VT agents');
ok('an empty list never empties the roster', out.afterEmpty === out.held,
  out.held + ' → ' + out.afterEmpty);
/* stated, not asserted as desirable: their production leaves the reported month with them */
console.log('\n  their ' + out.before.theirSales + ' sales also leave the month total: '
  + out.before.grandSales + ' → ' + out.after.grandSales);
/* ---- REMOVAL MUST NOT DESTROY THE PAST, and repeats must not churn ----------------- */
const edges = await page.evaluate(async () => {
  const S = window.__mtd.state();
  const head = ['Employee Code', 'Agent Name', 'Sales Force', 'Team Leader', 'Campaign', 'Tenure', 'Call x', 'Target', 'Start Date'];
  const q = (v) => { const t = String(v == null ? '' : v); return /[",]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const csv = (rows) => [head.join(',')].concat(rows.map(a => [a.code, a.name, a.sf || a.name, a.tl || '',
    a.campaign || '', a.tenure || '', a.callx || '', a.target, a.start || ''].map(q).join(','))).join(String.fromCharCode(10));
  const R = () => S.roster || [];
  const day = (window.__mtd.model().range || {}).from || '2026-08-05';

  /* An agent on a campaign THIS SHEET FORMAT REPORTS. A Vehicle Tracking agent is named by
     the workbook but only accepted on its own VT tab, so removing one with a VAS-format
     sheet and re-adding it with the same sheet cannot restore them — correct behaviour, and
     the wrong subject for a round-trip test. */
  const victim = R().find(a => a.tl && /cuddle|courtesy|nest/i.test(String(a.campaign || '')));
  const orgWas = (window.__mtd.orgAt(victim.code, day) || {}).tl;
  await window.__mtd.ingest('a.csv', csv(R().filter(a => a.code !== victim.code)), 'roster', 'e1');
  const gone = !R().some(a => a.code === victim.code);
  const orgAfter = (window.__mtd.orgAt(victim.code, day) || {}).tl;
  const histAfter = (window.__mtd.orgHist()[victim.code] || []).length;

  /* put them back, then upload the identical list twice */
  await window.__mtd.ingest('b.csv', csv(R().concat([victim])), 'roster', 'e2');
  const back = R().some(a => a.code === victim.code);
  const n1 = R().length;
  await window.__mtd.ingest('c.csv', csv(R()), 'roster', 'e3');
  const n2 = R().length;
  await window.__mtd.ingest('c.csv', csv(R()), 'roster', 'e3');
  const n3 = R().length;

  /* one file naming the same agent twice must not put them on the floor twice */
  await window.__mtd.ingest('d.csv', csv(R().concat([{ ...R()[0] }])), 'roster', 'e4');
  const codes = R().map(a => a.code);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);

  /* a blank team leader is an absence, not an instruction to forget who they report to */
  const t = R().find(a => a.tl); const tlWas = t.tl;
  await window.__mtd.ingest('e.csv', csv(R().map(a => a.code === t.code ? { ...a, tl: '' } : a)), 'roster', 'e5');
  const tlNow = (R().find(a => a.code === t.code) || {}).tl;
  return { orgWas, gone, orgAfter, histAfter, back, n1, n2, n3, dupes, tlWas, tlNow, victim: victim.code };
});
ok('a departed agent leaves the roster', edges.gone);
ok('...but their history still resolves, so past months keep their leader',
  edges.orgAfter === edges.orgWas && edges.histAfter > 0,
  'was ' + edges.orgWas + ', now ' + edges.orgAfter + ' (' + edges.histAfter + ' segments)');
ok('re-adding them puts them back', edges.back, 'victim ' + edges.victim);
ok('uploading the identical list twice changes nothing (' + edges.n1 + '→' + edges.n2 + '→' + edges.n3 + ')',
  edges.n1 === edges.n2 && edges.n2 === edges.n3);
ok('one file naming an agent twice does not double them', edges.dupes.length === 0, edges.dupes.join(','));
ok('a blank team leader never erases a real one', edges.tlNow === edges.tlWas,
  edges.tlWas + ' → ' + edges.tlNow);

ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
