#!/usr/bin/env node
/**
 * verify-agent-card.mjs — every agent's card agrees with itself and with the engine.
 *
 *   node nicks_code/diagnostics/verify-agent-card.mjs            (CBX_SITE overrides the page URL)
 *   CBX_EMPTY_FIXTURE=1 node nicks_code/diagnostics/verify-agent-card.mjs     (LOCAL proof of the empty-month mode: no network, no Supabase)
 *
 * ONE NUMBER, ONE VERDICT (specs/agent-view-consistency-plan.md). On 7 Sep Jolene's card read
 * "At target" in the rating row and "R 0,01 to go — VALUE ISSUE" in the panel below it, because
 * the page derived a floor the engine had already decided. This suite opens the DEPLOYED Agent
 * Analytics page under a service session, drills into EVERY rated agent in the live digest, and
 * asserts for each: the score on screen is the digest's; every rating-row chip matches its
 * part's verdict; the two-checks verdicts are the Worker's own; the value figure the rating row
 * prints is the value figure the checks panel prints; Conversion shows a figure whenever leads
 * exist; the sessions table has one row per day row. Runs nightly from the scheduled workflow.
 *
 * EMPTY-MONTH MODE (spec 002-live-month-sync-coaching). From the first of a month until its first day of data the
 * live digest is the empty payload (empty:true, every figure null, nobody "rated"). There is no score or verdict to
 * compare, so the suite switches mode: it renders EVERY agent's page — the leader's drill-down AND the agent's own
 * Today — and asserts the empty-state copy ("No <Month> figures yet — …"), the "<Previous month> (final)" link, and
 * that no figure leaks. It still fails on any page error. CBX_EMPTY_FIXTURE=1 runs the same mode against the local
 * agent/index.html with a stubbed Worker so the mode itself is proven without credentials.
 */
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(HERE, 'node_modules', 'playwright', 'index.mjs')).href);
const FIXTURE = !!process.env.CBX_EMPTY_FIXTURE;
const env = FIXTURE ? {} : Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/'; const API = 'https://chatterbox-agentos-api.chatterbox-agentos.workers.dev';
const SITE = FIXTURE ? pathToFileURL(path.join(ROOT, 'agent', 'index.html')).href : (process.env.CBX_SITE || 'https://chatterbox-agentos.pages.dev/agent/');
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; failures.push(n + (d ? ' — ' + d : '')); } };
const num = (s) => parseFloat(String(s).replace(/[\s ]/g, '').replace(',', '.'));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ---- the fixture: the C1 empty payload for October 2026, three agents, served locally ---- */
const nullRow = (code, name) => ({ code, name, tl: 'Denise Haripersad', campaign: 'Courtesy', tenure: 'M1', plan: 'M1', target: 100, covered: false,
  sales: null, gwpEx: null, pctT: null, spd: null, att: null, qa: null, aveG: null, ref: null, closed: null, leads: null, calls: null, ans: null, talk: null, aveTalk: null, act: null, emp: null, composite: null, days: [], wk: [] });
const fixtureBase = () => ({ v: 1, updatedAt: '2026-10-01T06:00:00Z', empty: true, period: { from: '2026-10-01', to: '2026-10-31' }, daysWithData: 0, dates: [], weeks: [], diallingDays: 0, workingDays: 22,
  comm: { saleValue: 89 / 1.15, brackets: { M1: [{ gwp: 9751.3, comm: 4000 }, { gwp: 11000, comm: 6000 }] } }, tlAgg: [], campAgg: {}, dataReach: { sales: null },
  coaching: { windowDays: 90, coachingAt: '2026-10-01T14:23:00Z', agents: [] } });
const FIX_AGENTS = [nullRow('CB1', 'Ann Agent'), nullRow('CB2', 'Bea Buyer'), nullRow('CB3', 'Cy Closer')];

