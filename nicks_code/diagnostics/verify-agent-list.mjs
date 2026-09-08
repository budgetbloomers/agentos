/**
 * THE AGENT LIST IS THE SOURCE OF TRUTH — does a fresh upload actually take?
 *
 * A new Matrix Agent List lands most days, and everything downstream keys off it: who is on
 * the roster, which floor they are on, who their team leader is. When an upload only PARTLY
 * takes, nothing on screen says so — the head count and the Cuddle/Courtesy split just quietly
 * disagree with the spreadsheet the floor is working from.
 *
 * Three ways it used to go wrong, one check each:
 *
 *   1. DOUBLED AGENT. The merge replaced the roster per CAMPAIGN. An agent who moved between
 *      two campaigns carried on different sheets (Nesting on the VAS tab → VT on the VT tab)
 *      kept their old row as well, because that row's campaign was not one the new sheet
 *      covered. CB340 was stored twice this way — counted on two floors at once.
 *
 *   2. THE LEGACY TAB WINNING. The workbook still carries a 'May' tab: a Que-column snapshot
 *      frozen at 83 rows, sorted BEFORE the live 'VAS' tab. Sheet order alone decided which
 *      won, and the only thing keeping VAS ahead was that it happened to carry Nesting agents
 *      the May tab did not. The day it has none, its campaigns are a subset of what May
 *      already covered, VAS is skipped as redundant, and the floor silently reverts to May.
 *
 *   3. A CAMPAIGN INVENTED FROM A BLANK CELL. campOf('') returns 'Courtesy', so a list whose
 *      campaign column is missing or renamed filed the ENTIRE floor as Courtesy without a word.
 *
 * Runs against the REAL uploaded workbooks in uploads/, not fixtures — the legacy tab, the
 * mid-month campaign moves and the header drift are all things the real files do and a
 * hand-written fixture would not.
 *
 *     node nicks_code/diagnostics/verify-agent-list.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const HTML = process.env.PULSE_HTML ? path.resolve(REPO, process.env.PULSE_HTML)
                                    : path.join(REPO, 'nicks_code', 'index.html');
const XLSX = require(path.join(REPO, 'site', 'xlsx.full.min.js'));

let pass = 0; const fails = [];
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ok   ' + name); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); } };
const section = (s) => console.log('\n— ' + s + ' —');

/* ---------- the real lists, oldest first ---------- */
const LISTS = [
  path.join(REPO, 'uploads', '2026-08-02', 'Agent List', 'Matrix - Agent List.xlsx'),
  path.join(REPO, 'uploads', '2026-08-06', 'Matrix - Agent List.xlsx'),
  path.join(REPO, 'uploads', '2026-08-13', 'Matrix - Agent List.xlsx'),
].filter(f => fs.existsSync(f));
if (LISTS.length < 2) {
  /* The cloud runner has no uploads/ (gitignored PII) — that is a SKIP, not a red run (2026-09-08). A
     laptop with uploads/ present but the lists missing is still a failure. */
  if (!fs.existsSync(path.join(REPO, 'uploads'))) { console.log('SKIP: this suite needs the real Agent List workbooks under uploads/, which only exist on a machine that receives the daily drop.'); process.exit(0); }
  console.error('Need at least two real Agent Lists under uploads/ — found ' + LISTS.length); process.exit(2);
}

/* ---------- what each workbook SAYS, read independently of the app ---------- */
const campOf = (c) => /nest/i.test(c || '') ? 'Nesting'
  : (/cuddle/i.test(c || '') ? 'Cuddle'
  : (/track|vehicle|vision|^vt$/i.test(c || '') ? 'VT' : 'Courtesy'));
const normCB = (v) => { const d = String(v ?? '').toUpperCase().replace(/[^0-9]/g, ''); return d ? 'CB' + parseInt(d, 10) : ''; };
const normH = (h) => String(h ?? '').trim().toLowerCase();

