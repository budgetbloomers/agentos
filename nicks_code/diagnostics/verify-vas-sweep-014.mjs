/* verify-vas-sweep-014.mjs — spec 014 (system bug sweep), Area V: VAS / PULSE.
 *
 * One check per confirmed defect, each driving the REAL page (nicks_code/index.html) in Chromium against a
 * stubbed Worker — nothing leaves the machine, nothing touches live data. Every check was run RED against the
 * unfixed page first (specs/014-system-bug-sweep/tasks.md, 2026-10-07):
 *
 *   V2  the Agent List publish carries the rows + roster of ITS file, even when a second file lands inside 3 s
 *   V3  handleFiles is serialised; an adoption never clobbers an in-flight file's per-file globals
 *   V4  removing a dialler file keeps the days (and the other dialler's rows) another registered file covers
 *   V5  hostile strings (agent name, QA Coaching Category, AI reply, Coaching Hub fields) render as TEXT
 *   V6  a digest / report POST that fails is tried again; a deliberate refusal is not hammered
 *   V7  period presets and the Agent List date follow the SAST day, not the UTC day
 *   V8  a period preset / day step is a VIEW change (saveUI), never a whole-state cloud save
 *   V9  a search box keeps focus (and keeps taking keystrokes) after the debounced re-render
 *
 * Run: node verify-vas-sweep-014.mjs            (all)
 *      node verify-vas-sweep-014.mjs V2,V5      (a subset)
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const { chromium } = await import(pathToFileURL(path.join(AGENTOS, 'nicks_code', 'diagnostics', 'node_modules', 'playwright', 'index.mjs')).href);
/* PULSE_HTML may be repo-relative (site/pulse/index.html — the build copy) or absolute (a saved pre-fix page, to
   show a check RED) */
const HTML = (process.env.PULSE_HTML && path.isAbsolute(process.env.PULSE_HTML)) ? process.env.PULSE_HTML
  : path.join(AGENTOS, ...(process.env.PULSE_HTML || 'nicks_code/index.html').split('/'));
const ONLY = process.argv[2] ? new Set(process.argv[2].split(',').map(s => s.trim().toUpperCase())) : null;
const want = (id) => !ONLY || ONLY.has(id);

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);

/* ------------------------------------------------------------------ the stubbed Worker */
const W = {
  rosterPosts: [],          // parsed bodies of POST /api/roster
  kvPosts: [],              // {key, status}
  kvPlan: {},               // key -> [status, …] consumed in order (0 = drop the connection); default 200
  askAnswer: '',
  hubSummary: { totals: {}, agents: [] },
  hubAgent: { sessions: [] },
  leadBook: null,           // {meta, book} — served at /api/lead-book only while a check sets it
};
const SIDE = { '/xlsx.full.min.js': path.join(AGENTOS, 'site', 'xlsx.full.min.js'),
  '/auth-gate.js': path.join(AGENTOS, 'site', 'auth-gate.js'),
  '/ask-widget.js': path.join(AGENTOS, 'site', 'ask-widget.js') };
const srv = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  const J = (o, st = 200) => { s.writeHead(st, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); s.end(JSON.stringify(o)); };
  const body = () => new Promise((r) => { const ch = []; q.on('data', (c) => ch.push(c)); q.on('end', () => r(Buffer.concat(ch))); });
  if (u.pathname === '/api/roster') {
    if (q.method === 'POST') return body().then((b) => { try { W.rosterPosts.push(JSON.parse(b.toString('utf8'))); } catch { W.rosterPosts.push({ unparsed: true }); } J({ accepted: true }); });
    return J({ roster: [] });                                         // never an adoption the suite did not ask for
  }
  if (u.pathname === '/api/kv') {
    if (q.method !== 'POST') return J({ found: false }, 404);
    const key = u.searchParams.get('key') || '';
    return body().then(() => {
      const plan = W.kvPlan[key]; const st = (plan && plan.length) ? plan.shift() : 200;
      W.kvPosts.push({ key, status: st });
      if (st === 0) { s.destroy(); return; }                          // the request never gets an answer
      J(st === 200 ? { ok: true } : { error: 'stub ' + st }, st);
    });
  }
  if (u.pathname === '/api/me') return J({ user: { username: 'nick', role: 'admin' } });
  if (u.pathname === '/api/upload-manifest') return J({ files: [] });
  if (u.pathname === '/api/upload-archive') return body().then(() => J({ ok: true }));
  if (u.pathname === '/api/ask') return body().then(() => J({ answer: W.askAnswer }));
  if (u.pathname === '/api/coaching/summary') return J(W.hubSummary);
  if (u.pathname === '/api/coaching') return J(W.hubAgent);
  if (u.pathname === '/api/campaign-moves') return J({ agents: {} });
  if (u.pathname === '/api/lead-book') return W.leadBook ? J(u.searchParams.get('meta') ? W.leadBook.meta : W.leadBook.book) : J({ empty: true });
  if (u.pathname.startsWith('/api/')) return J({ error: 'not stubbed' }, 404);
  const p = SIDE[u.pathname] || (u.pathname === '/' ? HTML : null);
  if (!p || !fs.existsSync(p)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(p).pipe(s);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));           // an OS-chosen port: never EADDRINUSE against a parallel suite