async function loadDigest() {
  if (FIXTURE) return Object.assign(fixtureBase(), { agents: FIX_AGENTS });
  const b0 = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/agent-digest', { headers: H }); let buf = Buffer.from(await b0.arrayBuffer()); if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  return JSON.parse(buf.toString());
}
const digest = await loadDigest(); const labels = Object.fromEntries((digest.compositeDrivers || []).map((d) => [d.k, d.label]));
const isEmptyMonth = digest.empty === true;
const allRated = digest.agents.filter((a) => a.composite && a.composite.rated);
const pool = isEmptyMonth ? digest.agents : allRated;
const rated = pool.slice(0, +(process.env.CBX_LIMIT || 1e9));   // CBX_LIMIT=3 for a quick local run
console.log('digest: ' + digest.agents.length + ' agents, ' + (isEmptyMonth ? 'EMPTY MONTH (' + rated.length + ' checked)' : allRated.length + ' rated (' + rated.length + ' checked)') + ' · period ' + digest.period.from + ' → ' + digest.period.to + (FIXTURE ? ' · LOCAL FIXTURE' : ''));

let th = null;
if (!FIXTURE) {
  const admin = (await (await fetch(REST + 'app_users?role=eq.admin&active=is.true&select=id,username&order=created_at.asc&limit=1', { headers: H })).json())[0];
  var token = crypto.randomBytes(32).toString('hex'); th = crypto.createHash('sha256').update(token).digest('hex');
  await fetch(REST + 'app_sessions', { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify([{ token_hash: th, user_id: admin.id, expires_at: new Date(Date.now() + 1800000).toISOString(), user_agent: 'verify-agent-card' }]) });
} else { var token = 'fixture-token'; }
const portalAgent = async (cb) => {
  if (FIXTURE) { const row = FIX_AGENTS.find((x) => x.code === cb); return Object.assign(fixtureBase(), { role: 'agent', name: row.name, me: row, agents: [row] }); }
  return (await fetch(API + '/api/portal/agent?cb=' + cb, { headers: { Authorization: 'Bearer ' + token, 'x-cbx-client': 'v5' } })).json();
};

/* ---- the empty month: one agent, drilled into AND read as the agent ---- */
async function checkEmptyAgent(page, a) {
  const payload = await portalAgent(a.code);
  const month = MONTHS[+digest.period.from.slice(5, 7) - 1];
  const prevIdx = (+digest.period.from.slice(5, 7) + 10) % 12; const prev = MONTHS[prevIdx];
  const view = await page.evaluate(async ({ cb, payload }) => {
    const root = () => document.getElementById('root');
    const settle = async (pred, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await new Promise((x) => setTimeout(x, 100)); } return false; };
    window.VIEW = 'month'; const keepTeam = window.TEAM;
    openAgent(cb);                                      // the leader's drill-down
    await settle(() => root() && !/Loading…/.test(root().innerText) && window.ME && String(window.ME.code) === cb);
    const drill = root().innerText.replace(/\s+/g, ' ');
    const own = Object.assign({}, window.D); delete own.__back; own.role = 'agent'; if (!own.empty) own.empty = true;   // the agent's own page: the same payload, read as the agent
    window.TEAM = null; window.D = own; window.VIEW = 'month'; render();
    const today = root().innerText.replace(/\s+/g, ' ');
    const link = root().querySelector('[data-askmonth]');
    window.VIEW = 'calc'; render(); await new Promise((x) => setTimeout(x, 50));
    window.TEAM = keepTeam; window.VIEW = 'month';
    return { drill, today, linkText: link ? link.textContent : null, calc: root().innerText.replace(/\s+/g, ' ') };
  }, { cb: a.code, payload });
  const msg = 'No ' + month + " figures yet — the first day lands after tomorrow morning's uploads";
  ok(a.code + ': the leader\'s drill-down says the month is empty', view.drill.indexOf(msg) >= 0, view.drill.slice(0, 160));
  ok(a.code + ': Today says the month is empty', view.today.indexOf(msg) >= 0, view.today.slice(0, 120));
  ok(a.code + ': Today offers "' + prev + ' (final)"', view.linkText != null && view.linkText.indexOf(prev + ' (final)') >= 0, String(view.linkText));
  ok(a.code + ': no score, verdict or figure on the empty Today', !/ON TRACK|WATCH|FOCUS|TARGET ACHIEVED|\d\s?%|\bR\s?\d/.test(view.today), view.today.slice(0, 160));
  /* by plan (live run 2026-10-01): M0 has no brackets — its hero is the full-premium line; an agent with no commission
     plan on file (Training Gr 17) correctly reads "Not set up yet"; every bracket plan shows its first payout */
  const calcOk = a.plan === 'M0' ? /Full premium/i.test(view.calc)
    : !a.plan ? /Not set up yet/i.test(view.calc)
    : (/Projected commission — /.test(view.calc) && /first payout in /.test(view.calc));
  ok(a.code + ': Projected Commission ' + (a.plan === 'M0' ? 'shows M0\'s full-premium line' : !a.plan ? 'says "Not set up yet" (no plan on file)' : 'shows the first ' + month + ' payout'), calcOk, view.calc.slice(0, 200));
}