/** Every agent a workbook names, per sheet, with the campaign that sheet gives them. */
function readList(file) {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  const sheets = {};
  for (const sn of wb.SheetNames) {
    const rr = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, blankrows: false });
    const hi = rr.findIndex(r => (r || []).map(normH).includes('team leader'));
    if (hi < 0) continue;
    const hdr = (rr[hi] || []).map(normH);
    const col = (n) => hdr.indexOf(n);
    const ci = col('campaign') >= 0 ? col('campaign') : (col('que') >= 0 ? col('que') : col('queue'));
    const ei = col('employee code'), ni = col('agent name');
    if (ei < 0) continue;
    const m = new Map();
    for (const r of rr.slice(hi + 1)) {
      const cb = normCB((r || [])[ei]);
      if (!/^CB\d+$/.test(cb)) continue;
      const raw = String((r || [])[ci] ?? '').trim();
      m.set(cb, { code: cb, name: String((r || [])[ni] ?? '').trim(), raw, campaign: campOf(raw) });
    }
    sheets[sn] = { agents: m, legacy: col('campaign') < 0 };
  }
  return sheets;
}

/* ---------- serve and drive the real dashboard ---------- */
const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
const server = http.createServer((q, s) => {
  const p = SERVE[q.url.split('?')[0]];
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise(r => server.listen(8137, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:8137/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
/* A blank slate — this is about what the LISTS do, not what a stale blob carries. */
await page.evaluate(() => {
  try { localStorage.clear(); } catch (e) {}
  const S = window.__mtd.state();
  ['calls', 'callsMeta', 'sales', 'att', 'evals', 'tracker', 'cancRows', 'vici', 'viciDays', 'orgHist'].forEach(k => S[k] = {});
  S.files = []; S.roster = []; S.ui.asAt = '';
});

async function upload(file) {
  const before = await page.evaluate(() => window.__mtd.state().files.length);
  await page.setInputFiles('#fileInput', [file], { timeout: 120000 });
  let last = -1, stable = 0;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => window.__mtd.state().files.length);
    if (n === last) { if (++stable >= 4) break; } else { stable = 0; last = n; }
  }
  return before;
}
const roster = () => page.evaluate(() => (window.__mtd.state().roster || []).map(a => ({ code: a.code, name: a.name, campaign: a.campaign })));

/* ================= the run ================= */
for (const file of LISTS) {
  const label = path.basename(path.dirname(file)) + '/' + path.basename(file);
  section('upload ' + label);
  await upload(file);

  const sheets = readList(file);
  const live = await roster();
  const norm = live.map(a => ({ ...a, code: normCB(a.code) }));

  /* 1 — one row per agent, always */
  const seen = new Map();
  const dupes = [];
  for (const a of norm) { if (seen.has(a.code)) dupes.push(a.code + ' (' + seen.get(a.code).campaign + ' + ' + a.campaign + ')'); seen.set(a.code, a); }
  ok('every agent appears on the roster exactly once', dupes.length === 0, dupes.slice(0, 5).join(', '));

  /* 2 — the current-format sheets are what the roster reflects, legacy tabs never win */
  const current = Object.entries(sheets).filter(([, v]) => !v.legacy);
  const legacyOnly = Object.entries(sheets).filter(([, v]) => v.legacy);
  const expect = new Map();
  for (const [, v] of current) for (const [cb, a] of v.agents) expect.set(cb, a);

  let wrong = [], missing = [];
  for (const [cb, a] of expect) {
    /* Since 2026-09-03 EVERY campaign the list names lands on the roster — a new one under
       its own label (reported under the Courtesy rules until the rule book names it). */
    const l = seen.get(cb);
    if (!l) { missing.push(cb + ' ' + a.name); continue; }
    if (l.campaign !== a.campaign) wrong.push(`${cb} ${a.name}: roster=${l.campaign} list=${a.campaign}`);
  }
  ok('every agent the list names is on the roster', missing.length === 0, missing.slice(0, 5).join(', '));
  ok('every campaign matches the list, Cuddle and Courtesy included', wrong.length === 0, wrong.slice(0, 5).join(', '));

  /* 3 — nobody survives who is not on the current list (a leaver really leaves) */
  const strays = norm.filter(a => !expect.has(a.code));
  ok('nobody on the roster is absent from the list', strays.length === 0,
    strays.slice(0, 5).map(a => a.code + ' ' + a.name + ' (' + a.campaign + ')').join(', '));

  /* 4 — the legacy tab's exclusive rows never reach the roster */
  if (legacyOnly.length) {
    const leaked = [];
    for (const [sn, v] of legacyOnly)
      for (const [cb, a] of v.agents)
        if (!expect.has(cb) && seen.has(cb)) leaked.push(cb + ' ' + a.name + ' (only on ' + sn + ')');
    ok('the legacy tab never puts anyone on the roster', leaked.length === 0, leaked.slice(0, 5).join(', '));
  }

  const split = norm.reduce((t, a) => (t[a.campaign] = (t[a.campaign] || 0) + 1, t), {});
  console.log('       roster now: ' + norm.length + ' agents · ' + JSON.stringify(split));
}

/* ---------- the shape that used to file the whole floor as Courtesy ---------- */
section('a list with no campaign column');
{
  const src = readList(LISTS[LISTS.length - 1]);
  const sn = Object.keys(src).find(k => !src[k].legacy);
  const wb = XLSX.read(fs.readFileSync(LISTS[LISTS.length - 1]), { type: 'buffer' });
  const rr = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, blankrows: false });
  const hi = rr.findIndex(r => (r || []).map(normH).includes('team leader'));
  const ci = (rr[hi] || []).map(normH).indexOf('campaign');
  /* Same sheet, campaign column renamed to something nothing recognises. */
  const out = rr.slice(hi).map(r => (r || []).map((c, i) => (i === ci && r === rr[hi]) ? 'Floor' : c));
  const nb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(nb, XLSX.utils.aoa_to_sheet(out), 'VAS');
  const tmp = path.join(process.cwd(), 'simfix'); fs.mkdirSync(tmp, { recursive: true });
  const f = path.join(tmp, 'Matrix - Agent List NO CAMPAIGN.xlsx');
  /* site/xlsx.full.min.js is the browser build — it has no fs, so writeFile throws.
     Take the buffer and write it here. */
  fs.writeFileSync(f, Buffer.from(XLSX.write(nb, { type: 'array', bookType: 'xlsx' })));

  const before = await roster();
  await upload(f);
  const after = await roster();
  const beforeSplit = before.reduce((t, a) => (t[a.campaign] = (t[a.campaign] || 0) + 1, t), {});
  const afterSplit = after.reduce((t, a) => (t[a.campaign] = (t[a.campaign] || 0) + 1, t), {});
  ok('a list with no campaign column is refused, not filed as Courtesy',
    JSON.stringify(beforeSplit) === JSON.stringify(afterSplit),
    'before ' + JSON.stringify(beforeSplit) + ' after ' + JSON.stringify(afterSplit));
  fs.rmSync(f, { force: true });
}

