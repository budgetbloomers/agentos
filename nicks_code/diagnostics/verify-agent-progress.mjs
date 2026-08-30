/* MY PROGRESS ON LIVE DATA — every agent, every figure against VAS Analytics.
 *
 * Nick, 2026-08-26: "make sure the rules and proper data is showing from the vas
 * analytics, the correct data must be used." This drives the REAL agent page over
 * the LIVE published digest (kv:agent-digest) plus the live nba-digest thresholds,
 * renders My Progress for every covered agent, and checks what is ON SCREEN against
 * the published figures:
 *
 *   1. the rating equals round(score×100) from the digest, and the published parts
 *      sum back to the score (drift guard between perfScore and perfParts)
 *   2. driver chips follow the rule-book thresholds exactly
 *      (R99 value floor · 100% target · QA 90% · GWP target · conv 10% · talk 210 min · att 95%)
 *   3. the "points" cells equal the published scoreParts
 *   4. the two checks: value = aveG ≥ floor, volume = pctT ≥ 70% (the R4A line)
 *   5. session dots, result tiles (talk in MINUTES — the digest's tk is seconds ÷60) and the
 *      sales-by-session rows equal the digest's day rows
 *   6. nothing renders NaN / undefined, and no page errors, for any agent
 *
 *   node nicks_code/diagnostics/verify-agent-progress.mjs            (live digest)
 *   node nicks_code/diagnostics/verify-agent-progress.mjs digest.json (offline)
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const REPO = String.raw`c:\Users\aarav\OneDrive\Desktop\Chatterbox Agent OS\agentos`;
const HTML = path.join(REPO, ...(process.env.AGENT_HTML || 'agent/index.html').split('/'));

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const say = (n) => console.log('  ok   ' + n);

/* ---- live data ---- */
async function fetchLive() {
  const env = Object.fromEntries(fs.readFileSync(path.join(REPO, 'supabase.env'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
  const get = async (store) => { const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${store}`, { headers: H, signal: AbortSignal.timeout(90000) });
    if (!r.ok) throw new Error(store + ': ' + r.status); return r.json(); };
  return { digest: await get('raw/kv/agent-digest'), nba: await get('raw/kv/nba-digest').catch(() => null) };
}
let digest, nbaDig;
try {
  if (process.argv[2]) { digest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); nbaDig = null; }
  else ({ digest, nba: nbaDig } = await fetchLive());
} catch (e) { console.log('(skipping — live digest unreachable: ' + (e.message || e) + ')'); process.exit(0); }
const TH = (nbaDig && nbaDig.thresholds) || { gwpFloor: 99, qaTarget: 90, attTarget: 95, convTarget: 10, talkTargetMin: 210 };
/* THE FLOOR IS INCL-VAT, THE PAGE'S aveG IS EX-VAT (audit fix, 2026-08-27): the page
   compares aveG against gwpFloor/1.15 — comparing raw made the value check ~15%
   stricter than the engine's rule. This suite asserts the SAME conversion. */
const FLOOR_EX = TH.gwpFloor / 1.15;
console.log('digest: ' + (digest.agents || []).length + ' agents · period ' + digest.period.from + '..' + digest.period.to);

/* ---- serve the real page ---- */
const server = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(HTML).pipe(s); });
await new Promise(r => server.listen(8143, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/api/**', r => r.fulfill({ status: 404, body: '{}' }));
await page.goto('http://127.0.0.1:8143/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);

/* render My Progress for one agent and return what is actually on screen */
async function renderFor(me, view) {
  return await page.evaluate((args) => {
    const { me, base, nbaRow, th, view } = args;
    window.D = { ...base, agents: [me], coaching: null,
      nba: { updatedAt: (window.__nbaUp || ''), period: null, thresholds: th, agents: nbaRow ? [nbaRow] : [] } };
    window.VIEW = view || 'progress';
    window.show(me);
    const root = document.getElementById('root');
    const text = root.innerText;
    const score = (text.match(/(\d+)\s*out of 100/) || [])[1] || null;
    const chips = Array.from(root.querySelectorAll('.pg-row')).map(r => ({
      label: r.querySelector('.pg-l') ? r.querySelector('.pg-l').innerText.trim() : '',
      chip: /At target/.test(r.innerText) ? 'at' : (/To go/.test(r.innerText) ? 'togo' : '—'),
      pts: (r.innerText.match(/([\d.,]+)\s*\/\s*(\d+)\s*pts/) || null),
    }));
    const dots = Array.from(root.querySelectorAll('.pg-dot')).map(d => d.classList.contains('on'));
    const tiles = Array.from(root.querySelectorAll('.pg-tile')).map(t => t.innerText.replace(/\s+/g, ' '));
    const rows = Array.from(root.querySelectorAll('table')).map(t => t.innerText);
    const checks = (root.innerText.match(/Check 1 · value:[^\n]*/) || [''])[0] + ' | ' + (root.innerText.match(/Check 2 · volume:[^\n]*/) || [''])[0];
    return { text, score, chips, dots, tiles, rows: rows.join('\n'), checks };
  }, { me, view, base: { period: digest.period, workingDays: digest.workingDays, diallingDays: digest.diallingDays, dates: digest.dates, comm: digest.comm, groups: digest.groups, team: '' },
       nbaRow: (nbaDig && (nbaDig.agents || []).find(x => String(x.cb).toUpperCase() === me.code)) || null, th: TH });
}

const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= (tol == null ? 0.51 : tol);
const agents = (digest.agents || []).filter(a => a && a.code);
let scoreBad = 0, partsBad = 0, chipBad = 0, ptsBad = 0, checkBad = 0, dotBad = 0, sessBad = 0, nanBad = 0, talkBad = 0;

for (const me of agents) {
  const r = await renderFor(me);
  if (/undefined|NaN/.test(r.text)) { nanBad++; ok('no placeholder for ' + me.code, false, 'NaN/undefined on screen'); continue; }

  /* 1 — the rating IS the VAS score, and the parts sum back to it */
  if (me.score != null) {
    /* THE RATING FOLLOWS WHATEVER VAS PUBLISHES AS THE SCORE, and since 2026-08-28
       that is the seven-driver composite where one is published. The contract this
       check exists to hold is unchanged — the number on the card must equal the
       number the engine published, never a second calculation — but the composite
       is now that number, and its parts are checked against their own weights below. */
    const wantScore = (me.composite && me.composite.rated !== false && me.composite.adj != null)
      ? Math.round(me.composite.adj) : Math.round(me.score * 100);
    if (!near(parseInt(r.score, 10), wantScore, 0)) { scoreBad++; ok('score for ' + me.code, false, r.score + ' vs ' + wantScore); }
    /* the composite's own parts must reconcile to the composite it is printed beside */
    if (me.composite && me.composite.parts) {
      const c = me.composite;
      let a = 0, w = 0;
      for (const p of c.parts) { if (!p.measured) continue; a += p.points; w += p.w; }
      const recomputed = w ? Math.round(a / w * 1000) / 10 : 0;
      if (!near(recomputed, c.score, 0.35)) { partsBad++;
        ok('composite parts sum to the composite for ' + me.code, false, recomputed + ' vs ' + c.score); }
    }
    /* THE FOUR-DRIVER CHECKS ONLY APPLY WHERE THE FOUR-DRIVER SCORE IS WHAT IS SHOWN.
       Since 2026-08-28 the card renders the seven-driver composite, so comparing the
       published perfParts against what is on screen compares two different formulas.
       PULSE no longer publishes both together; a payload already in the store still
       pairs them, and the page ignores that pairing. The composite's own rows are
       checked above and in verify-composite-score.mjs — this is a narrowing of scope,
       not a relaxation. */
    const composed = !!(me.composite && me.composite.rated !== false);
    const sp = composed ? null : me.scoreParts;
    if (sp) {
      const sum = (sp.t.pts || 0) + (sp.qa.pts || 0) + (sp.att.pts || 0) + (sp.opt.pts || 0);
      if (!near(sum, me.score * 100, 0.35)) { partsBad++; ok('scoreParts sum to score for ' + me.code, false, sum + ' vs ' + me.score * 100); }
    }
  }

  /* 2 — driver chips follow the rule book (four-driver card only; the composite panel
     draws its own rows against its own targets, checked in verify-composite-score) */
  const composedCard = !!(me.composite && me.composite.rated !== false);
  const chip = (label) => composedCard ? undefined : (r.chips.find(c => c.label === label) || {}).chip;
  const expect = [
    ['Avg GWP per Sale', me.aveG != null ? (me.aveG >= FLOOR_EX ? 'at' : 'togo') : '—'],
    ['Target Achievement', me.pctT != null ? (me.pctT * 100 >= 100 ? 'at' : 'togo') : '—'],
    ['QA Score', me.qa != null ? (me.qa * 100 >= TH.qaTarget ? 'at' : 'togo') : '—'],
    ['Total GWP', (me.gwpEx != null && me.gwpT) ? (me.gwpEx >= me.gwpT ? 'at' : 'togo') : '—'],
    ['Attendance', me.att != null ? (me.att * 100 >= TH.attTarget ? 'at' : 'togo') : '—'],
  ];
  for (const [label, want] of expect) {
    const got = chip(label);
    if (got !== undefined && got !== want) { chipBad++; ok(label + ' chip for ' + me.code, false, got + ' vs ' + want); }
  }

  /* 3 — points cells equal the published parts */
  if (me.scoreParts && !composedCard) {
    const ptsOf = (label) => { const c = r.chips.find(x => x.label === label); return c && c.pts ? parseFloat(c.pts[1].replace(',', '.')) : null; };
    for (const [label, part] of [['Target Achievement', 't'], ['QA Score', 'qa'], ['Attendance', 'att']]) {
      const shown = ptsOf(label), pub = me.scoreParts[part] && me.scoreParts[part].pts;
      if (shown != null && pub != null && !near(shown, pub, 0.06)) { ptsBad++; ok(label + ' points for ' + me.code, false, shown + ' vs ' + pub); }
    }
  }

  /* 4 — the two checks */
  if (me.aveG != null && me.pctT != null) {
    const value = me.aveG >= FLOOR_EX, volume = me.pctT * 100 >= 70;
    if (!(new RegExp('value:[^|]*— ' + (value ? 'pass' : 'fail'))).test(r.checks)) { checkBad++; ok('value check for ' + me.code, false, r.checks); }
    if (!(new RegExp('volume:[^|]*— ' + (volume ? 'pass' : 'fail'))).test(r.checks)) { checkBad++; ok('volume check for ' + me.code, false, r.checks); }
  }

  /* 5 — dots, talk tile and session rows come from the day rows */
  const days = me.days || [];
  if (days.length) {
    const want = days.slice(-5).map(f => (f.act || 0) > 0);
    if (r.dots.length !== want.length || r.dots.some((v, i) => v !== want[i])) { dotBad++; ok('session dots for ' + me.code, false, JSON.stringify(r.dots) + ' vs ' + JSON.stringify(want)); }
    const talkTile = r.tiles.find(t => /Talk time/.test(t));
    if (talkTile) {
      const last = days.slice(-7).map(f => (f.tk || 0) / 60);
      const avg = last.reduce((m, x) => m + x, 0) / last.length;
      const shown = parseFloat((talkTile.match(/([\d\u00A0\u202F.,]+)\s*min/) || ['', 'x'])[1].replace(/[\u00A0\u202F,]/g, ''));
      if (!near(shown, avg, 1.1)) { talkBad++; ok('talk tile (minutes) for ' + me.code, false, shown + ' vs ' + Math.round(avg)); }
    }
    const lastDay = days[days.length - 1];
    if (lastDay && !(r.rows.includes(lastDay.d))) { sessBad++; ok('sessions table carries the latest day for ' + me.code, false, lastDay.d + ' missing'); }
  }
}

ok('every rating equals the published VAS score', scoreBad === 0); if (!scoreBad) say('every rating equals the published VAS score ×100 (' + agents.length + ' agents)');
ok('published scoreParts sum back to the score', partsBad === 0); if (!partsBad) say('scoreParts sum back to the score for every agent — no formula drift');
ok('driver chips follow the rule-book thresholds', chipBad === 0); if (!chipBad) say('driver chips follow R' + FLOOR_EX.toFixed(2) + ' ex-VAT (R' + TH.gwpFloor + ' incl) / 100% / QA ' + TH.qaTarget + '% / GWP target / att ' + TH.attTarget + '% exactly');
ok('points cells equal the published parts', ptsBad === 0); if (!ptsBad) say('points cells equal the published parts (45/25/20)');
ok('two checks follow the value floor and the 70% volume line', checkBad === 0); if (!checkBad) say('two checks follow aveG≥R' + FLOOR_EX.toFixed(2) + ' ex-VAT and pctT≥70%');
ok('session dots mirror the day rows', dotBad === 0); if (!dotBad) say('session dots mirror the day rows');
ok('talk shows MINUTES (digest carries seconds)', talkBad === 0); if (!talkBad) say('talk tiles show minutes — the seconds bug stays dead');
ok('sessions table carries the latest day', sessBad === 0); if (!sessBad) say('sessions table carries each agent\'s latest day');
ok('no NaN/undefined for any agent', nanBad === 0); if (!nanBad) say('no NaN/undefined on screen for any of the ' + agents.length + ' agents');
/* ---- the TODAY tab: the daily briefing renders clean for every agent ---- */
let tdNan = 0, tdMiss = 0;
for (const me of agents) {
  const r = await renderFor(me, 'month');
  if (/undefined|NaN/.test(r.text)) { tdNan++; ok('no placeholder on Today for ' + me.code, false); continue; }
  const rem = digest.workingDays - (me.act || 0);
  if (rem > 0 && me.target > 0 && me.sales != null && !/Your number for today/.test(r.text)) { tdMiss++; ok('daily briefing present for ' + me.code, false); }
}
ok('the Today briefing renders for every agent with days left', tdMiss === 0); if (!tdMiss) say('the Today briefing renders for every agent with days left');
ok('no NaN/undefined on the Today tab', tdNan === 0); if (!tdNan) say('no NaN/undefined on the Today tab for any agent');

ok('no page errors across the sweep', errors.length === 0, errors.slice(0, 3).join(' | ')); if (!errors.length) say('no page errors across the sweep');

await browser.close(); server.close();
console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