const PORT = srv.address().port;

const b = await chromium.launch();
const pageErrors = [];
async function openPage(opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 140)));
  page.on('dialog', (d) => d.accept());
  if (opts.fixedTime) await page.clock.setFixedTime(new Date(opts.fixedTime));
  await page.addInitScript((port) => {
    sessionStorage.setItem('cbx_token', 'test-token');
    const of = window.fetch;
    window.fetch = (u, o) => of(String(u).replace('https://chatterbox-agentos-api.chatterbox-agentos.workers.dev', 'http://127.0.0.1:' + port), o);
  }, PORT);
  await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__mtd && window.__mtd.state(), null, { timeout: 60000 });
  await page.evaluate(() => { sessionStorage.setItem('cbx_token', 'test-token'); window.__vasHydrated = true; window.confirm = () => true; });
  return { ctx, page };
}
const painted = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));

/* ------------------------------------------------------------------ August fixtures (DEFAULTS roster) */
const HOSTILE_NAME = '<img/src="x"/onerror="window.__xName=1">';           // no spaces: genInsights uses the FIRST word
const HOSTILE_CAT = '<img src=x onerror="window.__xCat=1">';
const ACTIVE = ['Account Number,Case Number,Owner,Contract Create Date,Contract Deactivate Date,Charge Amount,Charge Code',
  'N1,21000021,Nosipho Shange - Panimax,2026-08-03,,86.96,R1',
  'S1,21000031,Sechaba Mlambo - Panimax,2026-08-04,,86.96,R1',
  'A2,21000002,Theo Chetty - Panimax,2026-08-03,,100,R1'].join('\n');
const ATT = ['Date,Employee Code,Employee Name,Employee Type,Status,Status Code',
  '2026-08-03,CB129,Nosipho Shange,Call Agent,Present,P',
  '2026-08-04,CB129,Nosipho Shange,Call Agent,Present,P',
  '2026-08-04,CB131,Sechaba Mlambo,Call Agent,Present,P'].join('\n');
