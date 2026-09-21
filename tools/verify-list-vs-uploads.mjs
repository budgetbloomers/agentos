#!/usr/bin/env node
/**
 * verify-list-vs-uploads.mjs — does every file in the Upload Station agree with the Agent List?
 *
 *   node tools/verify-list-vs-uploads.mjs                   # this month, live state + the published list
 *   node tools/verify-list-vs-uploads.mjs --month 2026-09   # a named month
 *   node tools/verify-list-vs-uploads.mjs --file "C:/…/Matrix - Agent List.xlsx"   # also prove the file IS the record
 *
 * 2026-09-21 (Nick): "compare the list to all the files from the upload center and make sure the
 * correct data is matching". Every source names an agent its own way — Power BI by Salesforce
 * Owner, ViciDial by CB number, HR by employee code, CallBi by code, the daily board by typed name,
 * Salesforce cases by "Owner - Queue" — and the Agent List is the one identity base they all join
 * on (non-negotiable 7). This runs the REAL engine (site/pulse/index.html, the build that ships)
 * over the LIVE state with the published list adopted exactly as a browser adopts it, then asks,
 * identity by identity and source by source: did it resolve, how (exact name / code / alias / near
 * spelling), or did it fall through — and if it fell through, is it a known leaver (off the report
 * by rule) or a stranger (money and calls counted for nobody). Then the other direction: which
 * agents on the list appear in NO file this month.
 *
 * Writes reports/list-vs-uploads-<month>.md (+ .csv of every unresolved identity). Exit 1 when a
 * stranger carries sales, or when --file disagrees with the record.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIAG = path.join(ROOT, 'nicks_code', 'diagnostics');
const req = createRequire(pathToFileURL(path.join(DIAG, 'x.js')).href);
const { chromium } = await import(pathToFileURL(path.join(DIAG, 'node_modules', 'playwright', 'index.mjs')).href);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const MONTH = arg('--month', new Date().toISOString().slice(0, 7));
const FILE = arg('--file', null);

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const get = async (u) => { const r = await fetch(env.SUPABASE_URL + u, { headers: H }); if (!r.ok) throw new Error(u + ' → ' + r.status); return r; };
const rpc = async (fn, body) => { const r = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(body) }); return r.ok ? r.json() : []; };

let fail = 0;
const line = (s) => console.log(s);

/* ---- the live state, the record, the archive's extras ---- */
const blob = await (await get('/storage/v1/object/raw/kv/vas-state')).text();
const rec = (await (await get('/rest/v1/rules?key=eq.' + encodeURIComponent('kv:roster-current') + '&select=value,updated_at')).json())[0];
const record = rec.value;
const aliases = await rpc('agent_list_aliases', { p_days: 180 });
const leavers = await rpc('agent_list_leavers', { p_days: 90 });
line('state ' + (blob.length / 1048576).toFixed(1) + ' MB · list "' + record.file + '" as of ' + record.as_of + ' (' + record.n + ' agents, published ' + String(record.uploaded_at).slice(0, 16) + ' by ' + record.uploaded_by + ') · aliases ' + aliases.length + ' · leavers ' + leavers.length);

/* ---- --file: the sheet Nick sent must be the record, row for row ---- */
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z]/g, '');
let fileNote = '';
if (FILE) {
  const XLSX = req('xlsx');
  const wb = XLSX.readFile(FILE);
  const byCode = new Map(record.roster.map((a) => [a.code, a]));
  const seen = new Set(); const diffs = [], extra = [];
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    /* the roster sheets are the ones the ingest reads: a Campaign/Que column AND a Sales Force column
       (the legacy May tab, the Reg List and Sheet1 are not the list — migration-039 / detectType) */
    if (!cols.some((c) => /^(campaign|que(ue)?)$/i.test(c.trim())) || !cols.some((c) => /^sales force$/i.test(c.trim())) || /^may$/i.test(sn)) continue;
    for (const r of rows) {
      const code = String(r['Employee Code'] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!/^CB\d+$/.test(code)) continue;
      const name = String(r['Sales Force'] || '').trim().replace(/^-$/, '') || String(r['Agent Name'] || '').trim();
      const a = byCode.get(code); seen.add(code);
      if (!a) { extra.push(code + ' ' + name + ' [' + sn + ']'); continue; }
      if (norm(name) !== norm(a.name)) diffs.push(code + ': file "' + name + '" · record "' + a.name + '"');
    }
  }
  const missing = record.roster.filter((a) => !seen.has(a.code)).map((a) => a.code + ' ' + a.name);
  fileNote = `File ${path.basename(FILE)}: ${seen.size} roster rows · ${diffs.length} name(s) differ from the record · ${extra.length} on the file but not the record · ${missing.length} on the record but not the file.`;
  line('\n' + fileNote);
  diffs.forEach((d) => line('   DIFF  ' + d)); extra.slice(0, 10).forEach((d) => line('   file-only  ' + d)); missing.slice(0, 10).forEach((d) => line('   record-only  ' + d));
  if (diffs.length || extra.length || missing.length) fail++;
}

