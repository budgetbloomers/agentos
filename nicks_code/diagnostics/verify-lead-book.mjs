/* THE LEAD MANAGEMENT BOOK FOLLOWS THE LAKE (2026-09-10; migration-035, /api/lead-book, syncLeadBookFromLake).
 *
 * Why this exists: the Salesforce Open Cases export grew past 30 MB on 8 Sep, so the Upload Station
 * routed it to the Rake — and PULSE's Lead Management tab, which only ever read the in-page book, sat
 * on the 6 Sep pull for four days while the lake moved every morning. Two halves:
 *   · DATABASE — inside one transaction that always rolls back: a fixture snapshot is staged in
 *     sf_open_cases, lm_open_book_refresh() builds the cache from it (agent rows shipped, queue rows
 *     only counted, the batch's file named), a second refresh is a no-op, and the two readers return it.
 *   · PAGE — headless PULSE with the fixture Agent List: the Worker is stubbed, syncLeadBookFromLake()
 *     adopts the lake book, the registry carries it, Lead Management renders from it, a repeat poll
 *     changes nothing, and a hand-dropped file newer than the lake is kept.
 *
 * Run: node verify-lead-book.mjs      (PULSE_HTML=site/pulse/index.html for the build copy)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.AGENTOS || path.resolve(HERE, '..', '..');
const HTML = path.join(REPO, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
const ROSTER = path.join(REPO, 'uploads', '2026-08-13', 'Matrix - Agent List.xlsx');
const req = createRequire(path.join(HERE, 'node_modules', 'x.js'));
const pg = req('pg');

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + ' — ' + d); } };

/* ------------------------------------------------------------------ database half */
const envFile = path.join(REPO, 'supabase.env');
if (!fs.existsSync(envFile)) { console.log('(skipping the database half — no supabase.env)'); }
else {
  const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
  const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 }); await c.connect();
  const q = async (s, a) => (await c.query(s, a)).rows;
  try {
    await c.query('begin');
    const SNAP = '2099-01-01', BATCH = 'verify:lead-book';
    await q(`insert into batches (batch_id, source_type, source_system, uploaded_by, uploaded_at, file_name, raw_rows, status) values ($1, 'SF_OPEN_CASES', 'verify', 'verify', now(), 'Verify open cases.csv', 5, 'loaded') on conflict (batch_id) do nothing`, [BATCH]);
    await q(`insert into sf_open_cases (snapshot_date, case_number, case_owner, owner_kind, status, opened_at, batch_id) values
      ($1, '90000001', 'Test Agent - EC3', 'agent', '1st attempt', '2026-09-01 08:00+02', $2),
      ($1, '90000002', 'Test Agent - EC3', 'agent', 'In Progress', '2026-09-02 08:00+02', $2),
      ($1, '90000003', 'Other Agent - EC3', 'agent', 'New', '2026-09-03 08:00+02', $2),
      ($1, '90000004', 'Courtesy Call', 'queue', 'New', '2026-09-03 08:00+02', $2),
      ($1, '90000005', 'Cuddle Call', 'queue', 'New', '2026-09-03 08:00+02', $2)`, [SNAP, BATCH]);
    const r1 = (await q('select lm_open_book_refresh() r'))[0].r;
    ok('refresh builds the cache from the newest snapshot', r1 && r1.unchanged === false && r1.snapshot_date === SNAP, JSON.stringify(r1));
    ok('…counting 3 agent-held and 2 queue-held cases', r1 && +r1.agent_rows === 3 && +r1.queue_rows === 2 && +r1.total === 5, JSON.stringify(r1));
    ok('…and naming the file of the batch that last touched the snapshot', r1 && r1.file === 'Verify open cases.csv', String(r1 && r1.file));
    const r2 = (await q('select lm_open_book_refresh() r'))[0].r;
    ok('a second refresh with nothing new is a no-op (unchanged:true)', r2 && r2.unchanged === true && r2.snapshot_date === SNAP, JSON.stringify(r2));
    const meta = (await q('select lm_open_book_meta() m'))[0].m;
    ok('lm_open_book_meta carries the freshness fields and no rows', meta && meta.snapshot_date === SNAP && meta.loaded_at && +meta.agent_rows === 3 && !('rows' in meta), JSON.stringify(meta));
    const book = (await q('select lm_open_book() b'))[0].b;
    ok('lm_open_book ships exactly the agent-owned rows', book && Array.isArray(book.rows) && book.rows.length === 3, JSON.stringify(book && book.rows && book.rows.length));
    ok('…as {k,o,s,d} with the owner string intact', book && book.rows.every((r) => r.k && r.o && 's' in r && 'd' in r) && book.rows.some((r) => r.o === 'Test Agent - EC3'), JSON.stringify((book.rows || [])[0]));
    ok('…and no queue owner among them', book && !book.rows.some((r) => /courtesy call|cuddle call/i.test(r.o)));
    ok('the book repeats the meta (loaded_at, queue_rows) beside the rows', book && book.loaded_at === meta.loaded_at && +book.queue_rows === 2);
  } finally { await c.query('rollback').catch(() => {}); await c.end(); }
  const live = await (async () => { const c2 = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await c2.connect();
    try { return (await c2.query('select lm_open_book_meta() m')).rows[0].m; } finally { await c2.end(); } })();
  ok('the fixture never reached the live cache (rolled back)', !live || live.snapshot_date !== '2099-01-01', JSON.stringify(live));
  /* A QUEUE BY ANY OTHER NAME (migration-038, 2026-09-15). Salesforce moved the unallocated pool
     into "Courtesy call- Panimax"; the exact-name rule called 404,014 of them agent-held, the book
     grew to 46 MB and the reader timed out — the tab kept the old book and said nothing. Two guards:
     the rule reads the shape, and the LIVE book stays a size the route can serve. */
  const kinds = await (async () => { const c3 = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await c3.connect();
    try { return (await c3.query(`select rake_owner_kind('Courtesy call- Panimax') a, rake_owner_kind('CUDDLE CALL - overflow') b, rake_owner_kind('Courtesy Call') c, rake_owner_kind('Ann Smith - EC3') d, rake_owner_kind('') e`)).rows[0]; } finally { await c3.end(); } })();
  ok('a suffixed pseudo-queue ("Courtesy call- Panimax") is a queue, not an agent', kinds.a === 'queue' && kinds.b === 'queue' && kinds.c === 'queue', JSON.stringify(kinds));
  ok('a person ("Name Surname - Team") is still an agent, and blank is null', kinds.d === 'agent' && kinds.e === null, JSON.stringify(kinds));
  const LIVE_CEILING = 200000;
  ok('the live book is a size the route can serve (agent-held rows under ' + LIVE_CEILING.toLocaleString() + ')',
    !live || live.empty || +live.agent_rows < LIVE_CEILING, live && (live.agent_rows + ' agent-held rows — an owner is being misclassified; check the top case_owner values of the newest snapshot'));
  ok('…and the queue pool is the larger side, as the export has always been shaped', !live || live.empty || +live.queue_rows > +live.agent_rows, live && ('agent ' + live.agent_rows + ' vs queue ' + live.queue_rows));
}