const EVALS = ['Record ID,Date of Assessment,Sales Agent CB,QA Agent,Score %,Escalation Decision,Coaching Category',
  'R1,2026-08-03,CB129,QA One,50%,Critical Fail,"' + HOSTILE_CAT.replace(/"/g, '""') + '"',
  'R2,2026-08-04,CB129,QA One,50%,Critical Fail,"' + HOSTILE_CAT.replace(/"/g, '""') + '"'].join('\n');
async function loadAugust(page) {
  return page.evaluate(async ({ ACTIVE, ATT, EVALS, HOSTILE_NAME }) => {
    const S = window.__mtd.state();
    const a = S.roster.find((x) => x.code === 'CB129'); if (a) a.name = HOSTILE_NAME + ' Shange';   // sf still joins the BI Owner
    const r = [];
    r.push(await window.__mtd.ingest('Active 2026-08-04.xlsx', ACTIVE));
    r.push(await window.__mtd.ingest('attendance_2026-08-03_to_2026-08-04.csv', ATT));
    r.push(await window.__mtd.ingest('evaluations 2026-08-04.csv', EVALS));
    window.__mtd.setPeriod('2026-08');
    return r;
  }, { ACTIVE, ATT, EVALS, HOSTILE_NAME });
}

try {
  /* ================================================================ V5 · V8 · V9 — one page with August data */
  if (want('V5') || want('V8') || want('V9')) {
    const { ctx, page } = await openPage();
    const loaded = await loadAugust(page);
    ok('(setup) the August fixtures ingest', loaded.every(Boolean), JSON.stringify(loaded));

    if (want('V5')) {
      head('V5 · hostile strings render as text');
      W.askAnswer = 'What works: steady dials\n' + '<img src=x onerror="window.__xAI=1">';
      const today = new Date().toISOString().slice(0, 10);
      W.hubSummary = { totals: { sessions: 6, scored: 6 }, agents: [
        { code: 'CB129', name: '<img src=x onerror="window.__xHub=1">', sessions: 6, noTheme: 0, themes: [
          { key: 'gap.compliance_required_wording', family: 'gap', shown: 5, scored: 5, last: today },
          { key: 'gap.<img src=x onerror="window.__xKey=1">', family: 'gap', shown: 2, scored: 2, last: today }] },
        { code: "CB1');window.__xCode=1;//", name: 'Code Breaker', sessions: 5, noTheme: 0, themes: [
          { key: 'gap.compliance_required_wording', family: 'gap', shown: 4, scored: 4, last: today }] }] };
      W.hubAgent = { sessions: [{ date: today, type: '<img src=x onerror="window.__xType=1">', clusterSource: 'coach', clusterConfidence: 1,
        clusters: [{ clusterKey: 'gap.<img src=x onerror="window.__xHist=1">', family: 'gap' }] }] };

      /* genInsights — the at-risk insight names the agent by first word */
      const ins = await page.evaluate((tag) => (genInsights() || []).map((x) => x.text).filter((t) => t.indexOf(tag) >= 0).length, '__xName');
      ok('V5 (precondition) the real genInsights() names the hostile agent in an insight', ins > 0, String(ins));
      await page.evaluate(() => go('dashboard')); await painted(page);
      const dash = await page.evaluate(() => { const els = [...document.querySelectorAll('#view .insight')];
        return { n: els.length, img: els.reduce((t, e) => t + e.querySelectorAll('img').length, 0), txt: els.map((e) => e.textContent).join(' ') }; });
      ok('V5 genInsights text is escaped on the dashboard (no <img> element, the tag reads as text)', dash.n > 0 && dash.img === 0 && /<img/.test(dash.txt), JSON.stringify(dash).slice(0, 160));

      /* coachingFor `why` — the QA Coaching Category */
      const why = await page.evaluate(() => coachingFor('CB129').map((r) => r.why).join(' | '));
      ok('V5 (precondition) coachingFor() carries the QA Coaching Category into `why`', why.indexOf('__xCat') >= 0, why.slice(0, 120));
      await page.evaluate(() => go('coaching')); await painted(page);
      const cq = await page.evaluate(() => { const els = [...document.querySelectorAll('#view .coachcard')];
        return { n: els.length, img: els.reduce((t, e) => t + e.querySelectorAll('img').length, 0), txt: els.map((e) => e.textContent).join(' ') }; });
      ok('V5 coaching queue: `why` (QA Coaching Category) is escaped', cq.n > 0 && cq.img === 0 && /__xCat/.test(cq.txt), JSON.stringify(cq).slice(0, 160));

      /* the Coaching Hub card (names, theme keys, codes in onclick) */
      await page.waitForFunction(() => /Coaching Hub/.test((document.getElementById('coachHub') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
      const hub = await page.evaluate(() => { const e = document.getElementById('coachHub'); const boxes = [...document.querySelectorAll('[id^="qct_"]')];
        return { img: e ? e.querySelectorAll('img').length : -1, boxImg: boxes.reduce((t, x) => t + x.querySelectorAll('img').length, 0),
          txt: e ? e.textContent : '', clicks: [...document.querySelectorAll('#coachHub a.linky, [id^="qct_"] a.linky')].map((a) => a.getAttribute('onclick')) }; });
      ok('V5 Coaching Hub: the agent name and theme keys are escaped', hub.img === 0 && hub.boxImg === 0 && /__xHub/.test(hub.txt), JSON.stringify(hub).slice(0, 200));
      ok('V5 Coaching Hub: a code in an onclick cannot break out of its string', hub.clicks.length > 0 && hub.clicks.every((c) => /^openDrawer\('[A-Za-z0-9_-]*'\)$/.test(String(c))), JSON.stringify(hub.clicks).slice(0, 200));

      /* the drawer: narrativeFor, the coaching plan, the AI reply and the coaching history */
      await page.evaluate(() => openDrawer('CB129'));
      await page.waitForFunction(() => { const e = document.getElementById('vasAI'); return e && !/Analysing/.test(e.textContent); }, null, { timeout: 15000 }).catch(() => {});
      await page.waitForFunction(() => { const e = document.getElementById('vasCoachHist'); return e && !/Loading coaching/.test(e.textContent); }, null, { timeout: 15000 }).catch(() => {});
      const dr = await page.evaluate(() => {
        const d = document.getElementById('drawer'); const narr = [...d.querySelectorAll('p.note')].find((p) => /momentum|sales target/.test(p.textContent));
        const ai = document.getElementById('vasAI'), hist = document.getElementById('vasCoachHist');
        return { narrImg: narr ? narr.querySelectorAll('img').length : -1, narrTxt: narr ? narr.textContent : '',
          planImg: [...d.querySelectorAll('.coachcard')].reduce((t, e) => t + e.querySelectorAll('img').length, 0),
          planTxt: [...d.querySelectorAll('.coachcard')].map((e) => e.textContent).join(' '),
          aiImg: ai.querySelectorAll('img').length, aiTxt: ai.textContent, aiBr: ai.querySelectorAll('br').length,
          histImg: hist.querySelectorAll('img').length, histTxt: hist.textContent };
      });
      ok('V5 narrativeFor is escaped in the drawer (hostile name + category read as text)', dr.narrImg === 0 && /__xName/.test(dr.narrTxt) && /__xCat/.test(dr.narrTxt), JSON.stringify({ i: dr.narrImg, t: dr.narrTxt.slice(0, 120) }));
      ok('V5 the drawer coaching plan `why` is escaped', dr.planImg === 0 && /__xCat/.test(dr.planTxt), JSON.stringify({ i: dr.planImg }));
      ok('V5 the AI coach reply is escaped (and its line breaks survive)', dr.aiImg === 0 && /<img/.test(dr.aiTxt) && dr.aiBr >= 1, JSON.stringify({ i: dr.aiImg, br: dr.aiBr, t: dr.aiTxt.slice(0, 80) }));
      ok('V5 the Coaching Hub history (session type, theme key) is escaped', dr.histImg === 0 && /__xType|__xHist/.test(dr.histTxt), JSON.stringify({ i: dr.histImg, t: dr.histTxt.slice(0, 120) }));
      const fired = await page.evaluate(() => ['__xAI', '__xHub', '__xKey', '__xCode', '__xCat', '__xType', '__xHist'].filter((k) => window[k]));
      ok('V5 none of the injected handlers ran', fired.length === 0, fired.join(','));
      await page.evaluate(() => { try { closeDrawer(); } catch (e) {} });
    }

    if (want('V8')) {
      head('V8 · a period preset / day step is a view change, not a cloud save');
      await page.evaluate(() => go('dashboard')); await painted(page);
      const pr = await page.evaluate(() => {
        const S = window.__mtd.state(); S._rev = 424242; window.__vasDirtySince = 0;
        const sel = document.getElementById('pPreset'); sel.value = '30d'; sel.dispatchEvent(new Event('change'));
        let ui = null; try { ui = JSON.parse(localStorage.getItem(uiKey()) || 'null'); } catch (e) {}
        return { rev: S._rev, dirty: window.__vasDirtySince || 0, saved: ui && ui.preset };
      });
      ok('V8 #pPreset does NOT save the whole state (no new _rev, nothing dirty)', pr.rev === 424242 && !pr.dirty, JSON.stringify(pr));
      ok('V8 …and the preset is kept in the per-person view (saveUI)', pr.saved === '30d', JSON.stringify(pr));
      await page.evaluate(() => window.__mtd.setPeriod('2026-08')); await painted(page);
      await page.evaluate(() => go('daily')); await painted(page);
      const ds = await page.evaluate(() => {
        const S = window.__mtd.state(); S._rev = 434343; window.__vasDirtySince = 0;
        window.dailyStep(-1);
        let ui = null; try { ui = JSON.parse(localStorage.getItem(uiKey()) || 'null'); } catch (e) {}
        return { rev: S._rev, dirty: window.__vasDirtySince || 0, day: S.ui.dailyFilter && S.ui.dailyFilter.date, saved: ui && ui.dailyFilter && ui.dailyFilter.date };
      });
      ok('V8 dailyStep does NOT save the whole state', ds.rev === 434343 && !ds.dirty, JSON.stringify(ds));
      ok('V8 …and the stepped day is kept in the per-person view', !!ds.day && ds.saved === ds.day, JSON.stringify(ds));
      await page.evaluate(() => { window.dailyF('date', ''); });
    }

    if (want('V9')) {
      head('V9 · a search box keeps focus after the debounced re-render');
      const probe = async (tab, sel) => {
        await page.evaluate((t) => go(t), tab); await painted(page);
        await page.click(sel);
        await page.keyboard.type('No', { delay: 30 });
        await page.waitForTimeout(900);                                 // past the 320 ms debounce and the two-frame repaint
        const a = await page.evaluate((s) => { const el = document.querySelector(s); return { focused: !!el && document.activeElement === el, v: el ? el.value : null }; }, sel);
        await page.keyboard.type('si', { delay: 30 });
        await page.waitForTimeout(900);
        const c = await page.evaluate((s) => { const el = document.querySelector(s); return { focused: !!el && document.activeElement === el, v: el ? el.value : null }; }, sel);
        return { a, c };
      };
      const ag = await probe('agents', '#view input[type=search]');
      ok('V9 Agents search: still focused after the re-render', ag.a.focused && ag.a.v === 'No', JSON.stringify(ag.a));
      ok('V9 Agents search: the next keystrokes land in the box', ag.c.focused && ag.c.v === 'Nosi', JSON.stringify(ag.c));
      const db = await probe('dashboard', '#view .cardhead input[type=search]');
      ok('V9 Dashboard search: still focused and typing', db.a.focused && db.c.focused && db.c.v === 'Nosi', JSON.stringify(db));
      const dl = await probe('daily', '#view .filters input[type=search]');
      ok('V9 Daily search: still focused and typing', dl.a.focused && dl.c.focused && dl.c.v === 'Nosi', JSON.stringify(dl));
      /* A key pressed WHILE the re-render is in flight (between the debounce firing and the real paint) used to land
         on the skeleton and vanish — "Nos" instead of "Nosi" in the full run under load. Frames are HELD here so the
         window is certain, not a race. */
      const sel = '#view .filters input[type=search]';
      await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace');
      await page.keyboard.type('Nos', { delay: 30 }); await page.waitForTimeout(900);
      await page.evaluate(() => {
        window.__heldRaf = []; window.__realRaf = window.requestAnimationFrame;
        window.requestAnimationFrame = (cb) => { window.__heldRaf.push(cb); return 0; };
        renderPage();
      });
      const mid = await page.evaluate((s) => { const el = document.querySelector(s); return { exists: !!el, focused: !!el && document.activeElement === el }; }, sel);
      await page.keyboard.type('i');
      await page.evaluate(() => {
        let n = 0; while (window.__heldRaf.length && n++ < 10) window.__heldRaf.shift()(performance.now());
        window.requestAnimationFrame = window.__realRaf;
      });
      const look = () => page.evaluate((s) => { const el = document.querySelector(s); return { focused: !!el && document.activeElement === el, v: el ? el.value : null }; }, sel);
      const now = await look();
      ok('V9 while the re-render is in flight the box is still there, focused', mid.exists && mid.focused, JSON.stringify(mid));
      ok('V9 a key pressed mid-render lands in the box (Nosi, not Nos)', now.focused && now.v === 'Nosi', JSON.stringify(now));
      await page.waitForTimeout(900);
      const later = await look();
      ok('V9 …and survives the re-render that key itself triggers', later.focused && later.v === 'Nosi', JSON.stringify(later));
    }
    await ctx.close();
  }

  /* ================================================================ V2 · V3 — the Agent List and the upload queue */
  if (want('V2') || want('V3')) {
    const { ctx, page } = await openPage();
    const list = (codes, leaders, vtCodes) => {
      const vas = ['Employee Code,Agent Name,Sales Force,Team Leader,Campaign,Tenure,Target']
        .concat(codes.map((c, i) => [c, 'Agent ' + c, 'Agent ' + c, 'Leader ' + (i % 2 ? 'B' : 'A'), i % 2 ? 'Cuddle' : 'Courtesy', i % 2 ? 'Exp' : 'M1', i % 2 ? 8 : 3].join(',')));
      let t = '### Sheet: VAS ###\n' + vas.join('\n');
      if (vtCodes) t += '\n### Sheet: VT ###\n' + ['Employee Code,Agent Name,Sales Force,Team Leader,Campaign,Tenure,Target']
        .concat(vtCodes.map((c) => [c, 'Agent ' + c, 'Agent ' + c, 'Leader VT', 'Scheduling', 'Exp', 3].join(','))).join('\n');
      if (leaders) t += '\n### Sheet: VAS TL ###\n' + ['Employee Code,Team Leader Name,Sales Manager,Campaign,VICCI Dial']
        .concat(leaders.map((l) => [l.cb, l.name, 'Manager M', l.camp, l.cb].join(','))).join('\n');
      return t;
    };
    if (want('V2')) {
      head('V2 · the Agent List publish carries ITS file, whatever lands in the next 3 s');
      await page.evaluate(() => { window.__mtd.state().roster = []; });
      const A = list(['CB500', 'CB501', 'CB502', 'CB503'], [{ cb: 'CB900', name: 'Leader A', camp: 'Courtesy' }, { cb: 'CB901', name: 'Leader B', camp: 'Cuddle' }]);
      let p0 = W.rosterPosts.length;
      await page.evaluate(async ({ A, ATT }) => {
        await window.__mtd.ingest('Matrix - Agent List 2026-10-05.xlsx', A);
        await window.__mtd.ingest('attendance second drop.csv', ATT);     // the next file of the same drop
      }, { A, ATT });
      await page.waitForTimeout(4200);
      const pa = W.rosterPosts.slice(p0).find((x) => x.file === 'Matrix - Agent List 2026-10-05.xlsx');
      const rows = (pa && pa.rows) || [];
      ok('V2 the publish still carries the file\'s rows after a second file was ingested', !!pa && Array.isArray(pa.rows) && rows.length === 6, pa ? 'rows=' + JSON.stringify(pa.rows && pa.rows.length) : 'no publish');
      ok('V2 …including the leader rows of the VAS TL sheet', rows.filter((r) => r.role === 'leader').length === 2, String(rows.filter((r) => r.role === 'leader').length));

      const A2 = list(['CB510', 'CB511', 'CB512', 'CB513'], null, ['CB514', 'CB515']);   // two roster sheets (VAS + VT) in one workbook
      const B2 = list(['CB520', 'CB521', 'CB522', 'CB523']);
      p0 = W.rosterPosts.length;
      await page.evaluate(async ({ A2, B2 }) => {
        await window.__mtd.ingest('Matrix - Agent List 2026-10-06.xlsx', A2);
        await window.__mtd.ingest('Matrix - Agent List 2026-10-07.xlsx', B2);   // a newer list, dropped straight after
      }, { A2, B2 });
      await page.waitForTimeout(4500);
      const posts = W.rosterPosts.slice(p0);
      const pA = posts.find((x) => x.file === 'Matrix - Agent List 2026-10-06.xlsx'), pB = posts.find((x) => x.file === 'Matrix - Agent List 2026-10-07.xlsx');
      const codes = (x) => ((x && x.roster) || []).map((a) => a.code).sort().join(',');
      const A2codes = 'CB510,CB511,CB512,CB513,CB514,CB515';
      ok('V2 the first list publishes ITS roster (both sheets), not the one that replaced it 1 s later', codes(pA) === A2codes, codes(pA));
      ok('V2 …and its own rows', !!pA && Array.isArray(pA.rows) && pA.rows.map((r) => r.code).sort().join(',') === A2codes, pA ? JSON.stringify((pA.rows || []).map((r) => r.code)) : 'none');
      ok('V2 the second list publishes its own roster', codes(pB) === 'CB520,CB521,CB522,CB523', codes(pB));
      ok('V2 one publish per file (a two-sheet workbook posts once, with the whole file)', posts.filter((x) => x.file === 'Matrix - Agent List 2026-10-06.xlsx').length === 1,
        posts.filter((x) => x.file === 'Matrix - Agent List 2026-10-06.xlsx').length + ' publish(es)');
    }
    if (want('V3')) {
      head('V3 · one ingest at a time');
      const conc = await page.evaluate(async ({ ATT }) => {
        /* Real files are small enough to finish between two awaits of the other call, which hides the race; every
           sheet parse is slowed to 60 ms (the shape of a large export) so the two calls overlap for certain. */
        const real = window.ingestText, realParse = window.toObjectsAsync; let live = 0, max = 0;
        window.toObjectsAsync = async function () { await new Promise((r) => setTimeout(r, 60)); return realParse.apply(this, arguments); };
        window.ingestText = async function () { live++; max = Math.max(max, live); try { return await real.apply(this, arguments); } finally { live--; } };
        const a = ATT, bb = ATT.replace(/2026-08-0/g, '2026-08-1');
        const fa = new File([a], 'att drop A.csv'), fb = new File([bb], 'att relay B.csv');
        const ha = await hashBuf(await fa.arrayBuffer()), hb = await hashBuf(await fb.arrayBuffer());
        try { await Promise.all([handleFiles([fa], null), handleFiles([fb], null)]); } finally { window.ingestText = real; window.toObjectsAsync = realParse; }
        const S = window.__mtd.state();
        return { max, aOk: S.files.filter((f) => f.name === 'att drop A.csv').every((f) => f.hash === ha) && S.files.some((f) => f.name === 'att drop A.csv'),
          bOk: S.files.filter((f) => f.name === 'att relay B.csv').every((f) => f.hash === hb) && S.files.some((f) => f.name === 'att relay B.csv') };
      }, { ATT });
      ok('V3 two handleFiles calls (a drop + the station relay) never ingest at the same time', conc.max === 1, 'max concurrent ingestText = ' + conc.max);
      ok('V3 …and each file is registered under its OWN content hash', conc.aOk && conc.bOk, JSON.stringify(conc));

      const board = ['### Sheet: 05.08 ###', 'Agent Name,Sale 1,Sale 2,Total Sales,Total GWP,Average GWP,Referrals', 'Theo Chetty,99,,1,99,99,0',
        '### Sheet: 06.08 ###', 'Agent Name,Sale 1,Sale 2,Total Sales,Total GWP,Average GWP,Referrals', 'Theo Chetty,99,,1,99,99,0'].join('\n');
      const ad = await page.evaluate(async ({ board }) => {
        const f = new File([board], 'Manual Stats V3.xlsx'); const h = await hashBuf(await f.arrayBuffer());
        const roster = []; for (let i = 0; i < 30; i++) roster.push({ code: 'CB' + (700 + i), name: 'Record Agent ' + i, tl: 'Record Leader', campaign: 'Courtesy', tenure: 'M1', target: 3 });
        const realParse = window.toObjectsAsync;                              // hold each sheet open 60 ms (see above)
        window.toObjectsAsync = async function () { await new Promise((r) => setTimeout(r, 60)); return realParse.apply(this, arguments); };
        let inside = false;
        try {
          const run = handleFiles([f], null);
          for (let i = 0; i < 400 && !__curFileHash; i++) await new Promise((r) => setTimeout(r, 0));   // inside the file's ingest
          inside = !!__curFileHash;
          const adopt = adoptRosterFromRecord({ roster, fingerprint: 'fp:v3', as_of: '2026-08-20', source: 'record' });
          await run; await adopt;
        } finally { window.toObjectsAsync = realParse; }
        const S = window.__mtd.state(); const ents = S.files.filter((x) => x.name === 'Manual Stats V3.xlsx');
        return { inside, n: ents.length, hashed: ents.every((x) => x.hash === h), fp: S.rosterFp, roster: S.roster.length };
      }, { board });
      ok('V3 (precondition) the adoption fired while the file was mid-ingest', ad.inside, JSON.stringify(ad));
      ok('V3 an adoption mid-ingest does not strip the in-flight file\'s hash', ad.n === 2 && ad.hashed, JSON.stringify(ad));
      ok('V3 …and the adoption still lands once the ingest is done', ad.fp === 'fp:v3' && ad.roster === 30, JSON.stringify(ad));

      /* the lake's lead book is adopted on its own timer — it must not take the hash from under a file mid-ingest */
      const board4 = [5, 6, 7, 8].map((d) => ['### Sheet: 0' + d + '.08 ###', 'Agent Name,Sale 1,Sale 2,Total Sales,Total GWP,Average GWP,Referrals', 'Theo Chetty,99,,1,99,99,0'].join('\n')).join('\n');
      W.leadBook = { meta: { loaded_at: '2026-10-07T08:00:00Z', agent_rows: 1 },
        book: { rows: [{ k: '5001', o: 'Theo Chetty', s: 'New', d: '2026-10-06T08:00:00Z' }], file: 'Lake book V3', snapshot_date: '2026-10-07', total: 1, queue_rows: 0 } };
      const lk = await page.evaluate(async ({ board4 }) => {
        const f = new File([board4], 'Manual Stats V3b.xlsx'); const h = await hashBuf(await f.arrayBuffer());
        const realParse = window.toObjectsAsync, realIngest = window.ingestText, realReg = window.regFile;
        let live = 0, liveAtLake = -1;
        window.toObjectsAsync = async function () { await new Promise((r) => setTimeout(r, 80)); return realParse.apply(this, arguments); };
        window.ingestText = async function () { live++; try { return await realIngest.apply(this, arguments); } finally { live--; } };
        window.regFile = function (name) { if (/Lake book V3/.test(String(name))) liveAtLake = live; return realReg.apply(this, arguments); };
        try {
          const run = handleFiles([f], null);
          for (let i = 0; i < 400 && !live; i++) await new Promise((r) => setTimeout(r, 0));
          await window.__mtd.syncLeadBook();
          await run;
        } finally { window.toObjectsAsync = realParse; window.ingestText = realIngest; window.regFile = realReg; }
        const S = window.__mtd.state(); const ents = S.files.filter((x) => x.name === 'Manual Stats V3b.xlsx');
        return { liveAtLake, n: ents.length, hashed: ents.every((x) => x.hash === h), lake: !!(S.opencasesLM && S.opencasesLM.lake) };
      }, { board4 });
      W.leadBook = null;
      ok('V3 (precondition) the lake lead-book adoption landed while a file was mid-ingest', lk.liveAtLake > 0, JSON.stringify(lk));
      ok('V3 a lake adoption mid-ingest leaves the in-flight file its own hash', lk.n === 4 && lk.hashed, JSON.stringify(lk));
      ok('V3 …and the lake book is still adopted', lk.lake, JSON.stringify(lk));
    }
    await ctx.close();
  }

  /* ================================================================ V4 · V6 */
  if (want('V4') || want('V6')) {
    const { ctx, page } = await openPage();
    if (want('V4')) {
      head('V4 · removing a dialler file keeps what another file covers');
      const r1 = await page.evaluate(() => {
        const S = window.__mtd.state(); const d = '2026-09-10';
        S.calls[d] = { CB300: { talk: 100, calls: 2, ans: 1, opt: 0, saleD: 0, v: 1 }, CB301: { talk: 80, calls: 1, ans: 1, opt: 0, saleD: 0, v: 1 } };
        S.callsMeta[d] = { f: '', n: 0 };                                // what normalizeState seeds on reload
        S.viciDays[d] = 1;
        S.files.push({ name: 'EXPORT_CALL_REPORT A.txt', type: 'calls (ViciDial)', dates: [d], rows: 3 },
                     { name: 'EXPORT_CALL_REPORT B.txt', type: 'calls (ViciDial)', dates: [d], rows: 2 });
        removeFile(S.files.findIndex((f) => f.name === 'EXPORT_CALL_REPORT A.txt'));
        const keep = { codes: Object.keys(S.calls[d] || {}).sort().join(','), vd: !!S.viciDays[d] };
        removeFile(S.files.findIndex((f) => f.name === 'EXPORT_CALL_REPORT B.txt'));
        return { keep, after: { day: !!S.calls[d], vd: !!S.viciDays[d] } };
      });
      ok('V4 removing one ViciDial file keeps the day another ViciDial file covers', r1.keep.codes === 'CB300,CB301' && r1.keep.vd, JSON.stringify(r1));
      ok('V4 removing the last file covering it releases the day', !r1.after.day && !r1.after.vd, JSON.stringify(r1));
      const r2 = await page.evaluate(() => {
        const S = window.__mtd.state(); const d = '2026-08-04';
        S.calls[d] = { 'Agent X CB-1': { talk: 50, calls: 1, ans: 1, opt: 0, saleD: 0 }, CB302: { talk: 60, calls: 1, ans: 1, opt: 0, saleD: 0, v: 1 } };
        S.callsMeta[d] = { f: 'call_records 04.csv', n: 1 }; S.viciDays[d] = 1;
        S.files.push({ name: 'call_records 04.csv', type: 'calls', dates: [d], rows: 1 },
                     { name: 'EXPORT_CALL_REPORT C.txt', type: 'calls (ViciDial)', dates: [d], rows: 1 });
        removeFile(S.files.findIndex((f) => f.name === 'call_records 04.csv'));
        const afterCallx = Object.keys(S.calls[d] || {}).sort().join(',');
        removeFile(S.files.findIndex((f) => f.name === 'EXPORT_CALL_REPORT C.txt'));
        return { afterCallx, day: !!S.calls[d] };
      });
      ok('V4 removing a CallX file keeps the ViciDial rows of that day', r2.afterCallx === 'CB302', JSON.stringify(r2));
      ok('V4 …and removing the ViciDial file then clears the day', !r2.day, JSON.stringify(r2));
    }
    if (want('V6')) {
      head('V6 · a digest / report POST that fails is tried again');
      const mo = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7);
      const last = new Date(Date.UTC(+mo.slice(0, 4), +mo.slice(5, 7), 0)).toISOString().slice(0, 10);
      await page.evaluate(({ mo, last }) => {
        const S = window.__mtd.state(); if (!(S.files || []).length) S.files.push({ name: 'probe.xlsx', type: 'bi', dates: [], rows: 1 });
        window.__v6n = 1;
        window.agentDigestPayload = () => ({ v: 1, period: { from: mo + '-01', to: last }, agents: [{ code: 'CB1', n: window.__v6n }], updatedAt: new Date().toISOString() });
        window.agentReportsVariancePayload = () => ({ v: 1, kind: 'variance', period: { from: mo + '-01', to: last }, agents: { CB1: [[window.__v6n]] }, teams: {} });
        window.agentReportsLeadsPayload = () => null;
      }, { mo, last });
      const count = (k) => W.kvPosts.filter((x) => x.key === k).length;
      const pushNow = () => page.evaluate(() => window.__agentDigestPush());
      const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return fn(); };

      W.kvPlan['agent-digest'] = [500]; W.kvPlan['agent-reports-variance'] = [503];
      const d0 = count('agent-digest'), r0 = count('agent-reports-variance');
      await pushNow(); await until(() => count('agent-digest') > d0 && count('agent-reports-variance') > r0);
      await page.waitForTimeout(300);
      await pushNow(); await until(() => count('agent-digest') >= d0 + 2 && count('agent-reports-variance') >= r0 + 2, 3000);
      ok('V6 the live digest POST that got a 500 is sent again on the next push', count('agent-digest') >= d0 + 2, (count('agent-digest') - d0) + ' attempt(s)');
      ok('V6 the team-leader report POST that got a 503 is sent again on the next push', count('agent-reports-variance') >= r0 + 2, (count('agent-reports-variance') - r0) + ' attempt(s)');
      await page.waitForTimeout(400);
      const d1 = count('agent-digest'), r1 = count('agent-reports-variance');
      await pushNow(); await page.waitForTimeout(800);
      ok('V6 once answered, an unchanged payload is not re-posted', count('agent-digest') === d1 && count('agent-reports-variance') === r1, (count('agent-digest') - d1) + '/' + (count('agent-reports-variance') - r1));

      /* NO ANSWER AT ALL (the CORS / network shape): the browser aborts the request, once. A dropped socket is not
         used — Chromium silently re-sends a POST whose reused connection resets, which would pass this for the app. */
      let aborted = 0;
      const liveKey = /\/api\/kv\?key=agent-digest$/;
      await page.route(liveKey, (route) => { if (aborted === 0) { aborted++; return route.abort('failed'); } return route.continue(); });
      await page.evaluate(() => { window.__v6n = 2; });
      const d2 = count('agent-digest');
      await pushNow(); await until(() => aborted > 0);
      await page.waitForTimeout(300);
      await pushNow(); await until(() => count('agent-digest') > d2, 3000);
      await page.unroute(liveKey);
      ok('V6 a digest POST that got NO answer is sent again', aborted === 1 && count('agent-digest') === d2 + 1, 'aborted ' + aborted + ', then ' + (count('agent-digest') - d2) + ' answered attempt(s)');

      W.kvPlan['agent-digest'] = [409];                                    // a deliberate refusal (stale_month / empty_over_data)
      await page.evaluate(() => { window.__v6n = 3; });
      const d3 = count('agent-digest');
      await pushNow(); await until(() => count('agent-digest') > d3);
      await page.waitForTimeout(300);
      await pushNow(); await page.waitForTimeout(800); await pushNow(); await page.waitForTimeout(800);
      ok('V6 a deliberate refusal (409) is not hammered every tick', count('agent-digest') === d3 + 1, (count('agent-digest') - d3) + ' attempt(s)');
    }
    await ctx.close();
  }

  /* ================================================================ V7 — a clock 30 minutes before SAST midnight… after it */
  if (want('V7')) {
    head('V7 · presets and the list date follow the SAST day');
    const { ctx, page } = await openPage({ fixedTime: '2026-10-31T23:30:00Z' });   // 01:30 SAST on Sunday 1 November
    const r = await page.evaluate(() => {
      const S = window.__mtd.state(); S.settings.rosterAsOf = ''; __rosterAsOf = null;
      const asOf = rosterAsOf('Matrix - Agent List.xlsx'); __rosterAsOf = null;
      return { today: periodRangeRaw('today'), yday: periodRangeRaw('yesterday'), mtd: periodRangeRaw('mtd'), prev: periodRangeRaw('prevMonth'), asOf };
    });
    ok('V7 "Today" at 01:30 SAST on 1 Nov is 1 Nov', r.today && r.today.from === '2026-11-01' && r.today.to === '2026-11-01', JSON.stringify(r.today));
    ok('V7 "Yesterday" is 31 Oct', r.yday && r.yday.from === '2026-10-31', JSON.stringify(r.yday));
    ok('V7 "Month to date" is November', r.mtd && r.mtd.from === '2026-11-01', JSON.stringify(r.mtd));
    ok('V7 "Previous month" is October', r.prev && r.prev.from === '2026-10-01' && r.prev.to === '2026-10-31', JSON.stringify(r.prev));
    ok('V7 an Agent List with no date in its name is dated the SAST day (it wins November, not October)', r.asOf === '2026-11-01', r.asOf);
    await ctx.close();
  }
} catch (e) {
  fail++; failures.push('suite crashed'); console.log('  FAIL suite crashed — ' + (e && e.stack || e));
}

ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
if (failures.length) console.log('FAILED: ' + failures.join(' · '));
await b.close(); srv.close();
process.exit(fail ? 1 : 0);