/* ---- the engine, headless, on the shipped build ---- */
const HTML = path.join(ROOT, 'site', 'pulse', 'index.html');
if (!fs.existsSync(HTML)) { console.error('site/pulse/index.html missing — run node tools/prepare-site.js first'); process.exit(2); }
const server = http.createServer((q, s) => { if (!/^\/(index\.html)?(\?|$)/.test(q.url)) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(HTML).pipe(s); });
await new Promise((r) => server.listen(8213, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--js-flags=--max-old-space-size=8192'] });
let out;
try {
  const page = await b.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  await page.goto('http://127.0.0.1:8213/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  out = await page.evaluate(async ([x, record, aliases, leavers, MONTH]) => {
    const S = window.__mtd.state(); const o = JSON.parse(x); for (const k of Object.keys(o)) S[k] = o[k];
    normalizeState();
    window.toast = () => {};
    /* adopt the record the way adoptRosterFromRecord does: through INGEST.roster, then the extras */
    const rows = record.roster.map((a) => ({ 'Employee Code': a.code, 'Agent Name': a.name, 'Sales Force': a.sf || a.name, 'Team Leader': a.tl || '', 'Campaign': a.campaign || '', 'Tenure': a.tenure || '', 'Call x': a.callx || '', 'Target': a.target, 'Start Date': a.start || '' }));
    const q = (v) => { const t = String(v == null ? '' : v); return /[",]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const csv = [Object.keys(rows[0]).join(',')].concat(rows.map((r) => Object.values(r).map(q).join(','))).join(String.fromCharCode(10));
    await window.__mtd.ingest('Agent List — published as of ' + record.as_of, csv, 'roster', null);
    adoptLeavers(leavers.map((r) => ({ code: r.code, name: r.name, sf: r.sf, callx: r.callx, tl: r.tl, campaign: r.campaign, tenure: r.tenure, target: r.target, start: r.start_date, left: r.left_on })));
    adoptAliases(aliases.map((r) => ({ code: r.code, name: r.name, last_on: r.last_on })));
    S.ui.team = ''; S.ui.camp = ''; S.ui.asAt = ''; S.ui.dailyFilter = {};
    window.__mtd.setPeriod(MONTH, 'month');
    const M = window.__mtd.model();
    const from = MONTH + '-01', to = MONTH + '-31';
    const inM = (d) => d >= from && d <= to;
    /* HOW did this identity resolve? The same ladder as resolveKeyUncached, asked step by step. */
    const tlCodes = new Set(Object.keys(S.tlCbs || {}));
    const via = (key, src) => {
      const code = resolveKey(key);
      if (S.map[key] !== undefined) return { code, via: S.map[key] === '__ignore__' ? 'ignored (manual)' : 'manual map' };
      if (!code) {
        if ((IDX.ambig || {})[key]) return { code: null, via: 'ambiguous', fits: IDX.ambig[key] };
        const cb = /^CB\d+/i.test(key) ? cbCode(key) : null;
        const lv = leaverMatch(key); if (lv) return { code: null, via: 'leaver', fits: [lv.code + ' ' + lv.name + ' (left ' + String(lv.left).slice(5) + ')'] };
        if (cb && tlCodes.has(cb)) return { code: null, via: 'team leader (dialler login)' };
        /* Salesforce case owners from other floors / queues are the Lead Management POOL by design
           (specs/data-rake-README.md) — counted, never shipped as agents. Named, not alarmed. */
        if (/Salesforce/.test(src) && / - [A-Za-z0-9 ]+$|^(Cuddle Call|Courtesy call|VIP Dealer)/i.test(key)) return { code: null, via: 'other floor / queue (pool)' };   // only a queue-suffixed owner is the pool; a bare unknown name is a stranger
        return { code: null, via: 'stranger' };
      }
      if (/^CB\d+$/i.test(key)) return { code, via: 'employee code' };
      if (IDX.byCallx[normFull(key)]) return { code, via: 'dialler label' };
      if (IDX.byName[normName(key)]) return { code, via: 'exact name' };
      if (IDX.ruleLabel[normFull(key)]) return { code, via: 'spec label table' };
      if (IDX.byAlias[normName(key)]) return { code, via: 'alias (earlier list)' };
      if ((IDX.near || {})[key]) return { code, via: 'near spelling' };
      return { code, via: 'tokens / embedded code' };
    };
    const src = {};
    const add = (s, key, n, extra) => { const t = src[s] = src[s] || {}; const r = t[key] = t[key] || Object.assign({ n: 0, days: new Set() }, via(key, s)); r.n += n || 0; if (extra && extra.d) r.days.add(extra.d); if (extra && extra.gwp) r.gwp = (r.gwp || 0) + extra.gwp; };
    for (const d in S.sales) if (inM(d)) for (const k in S.sales[d]) add('Power BI sales (Owner)', k, S.sales[d][k].n || 0, { d, gwp: S.sales[d][k].gwp || 0 });
    for (const k in (S.cancRows || {})) { const r = S.cancRows[k]; if (r && inM(r.d)) add('BI Inactive cancellations (Owner)', r.owner, 1, { d: r.d }); }
    for (const d in S.calls) if (inM(d)) for (const k in S.calls[d]) add('ViciDial calls (user / label)', k, S.calls[d][k].talk || 0, { d });
    for (const d in S.att) if (inM(d)) for (const k in S.att[d]) add('HR attendance (employee code)', k, 1, { d });
    for (const d in S.evals) if (inM(d)) for (const k in S.evals[d]) add('CallBi QA (employee code)', k, (S.evals[d][k] || []).length, { d });
    for (const d in (S.board || {})) if (inM(d)) for (const k in S.board[d]) add('Manual Stats board (typed name)', S.board[d][k].name || k, S.board[d][k].sales || 0, { d });
    if (S.closedcases && S.closedcases.rows) for (const k in S.closedcases.rows) { const r = S.closedcases.rows[k]; if (r && inM(r.d)) add('Salesforce closed cases (Owner)', r.owner, 1, { d: r.d }); }
    if (S.opencasesLM && S.opencasesLM.rows) for (const k in S.opencasesLM.rows) { const r = S.opencasesLM.rows[k]; if (r && r.owner) add('Salesforce open cases — Lead Mgmt (Owner)', r.owner, 1, null); }
    const refBy = (S.refs && S.refs.by) || {};
    /* the other direction: every agent on the list, and where this month's files saw them */
    const agents = S.roster.map((a) => {
      const has = { sales: 0, calls: 0, att: 0, qa: 0, board: 0, refs: refBy[a.code] || 0 };
      for (const s in src) for (const k in src[s]) { const r = src[s][k]; if (r.code !== a.code) continue;
        if (/Power BI/.test(s)) has.sales += r.n; else if (/ViciDial/.test(s)) has.calls += r.days.size; else if (/attendance/.test(s)) has.att += r.days.size; else if (/QA/.test(s)) has.qa += r.n; else if (/board/.test(s)) has.board += r.days.size; }
      return { code: a.code, name: a.name, tl: a.tl, campaign: a.campaign, start: a.start, has };
    });
    const ser = {}; for (const s in src) { ser[s] = {}; for (const k in src[s]) ser[s][k] = Object.assign({}, src[s][k], { days: src[s][k].days.size }); }
    const un = unattributedSales();
    return { src: ser, agents, roster: S.roster.length, aliasCount: Object.keys(S.aliases || {}).length, near: M.near || {}, ambig: M.ambig || {}, unN: un.n, unGwp: un.gwp, ln: un.ln, checks: (window.__mtd.checks() || []).filter((c) => /^V(14|24)/.test(c.id)) };
  }, [blob, record, aliases, leavers, MONTH]);
  if (errs.length) { line('PAGE ERRORS: ' + errs.join(' | ')); fail++; }
} finally { await b.close(); server.close(); }

/* ---- the report ---- */
const md = [];
md.push(`# Agent List vs Upload Station — ${MONTH}`, '', `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · list "${record.file}" as of ${record.as_of} (${record.n} agents, published ${String(record.uploaded_at).slice(0, 16)} by ${record.uploaded_by}) · engine: site/pulse (shipped build) · roster on screen ${out.roster} · aliases known ${out.aliasCount}`, '');
if (fileNote) md.push(fileNote, '');
md.push('## Every identity in every file, and how it joined the list', '', '| Source | identities | exact / code | alias | near spelling | manual | ambiguous | leaver (off by rule) | leader / pool (expected) | STRANGER |', '|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
const csv = [['source', 'identity', 'outcome', 'fits', 'volume', 'days', 'gwp']];
const strangers = [];
for (const s of Object.keys(out.src).sort()) {
  const rows = Object.entries(out.src[s]);
  const c = (re) => rows.filter(([, r]) => re.test(r.via)).length;
  md.push(`| ${s} | ${rows.length} | ${c(/exact name|employee code|dialler label|spec label|tokens/)} | ${c(/alias/)} | ${c(/near/)} | ${c(/manual|ignored/)} | ${c(/ambiguous/)} | ${c(/^leaver/)} | ${c(/team leader|pool/)} | **${c(/^stranger/)}** |`);
  for (const [k, r] of rows) if (!/exact name|employee code|dialler label|spec label|tokens|manual/.test(r.via)) {
    csv.push([s, k, r.via, (r.fits || []).join('/'), r.n, r.days, r.gwp || '']);
    if (r.via === 'stranger' || r.via === 'ambiguous') strangers.push({ s, k, r });
  }
}
md.push('', 'Volume column meaning per source: sales = cases, calls = talk seconds, attendance/QA/board/cases = rows.', '');
md.push('## Identities the list cannot place (strangers and ties) — a person must answer these', '');
if (!strangers.length) md.push('None — every identity in every file resolves to an agent on the list, a known leaver, or a manual decision.');
else { md.push('| Source | Identity in file | Outcome | Volume | Days | Note |', '|---|---|---|--:|--:|---|');
  for (const { s, k, r } of strangers.sort((a, b) => (b.r.gwp || b.r.n) - (a.r.gwp || a.r.n)))
    md.push(`| ${s} | \`${k}\` | ${r.via}${r.fits ? ' (fits ' + r.fits.join(' and ') + ')' : ''} | ${r.n}${r.gwp ? ' · R' + Math.round(r.gwp) : ''} | ${r.days} | ${/Power BI/.test(s) && r.n ? '**sales counted for nobody**' : ''} |`); }
md.push('', '## Resolved by near spelling or an earlier list\'s spelling — check once, then it sticks', '');
const soft = []; for (const s of Object.keys(out.src)) for (const [k, r] of Object.entries(out.src[s])) if (/alias|near/.test(r.via)) soft.push({ s, k, r });
if (!soft.length) md.push('None this month.'); else { md.push('| Source | Identity in file | Counted as | How |', '|---|---|---|---|'); for (const { s, k, r } of soft) md.push(`| ${s} | \`${k}\` | ${r.code} | ${r.via} |`); }
md.push('', '## Agents on the list with no trace in this month\'s files', '');
const ghosts = out.agents.filter((a) => !a.has.sales && !a.has.calls && !a.has.att && !a.has.qa && !a.has.board && !a.has.refs);
if (!ghosts.length) md.push('None — every listed agent appears in at least one file this month.');
else { md.push('| Code | Agent | Team leader | Campaign | Start |', '|---|---|---|---|---|'); for (const a of ghosts) md.push(`| ${a.code} | ${a.name} | ${a.tl} | ${a.campaign} | ${a.start || ''} |`); }
md.push('', '## Agents on the list with NO sales this month (but seen elsewhere)', '');
const noSales = out.agents.filter((a) => !a.has.sales && (a.has.calls || a.has.att || a.has.qa || a.has.board) && a.campaign !== 'VT');
md.push(noSales.length ? '| Code | Agent | Team leader | Campaign | call days | HR days | QA evals | board days |\n|---|---|---|---|--:|--:|--:|--:|' : 'None.');
for (const a of noSales) md.push(`| ${a.code} | ${a.name} | ${a.tl} | ${a.campaign} | ${a.has.calls} | ${a.has.att} | ${a.has.qa} | ${a.has.board} |`);
md.push('', '## Engine checks', '', ...out.checks.map((c) => `- ${c.id} ${c.ok ? 'pass' : 'FAIL'} — ${c.msg}`), '', `Unattributed sales in the period (strangers): **${out.unN}** (R${Math.round(out.unGwp)}) · by known leavers (off the report by rule): ${out.ln}`);

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
const mdPath = path.join(ROOT, 'reports', 'list-vs-uploads-' + MONTH + '.md');
const csvPath = path.join(ROOT, 'reports', 'list-vs-uploads-' + MONTH + '.csv');
fs.writeFileSync(mdPath, md.join('\n') + '\n');
fs.writeFileSync(csvPath, csv.map((r) => r.map((v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(',')).join('\n') + '\n');

line('\n' + md.slice(6).join('\n'));
line('\nwritten ' + path.relative(ROOT, mdPath) + ' and ' + path.relative(ROOT, csvPath));
if (out.unN > 0) { fail++; line('\nFAIL: ' + out.unN + ' sales in ' + MONTH + ' are attributed to nobody — see the strangers table.'); }
process.exit(fail ? 1 : 0);