/* ---------- the day nesting empties ----------
   Every real list so far carries Nesting agents on its VAS tab, and that is the ONLY reason
   the live tab currently beats the legacy 'May' one: Nesting is a campaign May does not cover,
   so VAS is not seen as redundant. Nesting empties regularly — the 06 Aug list was down to
   four. Build the list that has none and check the floor does not revert to May. */
section('a list whose live tab has no Nesting agents');
{
  const file = LISTS[LISTS.length - 1];
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  const nb = XLSX.utils.book_new();
  /* Same tabs, same order — May first, exactly as the real workbook ships. */
  for (const sn of wb.SheetNames) {
    const rr = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, blankrows: false });
    const hi = rr.findIndex(r => (r || []).map(normH).includes('team leader'));
    let out = rr;
    if (hi >= 0 && sn === 'VAS') {
      const ci = (rr[hi] || []).map(normH).indexOf('campaign');
      out = rr.filter((r, i) => i <= hi || !/nest/i.test(String((r || [])[ci] ?? '')));
    }
    XLSX.utils.book_append_sheet(nb, XLSX.utils.aoa_to_sheet(out), sn);
  }
  const tmp = path.join(process.cwd(), 'simfix'); fs.mkdirSync(tmp, { recursive: true });
  const f = path.join(tmp, 'Matrix - Agent List NO NESTING.xlsx');
  fs.writeFileSync(f, Buffer.from(XLSX.write(nb, { type: 'array', bookType: 'xlsx' })));

  await upload(f);
  const after = (await roster()).map(a => ({ ...a, code: normCB(a.code) }));

  /* What the live tabs say, minus the Nesting rows removed above. BOTH current-format tabs
     count: agents move between the floors and Vehicle Tracking, so an agent missing from VAS
     is very often simply on VT (CB112 and CB157 both moved that way in August). */
  const src = readList(file);
  const vas = new Map();
  for (const [sn, v] of Object.entries(src)) {
    if (v.legacy) continue;
    for (const [cb, a] of v.agents) if (!(sn === 'VAS' && a.campaign === 'Nesting')) vas.set(cb, a);
  }
  const may = src['May'] ? src['May'].agents : new Map();

  const seen = new Map(after.map(a => [a.code, a]));
  const wrong = [];
  for (const [cb, a] of vas) {
    const l = seen.get(cb);
    if (!l) { wrong.push(cb + ' ' + a.name + ' missing'); continue; }
    if (l.campaign !== a.campaign) wrong.push(`${cb} ${a.name}: roster=${l.campaign} list=${a.campaign}`);
  }
  ok('the live tab still wins when it has no Nesting agents', wrong.length === 0, wrong.slice(0, 5).join(', '));

  const leaked = [...may.keys()].filter(cb => !vas.has(cb) && seen.has(cb));
  ok('no May-only agent reaches the roster', leaked.length === 0,
    leaked.slice(0, 6).map(cb => cb + ' ' + may.get(cb).name).join(', '));
  console.log('       roster now: ' + after.length + ' agents · '
    + JSON.stringify(after.reduce((t, a) => (t[a.campaign] = (t[a.campaign] || 0) + 1, t), {})));
  fs.rmSync(f, { force: true });
}