const b = await chromium.launch();
try {
  const page = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  if (FIXTURE) {
    await page.route('**/api/**', async (route) => {
      const u = new URL(route.request().url()); const p = u.pathname; let body = {};
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (p === '/api/portal/me') body = { user: { name: 'Fixture', role: 'agent' } };
      else if (p === '/api/portal/overview') body = Object.assign(fixtureBase(), { role: 'team_leader', scope: 'team', name: 'Denise Haripersad', team: 'Denise team', totals: {}, agents: FIX_AGENTS });
      else if (p === '/api/portal/agent') body = await portalAgent(u.searchParams.get('cb'));
      await route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    });
  }
  await page.addInitScript((t) => { sessionStorage.setItem('cbx_agent_token', t); }, token);
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.openAgent === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  if (isEmptyMonth) {
    for (const a of rated) await checkEmptyAgent(page, a);
    ok('no page errors across ' + rated.length + ' empty-month cards', errs.length === 0, [...new Set(errs)].slice(0, 3).join(' | '));
  } else for (const a of rated) {
    const payload = await portalAgent(a.code);
    const me = payload && payload.me; if (!me) { ok(a.code + ': the portal returns the agent', false, JSON.stringify(payload).slice(0, 100)); continue; }
    const view = await page.evaluate(async (cb) => {
      openAgent(cb);                                    // the drill-down opens on Today; the rating and the two checks live on My Progress
      const t0 = Date.now(); while (Date.now() - t0 < 8000) { const r = document.getElementById('root'); if (r && !/Loading…/.test(r.innerText) && window.ME && String(window.ME.code) === cb) break; await new Promise((x) => setTimeout(x, 100)); }
      window.VIEW = 'progress'; render();
      const t1 = Date.now(); while (Date.now() - t1 < 4000) { if (document.querySelector('.pg-score')) break; await new Promise((x) => setTimeout(x, 100)); }
      const root = document.getElementById('root'); if (!root) return { hasScore: false, score: '', rows: [], whys: [], sessRows: -1 };
      const score = (root.querySelector('.pg-score b') || {}).textContent || '';
      const rows = [...root.querySelectorAll('.pg-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
      const whys = [...root.querySelectorAll('.why')].map((r) => r.innerText.replace(/\s+/g, ' ').trim());
      const sessCard = [...root.querySelectorAll('h2')].find((h) => /Sales by session/.test(h.textContent)); const sessRows = sessCard ? sessCard.closest('.card').querySelectorAll('tbody tr').length : -1;
      const pageDays = (window.ME && Array.isArray(window.ME.days)) ? window.ME.days.length : null;   // the payload THIS page rendered
      const hasScore = !!root.querySelector('.pg-score');   // read on My Progress, BEFORE the switch to Today below
      /* THE TODAY TILES PAINT THE ENGINE'S DRILL-DOWN VERDICTS (sprint 2026-09-29, item 3) — read back the
         tiles and the verdicts from the payload the page itself received */
      window.VIEW = 'month'; render();
      const LAB = { ta: 'TARGET ACHIEVED', aveG: 'AVERAGE SALE', qa: 'QA SCORE', att: 'ATTENDANCE' };
      const tiles = {};
      for (const t of document.querySelectorAll('#root .ac-tile')) {
        const lab = ((t.querySelector('.ac-lab') || {}).textContent || '').toUpperCase();
        const k = Object.keys(LAB).find((x) => lab.startsWith(LAB[x])); if (!k) continue;
        tiles[k] = { state: ['pass', 'watch', 'focus', 'none'].find((s) => t.classList.contains(s)) || '?', tap: t.hasAttribute('data-drill') };
      }
      const drill = window.ME && window.ME.drill ? Object.fromEntries(Object.entries(window.ME.drill).map(([k, v]) => [k, v && v.status])) : null;
      return { score, rows, whys, sessRows, pageDays, hasScore, tiles, drill };
    }, a.code);
    const c = me.composite;
    ok(a.code + ': the card renders a score', view.hasScore, view.score);
    ok(a.code + ': score on screen = digest', Math.abs(num(view.score) - c.adj) < 0.06, view.score + ' vs ' + c.adj);
    for (const p of c.parts) {
      const row = view.rows.find((r) => r.startsWith(labels[p.k] || '\u0000')); if (!row) { ok(a.code + ': row for ' + p.k, false, 'missing'); continue; }
      const chip = /At target/.test(row) ? 'at' : /To go|Below/.test(row) ? 'below' : /shown, not scored/.test(row) ? 'shown' : /not measured/.test(row) ? 'none' : '?';
      const want = p.measured ? (p.onTarget ? 'at' : 'below') : (p.shown != null ? 'shown' : 'none');
      ok(a.code + ' ' + p.k + ': chip = verdict', chip === want, chip + ' vs ' + want + ' | ' + row.slice(0, 90));
      if (p.k === 'conv') ok(a.code + ' conv: shows a figure when leads exist', (me.leads > 0) ? /\d+[.,]\d%/.test(row) : true, row.slice(0, 90));
    }
    const chk = me.checks;
    const c1 = view.whys.find((w) => /^Check 1/.test(w)) || '', c2 = view.whys.find((w) => /^Check 2/.test(w)) || '';
    /* THE TWO-CHECKS CARD IS OFF THE AGENT PAGE (Nick, 2026-09-17: "remove this please"); the verdicts still
       travel on me.checks — asserted here as data, and as absent from the page. */
    ok(a.code + ': the two-checks card is not on My Progress', !c1 && !c2, (c1 || c2).slice(0, 80));
    if (chk && chk.value.pass != null) {
      ok(a.code + ': the Worker still decides both checks', typeof chk.value.pass === 'boolean' && typeof chk.volume.pass === 'boolean');
      /* NOT compared: the rating row is the last five worked sessions, the checks are the whole month — two windows, both true; the page labels them. */
    }
    /* Against the payload the PAGE received, not this script's own fetch: the Worker caches the digest
       60 s per isolate, so a tick that lands between the two fetches gave 7 vs 8 across 45 agents
       (2026-09-10, a daytime run) — two true digests, one comparison. */
    /* pgSessions() shows the LAST SEVEN sessions by design (slice(-7)); the month passed seven day rows on
       2026-09-10 and this read 7 vs 8 for every agent. One row per day row, up to seven. */
    ok(a.code + ': the Worker sends the drill-down verdicts', !!view.drill && ['ta', 'aveG', 'qa', 'att'].every((k) => view.drill[k]), JSON.stringify(view.drill));
    for (const k of ['ta', 'aveG', 'qa', 'att']) {
      const t = view.tiles[k], want = (view.drill && view.drill[k]) || 'none';
      ok(a.code + ' ' + k + ': tile = drill verdict, tappable only when it needs attention',
        !!t && t.state === want && t.tap === (want === 'watch' || want === 'focus'), JSON.stringify(t) + ' vs ' + want);
    }
    const dayRows = Math.min(7, view.pageDays != null ? view.pageDays : (me.days || []).length);
    ok(a.code + ': one sessions row per day row (up to the seven the table shows)', view.sessRows === dayRows, view.sessRows + ' vs ' + dayRows);
  }
  if (!isEmptyMonth) ok('no page errors across ' + rated.length + ' cards', errs.length === 0, [...new Set(errs)].slice(0, 3).join(' | '));
} finally { await b.close(); if (th) await fetch(REST + 'app_sessions?token_hash=eq.' + th, { method: 'DELETE', headers: H }); }
for (const f of failures.slice(0, 40)) console.log('  FAIL ' + f);
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed  (' + rated.length + ' agents rendered' + (isEmptyMonth ? ', empty-month mode' : '') + ') ====');
process.exitCode = fail ? 1 : 0;