/* ------------------------------------------------------------------ page half */
if (!fs.existsSync(ROSTER)) { console.log('(skipping the page half — needs the Agent List fixture at ' + ROSTER + ')'); }
else {
  const SERVE = { '/': HTML, '/index.html': HTML, '/xlsx.full.min.js': path.join(REPO, 'site', 'xlsx.full.min.js') };
  const server = http.createServer((rq, s) => {
    const p = SERVE[rq.url.split('?')[0]];
    if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end('nf'); return; }
    s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
    fs.createReadStream(p).pipe(s);
  });
  await new Promise((r) => server.listen(8153, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--js-flags=--max-old-space-size=4096'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  /* the Worker is stubbed: only /api/lead-book answers; every other call (save, roster, manifest) is refused */
  let polls = 0, fetches = 0; let LAKE = null;
  await page.route('**/chatterbox-agentos-api.chatterbox-agentos.workers.dev/**', (route) => {
    const u = route.request().url();
    if (u.includes('/api/lead-book')) {
      if (!LAKE) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ empty: true }) });
      if (u.includes('meta=1')) { polls++; const { rows, ...meta } = LAKE; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta) }); }
      fetches++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LAKE) });
    }
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"stub"}' });
  });
  await page.goto('http://127.0.0.1:8153/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 30000 });
  await page.setInputFiles('#fileInput', [ROSTER], { timeout: 120000 });
  await page.waitForFunction(() => (window.__mtd.state().roster || []).length > 0, null, { timeout: 120000 });
  const agents = await page.evaluate(() => window.__mtd.state().roster.filter((a) => a.campaign !== 'VT').slice(0, 2).map((a) => ({ sf: a.sf || a.name, code: a.code })));
  ok('the fixture Agent List loaded (two non-VT agents to own cases)', agents.length === 2, JSON.stringify(agents));

  const LOADED = '2026-09-10T06:11:25.000Z';
  LAKE = { snapshot_date: '2026-09-10', loaded_at: LOADED, file: 'SF Open current.csv', total: 6, agent_rows: 4, queue_rows: 2, batch: 'rake:x',
    rows: [ { k: '80000001', o: agents[0].sf, s: '1st attempt', d: '2026-09-01T06:00:00+00:00' },
            { k: '80000002', o: agents[0].sf, s: 'In Progress', d: '2026-09-02T06:00:00+00:00' },
            { k: '80000002', o: agents[0].sf, s: 'In Progress', d: '2026-09-02T06:00:00+00:00' },   // a repeated case: one row per Case Number
            { k: '80000003', o: agents[1].sf, s: 'New', d: '2026-09-03T06:00:00+00:00' },
            { k: '80000004', o: 'Nobody Here - EC3', s: 'New', d: '1990-01-01T06:00:00+00:00' } ] };
  await page.evaluate(() => { window.__vasHydrated = true; sessionStorage.setItem('cbx_token', 'verify'); });
  await page.evaluate(() => window.__mtd.syncLeadBook());
  const after = await page.evaluate(() => { const S = window.__mtd.state(); const oc = S.opencasesLM;
    return { lake: !!(oc && oc.lake), rows: oc ? oc.rows.length : null, f: oc && oc.f, lakeAt: oc && oc.lakeAt, queues: oc && oc.queues,
      ages: oc ? oc.rows.map((r) => r.age) : [], reg: (S.files || []).filter((f) => f.type === 'open cases (lead mgmt)').map((f) => ({ name: f.name, lake: f.lake, rows: f.rows, cases: f.cases })) }; });
  ok('the page adopts the lake book (S.opencasesLM.lake, stamped with the lake load)', after.lake && after.lakeAt === LOADED, JSON.stringify(after).slice(0, 200));
  ok('one row per Case Number — the repeated case collapsed (5 rows → 4)', after.rows === 4, 'rows=' + after.rows);
  ok('the book is named after the upload that fed the lake', after.f === 'SF Open current.csv', String(after.f));
  ok('the queue count rides along', after.queues === 2, String(after.queues));
  ok('an implausible open date reads as unknown age, never a number', after.ages.filter((a) => a == null).length === 1 && after.ages.filter((a) => a != null).length === 3, JSON.stringify(after.ages));
  ok('the Upload Station registry carries the lake file under the Lead Management type', after.reg.some((r) => r.name === 'SF Open current.csv' && r.lake === true && r.rows === 6 && r.cases === 4), JSON.stringify(after.reg));
  ok('it polled meta once and fetched the book once', polls === 1 && fetches === 1, `polls=${polls} fetches=${fetches}`);

  await page.evaluate(() => window.__mtd.syncLeadBook());
  ok('a repeat poll on the same lake load fetches nothing and changes nothing', polls === 2 && fetches === 1, `polls=${polls} fetches=${fetches}`);

  await page.evaluate(() => { const S = window.__mtd.state(); S.ui.camp = ''; S.ui.team = ''; go('leads'); });
  await page.waitForTimeout(1400);
  const leads = await page.evaluate(() => { const txt = document.body.innerText || '';
    const tbl = document.querySelectorAll('#view table.data')[0];
    const rows = tbl ? [...tbl.querySelectorAll('tbody tr')] : []; const sub = rows.length ? rows[rows.length - 1] : null;   // ALL AGENTS is the last row
    const cells = sub ? [...sub.querySelectorAll('td')].map((td) => td.textContent.trim()) : [];
    const heads = tbl ? [...tbl.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [];
    const open = cells[heads.indexOf('Total open')];
    const m = /(\d+) open and (\d+) closed case\(s\) carry an owner that matches nobody/.exec(txt);
    return { hasTable: !!sub && /ALL AGENTS/.test(sub.textContent), open, unmatched: m ? +m[1] : null }; });
  ok('Lead Management renders from the lake book with an ALL AGENTS row', leads.hasTable, JSON.stringify(leads));
  ok('ALL AGENTS Total open counts the 3 cases held by roster agents', leads.open === '3', 'open=' + leads.open);
  ok('the unmatched note counts the 2 queue-held cases the lake kept back plus the unknown owner', leads.unmatched === 3, JSON.stringify(leads));

  /* a file dropped in the page AFTER the lake load is the newer book: the poll must keep it */
  await page.evaluate(() => { const S = window.__mtd.state(); const d = new Date(Date.now() + 3600000); const p2 = (n) => String(n).padStart(2, '0');
    S.opencasesLM = { rows: [{ k: '1', owner: 'x', status: 'New', opened: '', age: null }], f: 'hand.xls', total: 1,
      at: d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) }; });
  await page.evaluate(() => window.__mtd.syncLeadBook());
  const kept = await page.evaluate(() => { const oc = window.__mtd.state().opencasesLM; return { f: oc.f, lake: !!oc.lake }; });
  ok('a hand-dropped file newer than the lake load is kept', kept.f === 'hand.xls' && !kept.lake && fetches === 1, JSON.stringify(kept) + ` fetches=${fetches}`);

  /* …and an older one gives way */
  await page.evaluate(() => { const oc = window.__mtd.state().opencasesLM; oc.at = '2026-09-01 08:00'; });
  await page.evaluate(() => window.__mtd.syncLeadBook());
  const gave = await page.evaluate(() => { const oc = window.__mtd.state().opencasesLM; return { f: oc.f, lake: !!oc.lake }; });
  ok('a hand-dropped file older than the lake load gives way to the lake', gave.f === 'SF Open current.csv' && gave.lake && fetches === 2, JSON.stringify(gave) + ` fetches=${fetches}`);

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.map((f) => '  · ' + f).join('\n')); process.exit(1); }