/* ---------- a Campaign cell reading exactly "VT" (Nick, 2026-08-28) ----------
   campOf has always read "VT" as Vehicle Tracking; the ingest's off-campaign guard tested
   track|vehicle|vision and nothing else, so every VT-labelled row was pushed off its sheet
   and named in a toast claiming those agents were "NOT on the roster and their sales will
   show under Unmatched agents" — untrue, because the workbook's other sheet had already
   placed them, and unactionable, so it fired on every single upload. The exclusion behind
   it was real: with that sibling sheet absent, 46 people would have left the roster. */
section('a Campaign cell reading exactly "VT"');
{
  await page.evaluate(() => {
    const S = window.__mtd.state();
    S.roster = []; S.orgHist = {}; S.files = [];
    /* wrap toast() itself — the on-screen element is reused, so several messages fired in
       one tick overwrite each other and an observer sees only the last */
    window.__toasts = [];
    if (!window.__toastWrapped && typeof window.toast === 'function') {
      window.__toastWrapped = window.toast;
      window.toast = function (m) { try { window.__toasts.push(String(m)); } catch (e) {} return window.__toastWrapped.apply(this, arguments); };
    }
  });
  const csv = 'Employee Code,Agent Name,Team Leader,Campaign,Tenure,Sales Force,Target,Start Date\n'
    + 'CB901,VT One,Fabian Chetty,VT,Exp,VT One,3,2026-01-05\n'
    + 'CB902,VT Two,Fabian Chetty,VT,Exp,VT Two,3,2026-01-05\n'
    + 'CB903,Courtesy One,Denise Haripersad,Courtesy,Exp,Courtesy One,5,2026-01-05\n';
  await page.evaluate(t => window.__mtd.ingest('vt-list.csv', t, 'roster', 'vtcheck'), csv);
  const res = await page.evaluate(() => ({
    roster: (window.__mtd.state().roster || []).map(a => ({ code: a.code, campaign: a.campaign, tl: a.tl })),
    toasts: window.__toasts || [] }));
  const vt = res.roster.filter(a => a.campaign === 'VT').map(a => a.code);
  ok('a "VT" row lands on the roster as Vehicle Tracking, not off it',
    vt.includes('CB901') && vt.includes('CB902'), JSON.stringify(res.roster));
  ok('the Courtesy row on the same sheet is unaffected',
    res.roster.some(a => a.code === 'CB903' && a.campaign === 'Courtesy'), JSON.stringify(res.roster));
  ok('no "campaign this dashboard does not report on" warning is raised',
    !res.toasts.some(t => /does not report on/i.test(t)),
    res.toasts.filter(t => /does not report on/i.test(t)).join(' | '));
  /* A CAMPAIGN NEW TO THE RULE BOOK (Nick, 2026-09-03: "new campaigns are created"): it is
     no longer kept off the roster — it lands under its own label, is named in a toast as
     new, and is reported under the Courtesy rules until the rule book names it. */
  await page.evaluate(() => { window.__toasts = []; });
  await page.evaluate(t => window.__mtd.ingest('odd-list.csv', t, 'roster', 'oddcheck'),
    /* a real row alongside it: a sheet whose ONLY row is off-campaign loads nothing at all
       and is refused earlier, for a different reason, before this guard is reached */
    'Employee Code,Agent Name,Team Leader,Campaign,Tenure,Sales Force,Target,Start Date\n'
    + 'CB904,Admin Person,Fabian Chetty,Back Office,Exp,Admin Person,0,2026-01-05\n'
    + 'CB905,Courtesy Two,Denise Haripersad,Courtesy,Exp,Courtesy Two,5,2026-01-05\n');
  const odd = await page.evaluate(() => { const S = window.__mtd.state(); window.__mtd.rebuild();
    return { roster: (S.roster || []).map(a => ({ code: a.code, campaign: a.campaign })), toasts: window.__toasts || [],
      camps: (typeof CAMPS !== 'undefined') ? CAMPS.slice() : null, newCamps: (window.__mtd.model() || {}).newCampaigns || [],
      v23: (window.__mtd.checks() || []).find(c => c.id === 'V23') || null }; });
  ok('a campaign new to the rule book lands on the roster under its own label',
    odd.roster.some(a => a.code === 'CB904' && a.campaign === 'Back Office'), JSON.stringify(odd.roster));
  ok('…and is named as new in a toast, never silently',
    odd.toasts.some(t => /new to this dashboard/i.test(t) && /Back Office/.test(t)), JSON.stringify(odd.toasts));
  ok('…CAMPS now reports it alongside the rule book\'s campaigns',
    Array.isArray(odd.camps) && odd.camps.includes('Back Office') && odd.camps[0] === 'Cuddle', JSON.stringify(odd.camps));
  ok('…the model names it and V23 flags it as reported under the Courtesy rules',
    odd.newCamps.includes('Back Office') && odd.v23 && odd.v23.ok === false && /Courtesy rules/.test(odd.v23.msg), JSON.stringify(odd.v23));

  /* THE VT SHEET'S CAMPAIGN CELLS ARE QUEUES (2026-09-03). The workbook's VT tab labels
     its rows Scheduling / Matrix Digital / Panimax Referrals / Panimax Predictive; a row on
     a tab named VT is a VT row, never four new campaigns. Reproduced as a two-sheet text
     (splitSheets' "### Sheet: Name ###" convention) so the sheet name reaches the ingest. */
  await page.evaluate(() => { window.__toasts = []; const S = window.__mtd.state(); S.roster = []; S.orgHist = {}; S.files = []; });
  const two = '### Sheet: VAS ###\nEmployee Code,Agent Name,Team Leader,Campaign,Tenure,Sales Force,Target,Start Date\n'
    + 'CB906,Vas One,Denise Haripersad,Courtesy,Exp,Vas One,5,2026-01-05\n'
    + '### Sheet: VT ###\nEmployee Code,Agent Name,Team Leader,Campaign,Tenure,Sales Force,Target,Start Date\n'
    + 'CB907,Tracker One,Fabian Chetty,Matrix Digital,Exp,Tracker One,0,2026-01-05\n'
    + 'CB908,Tracker Two,Fabian Chetty,Panimax Predictive,Exp,Tracker Two,0,2026-01-05\n';
  await page.evaluate(t => window.__mtd.ingest('two-sheet-list.xlsx', t, 'roster', 'vtqueues'), two);
  const vq = await page.evaluate(() => ({ roster: (window.__mtd.state().roster || []).map(a => ({ code: a.code, campaign: a.campaign })), toasts: window.__toasts || [] }));
  ok('rows on the VT sheet fold to VT whatever their queue label says',
    vq.roster.some(a => a.code === 'CB907' && a.campaign === 'VT') && vq.roster.some(a => a.code === 'CB908' && a.campaign === 'VT'), JSON.stringify(vq.roster));
  ok('…and no "new campaign" is announced for a VT queue',
    !vq.toasts.some(t => /new to this dashboard/i.test(t) && /Digital|Predictive/.test(t)), JSON.stringify(vq.toasts));
  ok('…while the VAS row on the other sheet is untouched', vq.roster.some(a => a.code === 'CB906' && a.campaign === 'Courtesy'));
}

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(`\n==== ${pass} passed, ${fails.length} failed ====`);
if (fails.length) { console.log(fails.map(f => '  · ' + f).join('\n')); process.exit(1); }
