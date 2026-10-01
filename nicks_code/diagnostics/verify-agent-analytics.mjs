#!/usr/bin/env node
/**
 * verify-agent-analytics.mjs — the proof for Agent Analytics (/agent/).
 *
 * Run:  node nicks_code/diagnostics/verify-agent-analytics.mjs
 *
 * Two things are checked, and both are the kind that fail silently in production:
 *
 * A. THE COMMISSION MATHS IS THE SAME MATHS.
 *    The Comms Calculator is a React/TanStack app. Agent Analytics cannot run it
 *    — the suite has no bundler and the CSP allows no CDN but cdnjs — so its
 *    logic was PORTED into agent/index.html. A port that quietly disagrees with
 *    the original pays people the wrong number, which is the worst bug this
 *    project could ship. So:
 *      1. the original source is kept verbatim at agent/reference/*.tsx;
 *      2. the 32 bracket values and the sale value are read OUT of that source
 *         numerically — they can never drift, because nothing here retypes them;
 *      3. every formula line of the original is asserted to still read exactly
 *         as it did, so a change to the original breaks this test rather than
 *         slipping past it;
 *      4. a reference implementation transcribed from those cited lines is run
 *         head-to-head against the shipped commCalc() over a full input grid.
 *
 * B. THE AGENT LINK REACHES AGENT ANALYTICS AND NOTHING ELSE.
 *    Structural assertions over the shipped files: no auth-gate, no route to any
 *    other app, one endpoint only, and the Worker's key check sitting above the
 *    session gate rather than below it.
 *
 * Exit code 0 = safe to ship. Non-zero = do not deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');            // agentos/
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let fails = 0, checks = 0;
const PENDING = [];   // promise-based checks (the live refresh) — awaited before the summary
const ok = (m) => { checks++; console.log('  \x1b[32m✓\x1b[0m ' + m); };
const bad = (m, d) => { checks++; fails++; console.log('  \x1b[31m✗\x1b[0m ' + m + (d ? '\n      ' + d : '')); };
const head = (m) => console.log('\n\x1b[1m' + m + '\x1b[0m');

const TSX = rd('agent', 'reference', 'original-index.tsx');
const TSX0 = rd('agent', 'reference', 'original-m0.tsx');
const PAGE = rd('agent', 'index.html');
const PULSE = rd('nicks_code', 'index.html');
const WORKER = rd('worker', 'src', 'index.mjs');
const OPS = rd('Chatterbox_AgentOS_Analytics.html');

/* ══════════════════════════════════════════════════════════════════════════
   A1 · The original's formulas must still read exactly as the port assumes.
   If one of these fails, the ORIGINAL changed — re-read it before touching
   anything else, because the port is now describing a calculator that no
   longer exists.
   ══════════════════════════════════════════════════════════════════════════ */
head('A1 · The original calculator still says what the port assumes');

const FORMULAS = [
  ['SALE_VALUE is 89 ÷ 1.15 ex-VAT',            /const SALE_VALUE = 89 \/ 1\.15;/],
  ['averageGWP = gwp ÷ completed days',          /averageGWP: gwp \/ cDays,/],
  ['premiumProjected = avg × total days',        /premiumProjected: \(gwp \/ cDays\) \* tDays,/],
  ['remainingDays = total − completed',          /remainingDays: tDays - cDays,/],
  ['invalid input guard returns null',           /if \(isNaN\(cDays\) \|\| isNaN\(tDays\) \|\| isNaN\(gwp\) \|\| cDays <= 0\) return null;/],
  ['commission is pro-rata on the bracket rate', /return activeBracket \? projected \* \(activeBracket\.comm \/ activeBracket\.gwp\) : 0;/],
  ['active bracket = highest one reached',       /for \(let i = brackets\.length - 1; i >= 0; i--\) \{\s*if \(projected >= brackets\[i\]\.gwp\) \{/],
  ['next bracket = first above the projection',  /if \(projected < bracket\.gwp\) \{\s*nextBracket = bracket;/],
  ['gap is measured against ACTUAL gwp',         /const gap = nextBracket\.gwp - gwp;/],
  ['needed per day = gap ÷ remaining days',      /const neededPerDay = metrics\.remainingDays > 0 \? gap \/ metrics\.remainingDays : null;/],
  ['what-if adds sale value × remaining days',   /const extraGWP = extraSales \* SALE_VALUE \* remDays;/],
  ['what-if projection = projected + extra',     /const newProjected = metrics\.premiumProjected \+ extraGWP;/],
  ['bracket gap per remaining day',              /const gwpGapPerRemainingDay = remDays > 0 \? gwpGapTotal \/ remDays : null;/],
];
for (const [label, re] of FORMULAS) {
  re.test(TSX) ? ok(label) : bad('ORIGINAL CHANGED — ' + label, 'not found in agent/reference/original-index.tsx');
}
/M0 commission equals 100% of premium projected/.test(TSX0)
  ? ok('M0 pays 100% of the projected premium')
  : bad('ORIGINAL CHANGED — M0 rule', 'not found in agent/reference/original-m0.tsx');

/* ══════════════════════════════════════════════════════════════════════════
   A2 · Bracket values, read out of the original — never retyped here.
   ══════════════════════════════════════════════════════════════════════════ */
head('A2 · Bracket tables read straight out of the original source');

function extractBrackets(src) {
  const start = src.indexOf('const BRACKETS');
  if (start < 0) throw new Error('BRACKETS not found in the original source');
  const open = src.indexOf('{', src.indexOf('=', start));
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(open, end + 1);
  const out = {};
  const planRe = /(M1|M2|EXP_COURTESY|EXP_CUDDLE|EXP_DOWNUP):\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = planRe.exec(body))) {
    out[m[1]] = [...m[2].matchAll(/\{\s*gwp:\s*([\d.]+),\s*comm:\s*([\d.]+)\s*\}/g)]
      .map((r) => ({ gwp: parseFloat(r[1]), comm: parseFloat(r[2]) }));
  }
  return out;
}
const ORIG_BRACKETS = extractBrackets(TSX);
const ORIG_SALE_VALUE = (() => {
  const m = TSX.match(/const SALE_VALUE = ([\d.]+) \/ ([\d.]+);/);
  return parseFloat(m[1]) / parseFloat(m[2]);
})();
/* Per-plan sale values (2026-09-03): Download & Test sells a R40 product, so its what-if
   adds 40 ÷ 1.15 a sale. Read out of the original's SALE_VALUES map, never retyped. */
const ORIG_SALE_VALUES = (() => {
  const out = {};
  const blk = TSX.match(/const SALE_VALUES[^=]*=\s*\{([^}]*)\}/);
  if (blk) for (const m of blk[1].matchAll(/([A-Z0-9_]+):\s*([\d.]+)\s*\/\s*([\d.]+)/g)) out[m[1]] = parseFloat(m[2]) / parseFloat(m[3]);
  return out;
})();
const saleValueFor = (plan) => ORIG_SALE_VALUES[plan] ?? ORIG_SALE_VALUE;

const PLANS = ['M1', 'M2', 'EXP_COURTESY', 'EXP_CUDDLE', 'EXP_DOWNUP'];
/* September 2026: EXP_CUDDLE grew to 10 brackets (SPD 6–15); EXP_DOWNUP (Download & Test,
   R40 product) joined with 8; the rest stay at 8. */
const PLAN_SIZES = { M1: 8, M2: 8, EXP_COURTESY: 8, EXP_CUDDLE: 10, EXP_DOWNUP: 8 };
for (const p of PLANS) {
  (ORIG_BRACKETS[p] || []).length === PLAN_SIZES[p]
    ? ok(`${p}: ${PLAN_SIZES[p]} brackets read from the original`)
    : bad(`${p}: expected ${PLAN_SIZES[p]} brackets, read ${(ORIG_BRACKETS[p] || []).length}`);
}

/* PULSE republishes those brackets in COMM_RULES so the agent page can use them
   without shipping the calculator's source. That copy must be identical to the
   original, value for value — this is the check that catches a typo'd cent. */
const pulseComm = (() => {
  const i = PULSE.indexOf('const COMM_RULES=');
  if (i < 0) return null;
  const open = PULSE.indexOf('{', i);
  let d = 0, end = -1;
  for (let j = open; j < PULSE.length; j++) {
    if (PULSE[j] === '{') d++;
    else if (PULSE[j] === '}') { d--; if (d === 0) { end = j; break; } }
  }
  // eslint-disable-next-line no-eval
  return eval('(' + PULSE.slice(open, end + 1) + ')');
})();
if (!pulseComm) bad('COMM_RULES not found in nicks_code/index.html');
else {
  let drift = [];
  for (const p of PLANS) {
    const a = ORIG_BRACKETS[p] || [], b = pulseComm.brackets[p] || [];
    if (a.length !== b.length) { drift.push(`${p}: ${a.length} vs ${b.length} brackets`); continue; }
    a.forEach((x, i) => {
      if (Math.abs(x.gwp - b[i].gwp) > 1e-9) drift.push(`${p}[${i}].gwp ${x.gwp} vs ${b[i].gwp}`);
      if (Math.abs(x.comm - b[i].comm) > 1e-9) drift.push(`${p}[${i}].comm ${x.comm} vs ${b[i].comm}`);
    });
  }
  drift.length
    ? bad('COMM_RULES has drifted from the original brackets', drift.join('\n      '))
    : ok('COMM_RULES brackets match the original exactly (42 values)');
  Math.abs(pulseComm.saleValue - ORIG_SALE_VALUE) < 1e-12
    ? ok('COMM_RULES.saleValue matches the original (89 ÷ 1.15)')
    : bad(`COMM_RULES.saleValue ${pulseComm.saleValue} vs original ${ORIG_SALE_VALUE}`);
  const svDrift = Object.keys({ ...ORIG_SALE_VALUES, ...(pulseComm.saleValues || {}) })
    .filter((k) => Math.abs((ORIG_SALE_VALUES[k] ?? -1) - ((pulseComm.saleValues || {})[k] ?? -2)) > 1e-12);
  svDrift.length ? bad('COMM_RULES.saleValues drifted from the original: ' + svDrift.join(', '))
                 : ok('COMM_RULES.saleValues matches the original (Download & Test = 40 ÷ 1.15)');
}

/* ══════════════════════════════════════════════════════════════════════════
   A3 · Reference implementation, transcribed from the lines asserted in A1.
   ══════════════════════════════════════════════════════════════════════════ */
function refCalc(plan, completedDaysS, totalDaysS, totalGWPS, extraSales) {
  const SALE_VALUE = saleValueFor(plan);        // the plan's own sale value (index.tsx SALE_VALUES), else 89 ÷ 1.15
  const cDays = parseFloat(completedDaysS), tDays = parseFloat(totalDaysS), gwp = parseFloat(totalGWPS);
  if (isNaN(cDays) || isNaN(tDays) || isNaN(gwp) || cDays <= 0) return null;      // index.tsx:96
  const metrics = { averageGWP: gwp / cDays, premiumProjected: (gwp / cDays) * tDays, remainingDays: tDays - cDays };

  if (plan === 'M0') {                                                            // m0.tsx:214-219
    const p = metrics.premiumProjected + extraSales * SALE_VALUE * metrics.remainingDays;
    return { plan: 'M0', metrics, projection: metrics.premiumProjected, nextMove: null, table: null, nextTarget: null,
      whatIf: { newPremium: p, newComm: p, extraVsCurrent: p - metrics.premiumProjected } };
  }

  const brackets = ORIG_BRACKETS[plan];
  if (!brackets) return null;
  const projected = metrics.premiumProjected;

  const getComm = (proj) => {                                                     // index.tsx:104-116
    let active = null;
    for (let i = brackets.length - 1; i >= 0; i--) { if (proj >= brackets[i].gwp) { active = brackets[i]; break; } }
    return active ? proj * (active.comm / active.gwp) : 0;
  };
  const projection = getComm(projected);

  let nextMove = null, nb = null;                                                 // index.tsx:123-141
  for (const b of brackets) { if (projected < b.gwp) { nb = b; break; } }
  if (nb) {
    const gap = nb.gwp - gwp;
    nextMove = { nextComm: nb.comm, gap, neededPerDay: metrics.remainingDays > 0 ? gap / metrics.remainingDays : null,
      extraComm: nb.comm - (projection ?? 0) };
  }

  const extraGWP = extraSales * SALE_VALUE * metrics.remainingDays;               // index.tsx:145-154
  const newProjected = metrics.premiumProjected + extraGWP;
  const newComm = getComm(newProjected);
  const whatIf = { newPremium: newProjected, newComm, extraVsCurrent: newComm - (projection ?? 0) };

  let activeIndex = -1;                                                           // index.tsx:164-170
  for (let i = brackets.length - 1; i >= 0; i--) { if (projected >= brackets[i].gwp) { activeIndex = i; break; } }
  const remDays = metrics.remainingDays;
  const table = brackets.map((bracket, index) => {                                // index.tsx:172-187
    const gwpGapTotal = bracket.gwp - gwp;
    const gwpGapPerRemainingDay = remDays > 0 ? gwpGapTotal / remDays : null;
    let status = 'not_reached';
    if (index === activeIndex) status = 'current';
    else if (activeIndex >= 0 && index < activeIndex) status = 'beat';
    else if (gwpGapTotal <= 0) status = 'beat';
    else if (activeIndex >= 0 && index === activeIndex + 1) status = 'next_target';
    return { gwp: bracket.gwp, comm: bracket.comm, targetIncVat: bracket.gwp, gwpGapTotal, gwpGapPerRemainingDay, status };
  });

  let nextTarget;                                                                 // index.tsx:190-218
  const ai = table.findIndex((r) => r.status === 'current');
  if (ai === -1) nextTarget = { kind: 'none', perDay: table[0].gwpGapPerRemainingDay };
  else if (ai >= brackets.length - 1) nextTarget = { kind: 'top' };
  else {
    const n2 = brackets[ai + 1], gap2 = n2.gwp - parseFloat(totalGWPS);
    nextTarget = { kind: 'next', bracketNumber: ai + 2, perDay: remDays > 0 ? gap2 / remDays : null,
      nextComm: n2.comm, extra: n2.comm - (projection ?? 0) };
  }
  return { plan, metrics, projection, nextMove, whatIf, table, nextTarget };
}

/* ══════════════════════════════════════════════════════════════════════════
   A4 · The SHIPPED implementation, lifted out of agent/index.html.
   ══════════════════════════════════════════════════════════════════════════ */
head('A4 · Shipped commCalc() vs the original, across the full input grid');

const shipped = (() => {
  const a = PAGE.indexOf('function commissionFor(');
  const marker = '\n/* ===================== inline sparkline';
  const b = PAGE.indexOf(marker, a);
  if (a < 0 || b < 0) throw new Error('could not locate commissionFor/commCalc in agent/index.html');
  const src = PAGE.slice(a, b);
  // eslint-disable-next-line no-new-func
  return new Function(src + '\nreturn commCalc;')();
})();
const SHIPPED_RULES = { saleValue: ORIG_SALE_VALUE, saleValues: ORIG_SALE_VALUES, brackets: ORIG_BRACKETS };

const near = (x, y) => {
  if (x == null && y == null) return true;
  if (x == null || y == null) return false;
  if (typeof x === 'number' && typeof y === 'number') {
    if (!isFinite(x) && !isFinite(y)) return String(x) === String(y);
    return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  }
  return x === y;
};
function diffObj(a, b, trail, out) {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (!near(a, b)) out.push(`${trail}: shipped ${JSON.stringify(a)} vs original ${JSON.stringify(b)}`);
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diffObj(a[k], b[k], trail ? trail + '.' + k : k, out);
}

const GRID_GWP = [0, 1, 500, 4063.04, 4000, 6500.87, 9751.3, 14626.96, 15000, 21127.83, 24378.26, 25000, 99999];
const GRID_TDAYS = [20, 21, 22];
const GRID_EXTRA = [1, 2, 3];
const ALL_PLANS = [...PLANS, 'M0'];

let cases = 0; const mismatches = [];
for (const plan of ALL_PLANS)
  for (let cD = 1; cD <= 22; cD++)
    for (const tD of GRID_TDAYS)
      for (const gwp of GRID_GWP)
        for (const ex of GRID_EXTRA) {
          cases++;
          const s = shipped(plan, String(cD), String(tD), String(gwp), ex, SHIPPED_RULES);
          const r = refCalc(plan, String(cD), String(tD), String(gwp), ex);
          const out = [];
          if ((s == null) !== (r == null)) out.push(`null-ness: shipped ${s == null} vs original ${r == null}`);
          else if (s) {
            // `brackets` is carried on the shipped result for rendering only; not a computed output.
            const { brackets: _b, ...sc } = s;
            diffObj(sc, r, '', out);
          }
          if (out.length && mismatches.length < 12)
            mismatches.push(`${plan} cDays=${cD} tDays=${tD} gwp=${gwp} +${ex}\n      ` + out.join('\n      '));
        }

mismatches.length
  ? bad(`${mismatches.length}+ mismatches across ${cases} cases`, mismatches.join('\n\n      '))
  : ok(`${cases.toLocaleString('en-ZA')} cases — every field identical to the original`);

/* Invalid input must refuse, not guess. */
{
  const badIn = [['M1', '0', '20', '5000'], ['M1', '', '20', '5000'], ['M1', '5', '20', ''], ['M1', '-3', '20', '5000']];
  const allNull = badIn.every(([p, c, t, g]) => shipped(p, c, t, g, 1, SHIPPED_RULES) === null && refCalc(p, c, t, g, 1) === null);
  allNull ? ok('invalid input returns null in both, never a guessed number')
          : bad('invalid input handling differs between the port and the original');
}

/* ══════════════════════════════════════════════════════════════════════════
   B · The link reaches Agent Analytics and nothing else.
   ══════════════════════════════════════════════════════════════════════════ */
head('B · The agent link is walled off from the rest of the suite');

/* These checks are about what the page DOES, so comments are stripped first —
   the file documents its own boundary at length, and prose describing the rule
   must not be mistaken for a breach of it. */
const CODE = PAGE
  .replace(/<!--[\s\S]*?-->/g, ' ')      // HTML comments
  .replace(/\/\*[\s\S]*?\*\//g, ' ')     // block comments (JS and CSS)
  .replace(/(^|[^:"'])\/\/[^\n]*/g, '$1'); // line comments, leaving https:// alone

!/auth-gate\.js/.test(CODE)
  ? ok('agent/index.html does not load auth-gate.js — agents never see a login')
  : bad('agent/index.html loads auth-gate.js', 'agents would be shown a login box and a permissions model they have no account in');

{
  // Any navigation OUT of this app is the failure this check exists to catch.
  const escapes = [];
  const linkRe = /(?:\b(?:href|action)\s*=|location\.href\s*=|location\.replace\()\s*["']([^"']+)["']/g;
  let m;
  while ((m = linkRe.exec(CODE))) {
    const u = m[1];
    /* THE COACHING HUB IS THE ONE ALLOWED WAY OUT (Nick, 2026-08-24). A team
       leader RECORDS coaching there, so a page that shows the sessions but cannot
       reach the form is a dead end for them. It is not part of the management
       suite, which is what this check exists to wall off — Ops, VAS and Tracker
       stay banned below, and the agent-only assertion further down proves an
       agent never sees this link. */
    if (/^(https:\/\/fonts\.(googleapis|gstatic)\.com|https:\/\/(coaching-hub-psi|kpi-hub-rho)\.vercel\.app\/?|#|mailto:|tel:)/.test(u)) continue;
    escapes.push(u);
  }
  for (const p of ['/pulse/', 'pulse/index.html', '/tracker/', 'tracker/index.html', 'Ops Analytics', 'VAS Analytics', 'Tracker Analytics'])
    if (CODE.includes(p)) escapes.push(p);
  escapes.length
    ? bad('agent/index.html can reach another app', escapes.join(', '))
    : ok('no route out: no link, redirect or mention of Ops, VAS or Tracker');

  /* The permitted outbound link must be safe and must be team-leader-only. Checked on
     the ANCHORS themselves since 2026-08-27 — the old `var hubLink=` variable went when
     the merged coaching page kept exactly one footer link. */
  const hubAnchors = PAGE.match(/<a [^>]*coaching-hub-psi[^>]*>/g) || [];
  (hubAnchors.length >= 1 && hubAnchors.every(a => /rel=\\?"noopener/.test(a)))
    ? ok('every Coaching Hub anchor carries rel=noopener — the opened page cannot drive this tab')
    : bad('a Coaching Hub anchor is missing rel=noopener (or the link is gone entirely)', hubAnchors.join(' · ') || '(none found)');
  (PAGE.match(/coaching-hub-psi/g) || []).length <= 2
    ? ok('the Coaching Hub link appears only on team leader pages')
    : bad('the Coaching Hub URL appears more often than expected — check where each one renders');
  !/coaching-hub-psi/.test(PAGE.slice(PAGE.indexOf('function coachPageAgent()'), PAGE.indexOf('function coachPageTeam()')))
    ? ok('the Coaching Hub link is on the team leader page only — never an agent\'s')
    : bad('an agent can reach the Coaching Hub — they have nothing to record there and would see other teams');
}

{
  /* Every endpoint the page can reach. It calls them through the api() helper
     now (api('/api/…')) rather than building API+'…' at each site, so read both
     shapes — otherwise this check silently inspects nothing and passes. */
  const eps = [...new Set([
    ...[...PAGE.matchAll(/API\s*\+\s*['"]([^'"?]+)/g)].map((m) => m[1]),
    ...[...PAGE.matchAll(/\bapi\(\s*['"]([^'"?]+)/g)].map((m) => m[1]),
  ])];
  eps.length
    ? ok(`the page's API surface is readable (${eps.length} endpoints)`)
    : bad('could not read any endpoint out of the page — this check is inspecting nothing');
  /* THE PAGE'S ENTIRE API SURFACE. Agent Analytics signs people in now, so the
     shared-link digest route is gone from this page and the portal routes take its
     place. Every one of these is scoped by the Worker from the SESSION — not one of
     them accepts an identity supplied by the page. */
  const allowed = new Set(['/api/login', '/api/logout', '/api/password',
    '/api/portal/me', '/api/portal/overview', '/api/portal/agent', '/api/portal/ask',
    /* The team leader's Variance and Lead management slices (2026-09-21): cut by the Worker's
       authorise() from the SESSION, refused to agents and campaign managers. */
    '/api/portal/tl/reports',
    /* The hub proxies. The browser never reaches Convex; these forward to it with
       the leader id taken from the session. */
    '/api/portal/hub/', '/api/portal/hub/coaching', '/api/portal/hub/kpi',
    /* The Help Center + coaching-action status (2026-08-26). HighLevel-backed via
       the Worker (help.mjs) — the key never reaches the page; request = agents
       only, the rest = team leaders scoped to their own team. These are in the
       Worker's PORTAL_ALLOWED deliberately. */
    '/api/portal/help/request', '/api/portal/help/list', '/api/portal/help/detail',
    '/api/portal/help/stage', '/api/portal/help/actions', '/api/portal/help/action',
    '/api/portal/help/fails', '/api/portal/help/fail', '/api/portal/help/fail-detail',
    '/api/portal/help/sync-coaching', '/api/portal/help/mine', '/api/portal/help/close',
    /* Nick's six steps + the leader's icon (sprint 2026-09-29): the agent confirms (agents only, their
       own request); the pulse feeds the Help Center icon (team leaders, scoped like the list). */
    '/api/portal/help/confirm', '/api/portal/help/pulse',
    /* Campaign Assistance (2026-08-30) — the team-leader → campaign-manager
       pipeline (assist.mjs). Same posture as the Help Center: HighLevel-backed
       via the Worker, request = team leaders only, the register and actions
       role-gated in the handlers. In the Worker's PORTAL_ALLOWED deliberately. */
    '/api/portal/cm/request', '/api/portal/cm/assist', '/api/portal/cm/detail',
    '/api/portal/cm/act', '/api/portal/cm/eod',
    /* Campaign target settings (Nick, 2026-09-01) — Dalwin's dials. GET is the
       page, POST is one validated change; both live in the Worker's cm block and
       are refused for every role but campaign_manager and admin. */
    '/api/portal/cm/settings']);
  /* Wimpy ordering left this page on 2026-09-10 for its own app (/wimpy/); the
     old portal routes answer 410 and must not be referenced here any more. */
  const extra = eps.filter((e) => !allowed.has(e));
  extra.length
    ? bad('agent/index.html calls an endpoint it should not', extra.join(', '))
    : ok('calls only the sign-in and the three scoped portal routes');
  eps.includes('/api/portal/overview')
    ? ok('the page loads its data from the scoped portal route')
    : bad('the page does not call /api/portal/overview');
  /* TOP PERFORMERS (Nick, 2026-09-15: "the top performers … add that to the agent view"): the one
     card that names colleagues — drawn from the Worker's `top` payload, never computed on the page. */
  /function topHTML\(\)/.test(PAGE) && /whatIfHTML\(c\)\+topHTML\(\)/.test(PAGE) && !/trackHTML\(\)\+topHTML/.test(PAGE) && !/standHTML\(\)\+topHTML/.test(PAGE)
    ? ok('the Top performers card is on Projected Commission only (Nick, 15 Sep)')
    : bad('the Top performers card is not on Projected Commission, or is still on another page');
  !/Top of your team/.test(PAGE)
    ? ok('…and carries no team list')
    : bad('topHTML still renders a team list');
  /* DONE = OFF THE LIST (Nick, 2026-09-17): a closed Coaching Actions record removes the agent from My Team's ladder and counts; the HighLevel record stays. */
  PAGE.includes('function actDone(a)') && PAGE.includes('var list=everyone.filter(function(a){return !actDone(a);});')
    ? ok('My Team drops an agent whose coaching action is Done (the HighLevel record stays)')
    : bad('a Done coaching action does not remove the agent from My Team');
  /D\.top\b/.test(PAGE) && !/rankAll|sort\(.*gwpEx/.test(PAGE.slice(PAGE.indexOf('function topHTML'), PAGE.indexOf('function topHTML') + 1800))
    ? ok('…and only draws what it is handed (no ranking computed in the browser)')
    : bad('topHTML ranks agents in the browser — the Worker decides who travels');
  eps.includes('/api/agent-digest')
    ? bad('the page still calls the retired shared-link digest route')
    : ok('the retired shared-link digest route is gone from the page');
  // CODE, not PAGE — the file documents the boundary in prose and must not trip on it.
  /\/api\/(kv|bi|eod|ask|campaign-stats)/.test(CODE)
    ? bad('the page reaches for a management data route')
    : ok('the page never reaches /api/kv, /api/bi, /api/eod or /api/ask');

  /* THE SESSION KEY MUST NOT BE THE MANAGEMENT ONE.
     The whole suite is one origin, so sessionStorage is shared across /, /pulse/,
     /tracker/ and /agent/. While this page read 'cbx_token' it silently adopted
     whatever management session was open in the tab — staff opened Agent
     Analytics and were straight in as themselves, with the sign-in screen never
     appearing. The sign-in is the entire access model here, so a shared key is a
     hole, not a convenience. */
  /var TKEY='cbx_agent_token'/.test(PAGE)
    ? ok('Agent Analytics uses its own session key, so the sign-in always appears')
    : bad('the page shares the management session key — staff will skip the sign-in entirely');
  /sessionStorage\.(get|set|remove)Item\(\s*['"]cbx_token['"]/.test(PAGE)
    ? bad('the page still touches the management session key directly')
    : ok('the page never reads or writes the management session token');
}

{
  const digest = WORKER.indexOf("path === '/api/agent-digest'");
  const sess = WORKER.indexOf('const user = await session(DB, req)');
  const deny = WORKER.indexOf("if (!user) return json({ error: 'Sign in required.' }, 401)");
  const lock = Math.max(WORKER.indexOf('if (PORTAL_ROLES.has(user.role) && !PORTAL_ALLOWED.has(path))'),
    WORKER.indexOf('if (portalOnly(user) && !PORTAL_ALLOWED.has(path))'));   // portalOnly(): the lock follows the GRANT since 2026-09-07
  const linkRt = WORKER.indexOf("path === '/api/agent-link'");

  /* THE ORDER IS THE SECURITY. Session check first, role lockdown immediately
     after it, every data route after that — so a portal session is filtered
     before it can reach anything at all. */
  sess > 0 && deny > sess && lock > deny
    ? ok('Worker: the role lockdown sits immediately after the session gate')
    : bad('Worker: the role lockdown is missing or on the wrong side of the session gate');
  linkRt > deny
    ? ok('Worker: /api/agent-link stays behind the session gate')
    : bad('Worker: /api/agent-link is not staff-only');

  /* THE RETIRED SHARE LINK. It authorised the entire 130-agent digest on a URL
     parameter. With per-agent logins that is exactly the hole the login was
     added to close, so the key must no longer authorise anything. */
  /* Bounded at the NEXT route, or the check reads /api/agent-link's own use of
     agent_link_key and reports a hole that is not there. */
  const body = WORKER.slice(digest, WORKER.indexOf("if (path === '/api/", digest + 40));
  /* Look for the CODE that reads the key, not the word — the handler's comment
     explains the retirement and names `agent_link_key`, and a prose match here
     would report a hole that no longer exists. */
  /DB\.select\(`rules\?key=eq\.agent_link_key/.test(body) || /let allowed = !!user;/.test(body)
    ? bad('Worker: /api/agent-digest still authorises on the shared link key')
    : ok('Worker: the shared link key no longer authorises the digest');
  /if \(!user\) return json\(\{ error: 'Please sign in with your CB number\.' \}, 401\);/.test(body)
    ? ok('Worker: the digest route now demands a session')
    : bad('Worker: the digest route does not demand a session');

  /* THE COACHING HUB ROUTES. Both dashboards have called these since the coaching
     layer shipped; their absence WAS the outage — an unknown path fell through to
     the session gate and answered 401, which read as an expired token. */
  WORKER.includes("path === '/api/coaching'") && WORKER.includes("path === '/api/coaching/summary'")
    ? ok('Worker: the Coaching Hub routes exist')
    : bad('Worker: /api/coaching or /api/coaching/summary is missing — the Hub will 401 again');
  /Coaching Hub unreachable: /.test(WORKER)
    ? ok('Worker: a Hub outage answers 502, never a silent empty list')
    : bad('Worker: a Hub outage is not distinguishable from "no coaching"');
}

{
  /* The link key must not be guessable. 24 random bytes = 192 bits; anything
     short or time-derived would make the "not a public URL" claim false. */
  const T = rd('tools', 'agent-link.mjs');
  /crypto\.randomBytes\(24\)/.test(T)
    ? ok('link key is 24 random bytes (192 bits) — not guessable')
    : bad('link key is not 24 bytes of CSPRNG output');
  /--rotate/.test(T) && /resolution=merge-duplicates/.test(T)
    ? ok('the link can be rotated, killing every copy already sent')
    : bad('no rotation path for the link key');
  const WK = WORKER.slice(WORKER.indexOf("path === '/api/agent-link'"));
  /crypto\.getRandomValues\(b\)/.test(WK) && /new Uint8Array\(24\)/.test(WK)
    ? ok('the in-app share box mints the same 24-byte key')
    : bad('the in-app key mint does not match the tool');
}

{
  // The digest is what leaves the building. Fields that must never appear in it.
  const i = PULSE.indexOf('function agentDigestPayload()');
  const j = PULSE.indexOf('function agentDigestPayload', i + 10);
  const body = PULSE.slice(i, i > 0 ? PULSE.indexOf('\n}', PULSE.indexOf('return {', i)) + 2 : i);
  /* `canc` was on this list and came off DELIBERATELY (2026-08-24) when team
     leaders got a Month to Date tab mirroring VAS Analytics' own MTD table, which
     carries Cancellations and % of Cancellations. A team leader is accountable for
     that number; an agent must still never see it, because the one standing rule
     of their page is that nothing is framed as failure. So the ban moved from the
     DIGEST to the RENDER layer — mtdRows(forAgent) drops both cancellation rows —
     and the check below proves an agent's page cannot show them. Everything else
     here stays banned outright. */
  const banned = ['crit', 'coach', 'risk', 'discipl', 'contact', 'phone', 'email', 'account_no', 'case_number'];
  const found = banned.filter((b) => new RegExp('\\b\\w*' + b + '\\w*\\s*:', 'i').test(body));
  found.length
    ? bad('the published digest carries fields that must not leave the building', found.join(', '))
    : ok('the published digest carries agent-facing fields only');
  void j;

  /* The render-layer half of the cancellations rule. A team leader's Month to
     Date must carry them (it mirrors the management table); an agent's must not. */
  const mtd = PAGE.slice(PAGE.indexOf('function mtdRows('), PAGE.indexOf('function pctPill('));
  /return forAgent \? rows\.filter\(/.test(mtd)
    ? ok('cancellations are dropped from an agent\'s own Month to Date')
    : bad('an agent\'s Month to Date is not filtered — cancellations would show on their page');
  /* Labels renamed 2026-08-26 (Nick): the table carries the management dashboard's own
     column names row for row — '%'+' of Cancellations', not the old '%'+' Canc to Sales'. */
  /Cancellations/.test(mtd) && /% of Cancellations/.test(mtd)
    ? ok('a team leader\'s Month to Date still carries both cancellation rows')
    : bad('the team leader Month to Date no longer mirrors the management table');
  /* An agent has no Month to Date at all — it is the management table and belongs
     to a team leader. The filtered row set stays in mtdRows() for the drilldown
     case, but the surest guarantee is that the tab is not in an agent's nav. */
  const navBlk = PAGE.slice(PAGE.indexOf('function navFor('), PAGE.indexOf('function freshHTML('));
  const agentNav = navBlk.slice(navBlk.lastIndexOf('return ['));
  /'mtd'/.test(agentNav)
    ? bad('an agent still has a Month to date tab')
    : ok('an agent has no Month to date tab — it is a team leader page');
  /* ---- 2026-08-26 (Nick): Score + Weekly + Daily in the team leader view ---- */
  /\['Score',/.test(mtd)
    ? ok('the Month to Date table carries the Score row (the published 0-100, never recomputed)')
    : bad('the Score row is missing from Month to Date');
  /* 2026-09-10: the figure itself now travels in the digest (engine-decided); the division
     survives only as the fallback for an older digest and must keep the employed basis. */
  /o\.emp\?o\.talk\/o\.emp/.test(PAGE.slice(PAGE.indexOf('function aveTalkOf('), PAGE.indexOf('function mtdRows(')))
    ? ok('Ave Talk Time divides by EMPLOYED shifts, as the management dashboard does')
    : bad('Ave Talk Time is not on the employed-shift basis');
  /* ---- 2026-09-10 (Nick): ONE Reports tab, three sub-tabs ----
     "there must be a tab called reports and its sub tabs must be month to date, daily,
     weekly". The sidebar carries a single Reports entry; the three views keep their ids and
     are chosen on the page (REPORT_TABS), in that order. */
  const tabsBlk = PAGE.slice(PAGE.indexOf('var REPORT_TABS='), PAGE.indexOf('function pageMTD('));
  /'reports','Reports'/.test(navBlk)
    ? ok('a team leader has a Reports tab')
    : bad('the team leader Reports tab is missing');
  /\['mtd_team','Month to date'\],\['daily_team','Daily'\],\['weekly_team','Weekly'\]/.test(tabsBlk)
    ? ok('its sub-tabs are Month to date · Daily · Weekly, in that order')
    : bad('the Reports sub-tabs are not Month to date / Daily / Weekly');
  /* 2026-09-21 (Nick): the sub-tabs ALSO open under Reports in the sidebar — the nav entry carries
     REPORT_TABS (CM_REPORT_TABS for the manager) and sidebarHTML paints them as .nav-item.sub */
  const sideBlk = PAGE.slice(PAGE.indexOf('function sidebarHTML('), PAGE.indexOf('function shell('));
  (/'reports','Reports',ICON\.mtd,REPORT_TABS/.test(navBlk) && /'cm_reports','Reports',ICON\.mtd,CM_REPORT_TABS/.test(navBlk)
    && /nav-item sub/.test(sideBlk) && /k\[0\]===VIEW\?' active'/.test(sideBlk))
    ? ok('the Reports entry opens its sub-tabs in the sidebar (team leader and campaign manager), the current one lit')
    : bad('the sidebar no longer nests the Reports sub-tabs');
  (!/'weekly_team','Weekly'/.test(navBlk) && !/'daily_team','Daily'/.test(navBlk) && !/'mtd_team','Month to date'/.test(navBlk))
    ? ok('Month to date, Weekly and Daily are no longer separate sidebar entries')
    : bad('a report view is still its own sidebar entry');
  (!/'weekly_team'/.test(agentNav) && !/'daily_team'/.test(agentNav))
    ? ok('an agent has neither — they are team leader pages')
    : bad('an agent can reach the team Weekly/Daily pages');
  /function pageWeeklyTeam\(\)/.test(PAGE) && /function pageDailyTeam\(\)/.test(PAGE)
    ? ok('both pages exist')
    : bad('a team Weekly/Daily page is missing');
  /daysPublished\(\)/.test(PAGE) && /do not carry day-level detail yet/.test(PAGE)
    ? ok('an old digest without day rows degrades to a plain sentence, never an empty table')
    : bad('the day-level degrade path is missing');
  /no shift credited/.test(PAGE.slice(PAGE.indexOf('function pageDailyTeam')))
    ? ok('the daily view keeps the talk-with-no-shift anomaly flag')
    : bad('the daily anomaly flag is missing');
  /* ---- 2026-08-26 (Nick), REVERSED the same day: no month filter ----
     The portal always opens on the LIVE month - Month to Date, Weekly and Daily read the
     current month from its 1st to the latest published day, and there is nothing to pick.
     The Worker keeps understanding ?month= and VAS keeps freezing each month's digest, so
     a look-back later is a UI change only; the page itself must send no month anywhere. */
  (!/monthQS/.test(PAGE) && !/monthPick/.test(PAGE) && !/var MONTH=/.test(PAGE))
    ? ok('no month filter: no picker, no month state, no month parameter')
    : bad('a remnant of the month filter is still in the page');
  /api\('\/api\/portal\/overview'\)/.test(PAGE)
    ? ok('the overview is always requested plain - the live month')
    : bad('the overview request is not plain');
  (PAGE.match(/portal\/agent\?cb='\+encodeURIComponent\(cb\)\)/g) || []).length === 2
    ? ok('both drilldown call sites are plain too')
    : bad('a drilldown call site still carries something extra');
  /* ---- 2026-08-26 (Nick): the period label ends where the DATA ends ----
     "1 - 31 August" over 25 days of data reads as a promise the page cannot keep; every
     daily upload must visibly move the label forward. prettyPeriod reads the engine's own
     day list, so the label and the tables can never disagree about how far the month runs. */
  (function(){
    var pp = PAGE.slice(PAGE.indexOf('function prettyPeriod'), PAGE.indexOf('function stamp'));
    /D\.dates\[D\.dates\.length-1\]/.test(pp)
      ? ok('the period label ends on the last day that carries data, not the calendar end')
      : bad('prettyPeriod still prints the calendar month end');
    /last>=D\.period\.from&&last<=D\.period\.to/.test(pp)
      ? ok('and a day outside the period can never widen the label')
      : bad('the data-day is not bounded to the period');
  })();
  /* ---- 2026-08-26 (Nick): MTD / Weekly / Daily draw ONLY from the scoped team list ----
     The Worker hands a team leader their own team and nothing else (verify-agent-portal D3/D4
     proves that against the live digest); these three views must never reach past D.agents to
     any other collection, or the server-side scope stops being the whole story. */
  (function(){
    /* Since 2026-09-11 the three pages and the export all read through coveredAgents(), which
       is the ONE place the list is taken from — so that helper must read D.agents, and every
       report builder must go through it and never touch notCovered. */
    const fnBody = (fn) => { const i = PAGE.indexOf(fn); return i < 0 ? null : PAGE.slice(i, PAGE.indexOf('\nfunction ', i + 10)); };
    const ca = fnBody('function coveredAgents()');
    (ca && /\(D\.agents\|\|\[\]\)/.test(ca) && ca.indexOf('notCovered') < 0)
      ? ok('coveredAgents() reads only the scoped team list (D.agents)')
      : bad('coveredAgents() does not read D.agents alone');
    for (const fn of ['function reportMTD()', 'function reportWeekly()', 'function reportDaily(',
                      'function pageMTD()', 'function pageWeeklyTeam()', 'function pageDailyTeam()']) {
      const body = fnBody(fn);
      (body && /coveredAgents\(\)|reportMTD\(\)|reportDaily\(|reportWeekly\(\)/.test(body) && body.indexOf('notCovered') < 0 && body.indexOf('D.agents') < 0)
        ? ok(fn.replace('function ', '').replace(/\(\)?$/, '') + ' reads the team through coveredAgents() only')
        : bad(fn + ' reaches past the scoped list');
    }
  })();
  /* ---- 2026-09-10 (Nick): the team leader's table matches VAS Analytics' cell for cell ----
     A side-by-side render of both apps over the same digest found the same numbers printed
     differently: Tenure was missing, talk read "2h 32m" against VAS's "152,0" minutes, the
     Grand Total added cents where VAS adds the rand each row prints, and the whole "Team
     Leaders" block (Employed HC, Agents on Target, campaign total) was absent. Every value is
     READ from the digest: PULSE publishes it, the Worker slices it, the page paints it. */
  const PORTAL = rd('worker', 'src', 'portal.mjs');
  /\['Tenure',/.test(mtd)
    ? ok('the Month to Date table carries the Tenure column VAS shows')
    : bad('Tenure is missing from Month to Date');
  /function aveTalkOf\(o\)\{ return o\.aveTalk!==undefined\?o\.aveTalk/.test(PAGE)
    ? ok('Ave Talk Time is read from the digest (the engine\'s null rule) — the division is only the old-digest fallback')
    : bad('Ave Talk Time is still divided on the page');
  /D\.talkUnit/.test(PAGE) && /talkHdr\('Ave Talk Time'\)/.test(mtd)
    ? ok('talk averages print in the rule book\'s unit (digest.talkUnit), as VAS prints them')
    : bad('talk averages ignore the rule book unit');
  /sum\('gwpEx',true\)/.test(PAGE.slice(PAGE.indexOf('function teamAgg(')))
    ? ok('the Grand Total adds the rand each row prints, as VAS totalRow does')
    : bad('the Grand Total sums cents — off by a rand from the VAS table');
  /function tlSummaryCard\(\)/.test(PAGE) && /Agents on Target/.test(PAGE) && /D\.summary/.test(PAGE)
    ? ok('the VAS "Team Leaders" block (Employed HC, Agents on Target, campaign total) is on the page, read from the digest')
    : bad('the team leader summary block is missing');
  /summary: teamSummary\(digest, auth\)/.test(PORTAL) && /digest\.tlAgg\.filter\(\(t\) => String\(t\.tl \|\| ''\)\.trim\(\) === team\)/.test(PORTAL)
    ? ok('the Worker slices the summary block to the authorised team')
    : bad('the Worker does not scope the summary block');
  /tlAgg:Object\.keys\(M\.tlAgg/.test(PULSE) && /wk:\(M\.weeks\|\|\[\]\)\.map/.test(PULSE) && /aveTalk:r2\(g\.aveTalk\),/.test(PULSE)
    ? ok('PULSE publishes the summary block, the weekly rows and the two talk averages')
    : bad('the digest does not carry the new figures');
  /a\.wk\|\|\[\]/.test(PAGE.slice(PAGE.indexOf('function reportWeekly('), PAGE.indexOf('function pageWeeklyTeam(')))
    ? ok('Weekly reads the engine\'s own per-week rows (a.wk), so it carries every VAS Weekly column')
    : bad('Weekly still re-derives its columns from day rows');

  /* ---- 2026-09-11 (Nick): "the month to date reports weekly, daily, month to date, for the team
     leader view must be exportable, and make sure it's not static — when the month to date in VAS
     Analytics is updated it is updated in the team leader view". Two things, both on the page:
     an .xlsx export built from the SAME column lists the tables are drawn from, and a re-ask of
     /api/portal/overview on a timer, on focus and on demand, applied in place. The rendering
     half is exercised below in section C with a stubbed Worker. */
  /<script src="\/xlsx\.full\.min\.js" defer><\/script>/.test(PAGE)
    ? ok('the page loads the same self-hosted SheetJS the VAS export uses, deferred')
    : bad('SheetJS is not loaded — Export cannot build a workbook');
  (function(){
    const ex = PAGE.slice(PAGE.indexOf('function exportReports('), PAGE.indexOf('\nfunction ', PAGE.indexOf('function exportReports(') + 10));
    (/reportMTD\(\)/.test(ex) && /reportTLSummary\(\)/.test(ex) && /reportWeekly\(\)/.test(ex) && /reportDaily\(which==='all'\)/.test(ex))
      ? ok('the export walks the same report builders the three pages render from — no second column list')
      : bad('the export builds its own columns');
    /XLSX\.writeFile\(wb,'TL '/.test(ex) ? ok('the workbook is written as an .xlsx named for the report, the team and the month') : bad('the export does not write an .xlsx');
    /data-export="'\+active\+'"/.test(PAGE) && /data-export="all"/.test(PAGE) && /id="repRefresh"/.test(PAGE)
      ? ok('every Reports sub-tab carries Export, Export all and Refresh in its toolbar')
      : bad('the Reports toolbar is missing a button');
  })();
  (function(){
    const lp = PAGE.slice(PAGE.indexOf('function loadPortal('), PAGE.indexOf('function notReported('));
    /startLiveRefresh\(\);[^\n]*return teamView\(\);/.test(lp) ? ok('a team payload starts the live re-ask the moment it loads') : bad('the live refresh is never started');
    /* the Help Center icon's pulse starts with the team view too (D5, sprint 2026-09-29) */
    /startHelpPulse\(\);[^\n]*return teamView\(\);/.test(lp) ? ok('a team payload starts the Help Center icon\'s pulse') : bad('the Help Center icon is never fed');
    /* D2 / item 6 (sprint 2026-09-29): an agent's own page re-asks too — it used to load once at sign-in */
    /startAgentRefresh\(\);\s*show\(D\.me\);/.test(lp) ? ok('an agent\'s page starts its own re-ask (focus + every 5 minutes)') : bad('an agent\'s page is still loaded once and never refreshed');
    /AGENT_LIVE_MS=300000/.test(PAGE) ? ok('the agent re-ask runs every 5 minutes while visible') : bad('the agent re-ask interval is not 5 minutes');
    /setInterval\(function\(\)\{ if\(!document\.hidden\)\{ refreshPortal\(false\); repTick\(\); \} \},LIVE_EVERY_MS\)/.test(lp)
      && /addEventListener\('visibilitychange'/.test(lp) && /addEventListener\('focus'/.test(lp)
      ? ok('the page re-asks on a timer while visible, when the tab comes back, and on focus')
      : bad('one of the refresh triggers is missing');
    /if\(!liveSafeToRender\(\)\)\{ LIVE\.pending=fresh;/.test(lp) && /if\(LIVE\.pending&&liveTeamScope\(\)&&liveSafeToRender\(\)\)/.test(PAGE)
      ? ok('a refresh that lands mid-form waits and is applied on the next safe render — never over a half-typed form')
      : bad('a background refresh can wipe an open form');
  })();

  /* ---- 2026-09-11 (Nick): the Score Journey — "a button ... must show the breakdown of the agent score",
     then "remove agent, its static just showing the team leaders and agents how to calculate the agent
     score". The poster as a STATIC explainer (Ayanda's example, 50,8, next goal 60), opened from one
     button on the rating card (agent view + team leader drill-down), one on My Team, one in the drawer.
     Nobody's real figures are on it; the seven weights are read from the rule book's driver list. */
  (function(){
    const jr = PAGE.slice(PAGE.indexOf('function journeyHTML('), PAGE.indexOf('function openScoreJourney('));
    (/journeyBtn\(ME\.code/.test(PAGE.slice(PAGE.indexOf('function pgComposite('), PAGE.indexOf('function pgRating(')))
      && /journeyBtn\(null,'How the score is made up'\)/.test(PAGE.slice(PAGE.indexOf('function pageMyTeam(')))
      && /journeyBtn\(null,'How the score works'\)/.test(PAGE.slice(PAGE.indexOf('function drawerHTML('))))
      ? ok('the Score Journey opens from the rating card, My Team and the drawer')
      : bad('a Score Journey button is missing');
    (!/a\.composite|p\.points|p\.available|c\.adj/.test(jr) && /Hi! I am <span>Ayanda\./.test(jr) && /83,4 out of 90 = 93% of target/.test(jr))
      ? ok('the panel is static — Ayanda\'s poster example, no agent figures')
      : bad('the Score Journey still draws an agent\'s own figures');
    /D&&D\.compositeDrivers/.test(jr)
      ? ok('the seven weights are read from the rule book driver list')
      : bad('the card weights are not read from the digest');
    /Nothing is taken away/.test(jr) && /COLLECT POINTS FROM 7 IMPORTANT THINGS/.test(jr) && /PASS THE HALFWAY LINE/.test(jr) && /NEXT GOAL: 60/.test(jr)
      ? ok('the four poster steps are on the panel')
      : bad('a poster step is missing from the Score Journey');
    ['gwpSale', 'targetAch', 'qa', 'gwpTotal', 'conv', 'talk', 'attendance'].every((k) => new RegExp(k + ':\\s*\\{t:').test(PAGE))
      ? ok('all seven drivers have a plain-English card')
      : bad('a driver has no card on the Score Journey');
    !/jPick/.test(PAGE)
      ? ok('no agent picker on the panel')
      : bad('the agent picker is still on the Score Journey');
  })();
}

/* THE NBA LAYER HAS NO SOURCE (Nick, 2026-08-25: "leave ops analytics, vas
   analytics and tracker analytics as is"). The decision ladder, composite and
   two-check status are computed by acStats/cfTier/acNBA/acComposite inside
   Chatterbox_AgentOS_Analytics.html and nothing else may compute them. A
   publisher there is the only way they can reach this app, and Ops is to stay
   untouched — so those screens state "Scores are not published yet" and will keep
   doing so. That honest empty state is asserted in the My Team render test below;
   the publisher checks that used to live here were removed with the publisher. */

{
  PULSE.includes("key=agent-digest")
    ? ok('PULSE publishes the digest to kv:agent-digest')
    : bad('PULSE does not publish the digest');
  /\['agent', 'agent', 'Agent Analytics'\]/.test(rd('tools', 'prepare-site.js'))
    ? ok('prepare-site.js deploys /agent/')
    : bad('prepare-site.js does not deploy /agent/');
}

{
  // The greeting must be South African time, not the device's.
  /timeZone:'Africa\/Johannesburg'/.test(PAGE)
    ? ok("greeting uses Africa/Johannesburg, not the viewer's clock")
    : bad('greeting does not pin South African time');
}

/* ══════════════════════════════════════════════════════════════════════════
   C · The page renders — every branch, without throwing.
   The whole app is one script over a synthetic digest. This catches the class
   of bug that only shows up on the one agent who has no QA score, or no target,
   or a campaign we have no commission model for: a thrown error there is a
   blank screen for that person and nobody else, which is exactly the kind of
   fault that never gets reported.
   ══════════════════════════════════════════════════════════════════════════ */
head('C · The page renders for every shape of agent');

function loadPage(fetchImpl) {
  const m = PAGE.match(/<script>\n"use strict";([\s\S]*?)<\/script>/);
  if (!m) throw new Error('could not find the page script');
  const src = m[1].replace(/\nboot\(\);\s*$/, '\n');            // do not auto-run the fetch
  const nodes = {};
  const mkEl = () => ({
    innerHTML: '', value: '', style: {}, classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, getAttribute: () => null,
    querySelectorAll: () => [], focus() {}, onclick: null,
  });
  const doc = {
    getElementById: (id) => (nodes[id] = nodes[id] || mkEl()),
    querySelectorAll: () => [],
    createElement: mkEl,
  };
  const store = {};
  const win = {
    location: { search: '?k=testkey' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    scrollTo() {},
  };
  const fn = new Function(
    'document', 'window', 'localStorage', 'location', 'fetch', 'URLSearchParams', 'setTimeout', 'Intl', 'console',
    src + '\nreturn {show,notReported,commCalc,heroHTML,doneHTML,trackHTML,standHTML,whatIfHTML,comsPage,coachHTML,coachTeamHTML,teamView,loginScreen,greeting,sastHour,prettyPeriod,setD:function(d){D=d},setMe:function(m){ME=m},setTeam:function(t){TEAM=t},setView:function(v){VIEW=v},'
    + 'getD:function(){return D},getView:function(){return VIEW},cellOf,reportMTD,reportWeekly,reportDaily,reportTLSummary,exportReports,refreshPortal,liveFiguresChanged,setDayFilter:function(d){DAY_FILTER=d},setForm:function(f){FORM=f},render,'
    + 'sidebarHTML,pgMyHelp,helpPage,setHelpUnread:function(n){HELP_UNREAD=n},setMyHelp:function(m){MYHELP=m},setHelpD:function(h){HELPD=h},'
    + 'agentKpis,drillPanelHTML,todayHTML,campaignSplitHTML,commissionSplitHTML,calcNow,calcNowInitial};'
  );
  return {
    api: fn(doc, win, win.localStorage, win.location, fetchImpl || (() => Promise.reject(new Error('no network in test'))),
      URLSearchParams, (f) => f, Intl, { log() {}, error() {} }),
    nodes,
    win,          // the page's window — a fixture pins window.__agentToday through it (see "Today precision")
  };
}

const { api: P, nodes: N, win: W } = loadPage();

const DIGEST = {
  v: 1, updatedAt: new Date().toISOString(),
  period: { from: '2026-08-01', to: '2026-08-31' }, diallingDays: 20,
  dates: ['2026-08-01', '2026-08-02', '2026-08-03'],
  /* days whose files have landed — the cap on "days worked" (2026-09-03); the
     fixtures' act values are all ≤ 16 so nothing here is capped by accident */
  daysWithData: 16,
  comm: { saleValue: ORIG_SALE_VALUE, brackets: ORIG_BRACKETS },
  groups: { 'Cuddle|Exp': { n: 4, gwpEx: 11500, sales: 16, pctT: 1.06 } },
  agents: [], notCovered: [],
};
const SHAPES = [
  ['a top performer with every badge', { code: 'CB1', name: 'Thulani Mbonambi', campaign: 'Cuddle', tenure: 'Exp', plan: 'EXP_CUDDLE',
    gwpEx: 21000, sales: 30, target: 20, pctT: 1.5, spd: 2.1, att: 1, qa: 0.97, aveG: 700, ref: 3, act: 14, emp: 14,
    rankCo: 1, nCo: 120, rankTeam: 1, nTeam: 9, trend: 'up', trendPct: 0.2,
    badges: [['🏆', 'Top earner company-wide'], ['🚀', '125%+ of target']], spark: [1, 3, 2] }],
  ['someone behind target', { code: 'CB2', name: 'Sipho Ndlovu', campaign: 'Courtesy', tenure: 'M1', plan: 'M1',
    gwpEx: 1800, sales: 4, target: 15, pctT: 0.27, spd: 0.4, att: 0.7, qa: 0.72, aveG: 450, ref: 0, act: 10, emp: 14,
    rankCo: 118, nCo: 120, rankTeam: 8, nTeam: 9, trend: 'down', trendPct: -0.3, badges: [], spark: [0, 1, 0] }],
  ['an M0 agent (no brackets)', { code: 'CB3', name: 'Nomsa Zulu', campaign: 'Nesting', tenure: 'M0', plan: 'M0',
    gwpEx: 2200, sales: 6, target: 8, pctT: 0.75, spd: 0.6, att: 0.95, qa: null, aveG: 366, ref: 0, act: 9, emp: 10,
    rankCo: 60, nCo: 120, rankTeam: 3, nTeam: 5, trend: 'flat', trendPct: null, badges: [], spark: [1, 1, 2] }],
  ['no commission model on file', { code: 'CB4', name: 'Lerato Dube', campaign: 'Cuddle', tenure: 'M1', plan: null,
    gwpEx: 3000, sales: 7, target: 12, pctT: 0.58, spd: 0.7, att: 0.9, qa: 0.8, aveG: 428, ref: 0, act: 10, emp: 12,
    rankCo: 70, nCo: 120, rankTeam: 4, nTeam: 6, trend: 'flat', trendPct: null, badges: [], spark: [1, 0, 1] }],
  ['a brand-new agent, nothing yet', { code: 'CB5', name: 'Ayanda Khumalo', campaign: 'Courtesy', tenure: 'M1', plan: 'M1',
    gwpEx: 0, sales: 0, target: 0, pctT: null, spd: null, att: null, qa: null, aveG: null, ref: 0, act: 0, emp: 0,
    rankCo: 120, nCo: 120, rankTeam: 9, nTeam: 9, trend: 'flat', trendPct: null, badges: [], spark: [] }],
  ['missing rank and group entirely', { code: 'CB6', name: 'Solo Agent', campaign: 'Cuddle', tenure: 'Exp', plan: 'EXP_CUDDLE',
    gwpEx: 9000, sales: 12, target: 15, pctT: 0.8, spd: 1, att: 0.9, qa: 0.9, aveG: 750, ref: 0, act: 12, emp: 13,
    rankCo: null, nCo: 1, rankTeam: null, nTeam: 0, trend: 'up', trendPct: 0.05, badges: [], spark: [1, 2] }],
];
DIGEST.agents = SHAPES.map((s) => s[1]);
P.setD(DIGEST);

for (const [label, agent] of SHAPES) {
  try {
    P.setMe(agent);
    P.show(agent);
    const html = N.root.innerHTML;
    if (!html || html.length < 500) throw new Error('rendered almost nothing (' + html.length + ' chars)');
    if (/undefined|NaN|\[object Object\]/.test(html))
      throw new Error('rendered a placeholder value: ' + (html.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [])[0]);
    if (html.indexOf(agent.name.split(' ')[0]) < 0) throw new Error('the agent’s own name is missing from the page');
    ok(`renders for ${label}`);
  } catch (e) {
    bad(`render failed for ${label}`, e.message);
  }
}

/* Nobody on the roster may hit a dead end. A Vehicle Tracking agent — 46 of the
   130 on the August roster — is not in the digest by design, and must be told
   why rather than shown "No match". */
const NOT_COVERED = [
  { code: 'CB16', name: 'Chireshi Nair', why: 'campaign', campaign: 'VT' },
  { code: 'CB99', name: 'Brand New', why: 'nodata', campaign: 'Courtesy' },
];
DIGEST.notCovered = NOT_COVERED;
for (const [label, entry] of [['a Vehicle Tracking agent', NOT_COVERED[0]], ['someone with no activity yet', NOT_COVERED[1]]]) {
  try {
    /* notReported() reads the payload the Worker builds for a signed-in agent
       whose CB number is on the roster but not in this period's figures. */
    P.setD({ ...DIGEST, role: 'agent', name: entry.name, cb: entry.code, notReported: entry, coaching: {} });
    P.notReported();
    const html = N.root.innerHTML;
    if (!html || html.length < 200) throw new Error('rendered almost nothing');
    if (/undefined|NaN|\[object Object\]/.test(html)) throw new Error('rendered a placeholder value');
    if (html.indexOf(entry.name.split(' ')[0]) < 0) throw new Error('their own name is missing');
    /* Strip data: URIs before looking for money. The AgentOS sidebar carries the
       logo as a base64 PNG, and base64 contains "R4"/"R9" by chance 69 times —
       which read as rand figures and failed this check on a page that has none.
       The assertion is right; it just must not see image bytes. */
    const visible = html.replace(/src="data:[^"]*"/g, 'src="#"');
    if (/R\s?\d/.test(visible)) throw new Error('a rand figure leaked onto a page that has no figures to show');
    ok(`gives a straight answer to ${label}`);
  } catch (e) {
    bad(`dead-end page for ${label}`, e.message);
  }
}
{
  /* No FIGURES may travel for these people. `tl` is on the allow-list because the
     Worker scopes a team leader on it and it is not a number — publishing who
     somebody reports to is the org chart, not their performance. */
  const allowed = new Set(['code', 'name', 'why', 'campaign', 'tl']);
  const stray = NOT_COVERED.flatMap((e) => Object.keys(e).filter((k) => !allowed.has(k)));
  const pulseSlice = PULSE.slice(PULSE.indexOf('const notCovered=[]'), PULSE.indexOf('return {', PULSE.indexOf('const notCovered=[]')));
  const pushed = (pulseSlice.match(/notCovered\.push\(\{([^}]*)\}/) || [])[1] || '';
  const keys = [...pushed.matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
  stray.length || keys.some((k) => !allowed.has(k))
    ? bad('the not-covered list carries more than a name', [...stray, ...keys.filter((k) => !allowed.has(k))].join(', '))
    : ok('the not-covered list carries name, code, reason and team — no figures');
}

/* THE SIGN-IN SCREEN. It asks for a CB number and a password and nothing else —
   no agent list, no names, nothing that lets a stranger enumerate the floor. */
try {
  P.loginScreen();
  const html = N.root.innerHTML;
  if (html.indexOf('CB number') < 0) throw new Error('does not ask for a CB number');
  if (!/type="password"/.test(html)) throw new Error('the password field is not a password field');
  if (/Sipho Ndlovu|Nomsa Zulu|Thulani/.test(html)) throw new Error('the sign-in screen names agents');
  P.loginScreen('Invalid username or password.');
  if (N.root.innerHTML.indexOf('Invalid username or password.') < 0) throw new Error('a failed sign-in shows no message');
  ok('the sign-in screen asks for CB number + password and lists nobody');
} catch (e) {
  bad('sign-in screen', e.message);
}

/* THE TEAM LEADER PAGE. Renders from the Worker's already-scoped payload, and
   the team total must be the team's sales over the team's target — not the mean
   of each agent's percentage. */
try {
  const team = [
    { code: 'CB1', name: 'Sipho Ndlovu', tl: 'A Leader', campaign: 'Courtesy', tenure: 'Exp', covered: true, gwpEx: 9000, sales: 100, target: 100, pctT: 1.0, spark: [1, 2, 3] },
    { code: 'CB2', name: 'Nomsa Zulu', tl: 'A Leader', campaign: 'Cuddle', tenure: 'M1', covered: true, gwpEx: 3000, sales: 30, target: 60, pctT: 0.5, spark: [0, 1, 1] },
  ];
  const payload = {
    ...DIGEST, role: 'team_leader', name: 'A Leader', team: 'A Leader', agents: team,
    totals: { agents: 2, reporting: 2, gwpEx: 12000, sales: 130, target: 160, pctT: 130 / 160, aveG: 92.31, att: 0.9, qa: 0.95, ref: 4, onTarget: 1 },
    spark: [1, 3, 4], coaching: { windowDays: 90, totals: { sessions: 3, agents: 1, scored: 0 }, agents: [{ code: 'CB1', name: 'Sipho Ndlovu', count: 3, last: '2026-08-20', themes: [{ key: 'gap.objection_handling', family: 'gap', shown: 3, scored: 0 }] }] },
  };
  /* My Team is the ladder screen — who needs you next. The agents table lives on
     Team Results, so each tab is asserted where it actually renders. */
  P.setD(payload); P.setTeam(payload); P.setView('team'); P.teamView();
  const myTeam = N.root.innerHTML;
  if (myTeam.indexOf('A Leader') < 0) throw new Error('the team leader is not greeted by name');
  if (!/Team target/.test(myTeam)) throw new Error('My Team has no team target card');
  if (!/Scores are not published yet/.test(myTeam)) throw new Error('a missing NBA digest is not stated on My Team');
  if (/undefined|NaN|\[object Object\]/.test(myTeam)) throw new Error('My Team rendered a placeholder value');

  /* ---- Export (2026-09-11): the workbook is the screen, sheet for sheet ----
     A fixture with day rows, week rows and the summary block; XLSX is stubbed to capture
     what would be written. Each sheet's header must be the on-screen table's header, the
     Grand Total row must be last, printed rand and percentages must come back as numbers,
     and a dash must come back as an EMPTY cell — never a nought. */
  (function(){
    const days = [
      { d: '2026-08-03', w: 32, emp: 1, act: 1, t: 5, s: 6, x: 1200.5, tk: 5400, c: 40, r: 1 },
      { d: '2026-08-04', w: 32, emp: 1, act: 0, t: 5, s: 0, x: 0, tk: 0, c: 0, r: 0, dc: false },
    ];
    const rich = team.map((a, i) => ({ ...a, emp: 10, act: 9, att: 0.9, spd: 1.5 - i, aveG: 90, qa: 0.95, ref: 2, canc: 1, talk: 90000, aveTalk: 9000, talkPerWorked: 10000,
      gwpT: 8000, score: 0.8, days, wk: [{ n: 32, emp: 2, act: 1, sales: 6, target: 10, pctT: 0.6, spd: 6, gwpEx: 1200.5, gwpT: 1600, aveG: 200, att: 0.5, qa: 0.95, ref: 1, talk: 5400, aveTalk: 2700, talkPerWorked: 5400 }] }));
    const summary = { onTarget: 1, talkUnit: 'minutes', teams: [{ tl: 'A Leader', camp: 'Courtesy', hc: 2, emp: 20, act: 18, att: 0.9, target: 160, sales: 130, pctT: 0.8125, spd: 7.2, canc: 2, cancPct: 0.015, gwpT: 16000, gwp: 12000, pctG: 0.75, aveG: 92.3, aveTalk: 9000, ref: 4, refPct: 0.03, onT: 1 }],
      campaigns: { Courtesy: { hc: 40, emp: 400, act: 360, att: 0.9, target: 3200, sales: 2600, pctT: 0.8125, spd: 7.2, canc: 40, cancPct: 0.015, gwpT: 320000, gwp: 240000, pctG: 0.75, aveG: 92.3, aveTalk: 9000, ref: 80, refPct: 0.03, onT: 20 } } };
    const full = { ...payload, agents: rich, summary, talkUnit: 'minutes', weeks: [{ num: 32, from: '2026-08-03', to: '2026-08-09' }], updatedAt: '2026-08-04T10:00:00Z' };
    P.setD(full); P.setTeam(full); P.setDayFilter('');
    const sheets = []; let written = null;
    globalThis.XLSX = { utils: { book_new: () => ({}), aoa_to_sheet: (aoa) => ({ aoa }), book_append_sheet: (wb, ws, nm) => sheets.push([nm, ws.aoa]) }, writeFile: (wb, name) => { written = name; } };
    try {
      P.setView('mtd_team'); P.teamView();
      const mtdHtml = N.root.innerHTML;
      const heads = [...mtdHtml.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
      P.exportReports('all');
      const names = sheets.map((s) => s[0]);
      if (!written || !/^TL Reports - A Leader - .*\.xlsx$/.test(written)) throw new Error('workbook not written or misnamed: ' + written);
      if (JSON.stringify(names) !== JSON.stringify(['MTD', 'TL MTD', 'Daily', 'WTD - Week 32'])) throw new Error('unexpected sheets: ' + names.join(', '));
      const mtd = sheets[0][1];
      const want = ['Agent', 'Code'].concat(heads.slice(1, heads.indexOf('Metric')).filter((h) => h !== 'Agent'));
      if (JSON.stringify(mtd[0]) !== JSON.stringify(want)) throw new Error('MTD sheet header is not the on-screen header:\n      ' + mtd[0].join('|') + '\n      ' + want.join('|'));
      if (mtd[mtd.length - 1][0] !== 'Grand Total') throw new Error('the MTD sheet has no Grand Total row last');
      if (mtd[1][0] !== 'Sipho Ndlovu' || mtd[2][0] !== 'Nomsa Zulu') throw new Error('MTD rows are not in the on-screen SPD order');
      const gwpCol = mtd[0].indexOf('GWP Achieved'); const attCol = mtd[0].indexOf('Att %');
      if (mtd[1][gwpCol] !== 9000) throw new Error('printed rand did not come back as a number: ' + JSON.stringify(mtd[1][gwpCol]));
      if (!mtd[1][attCol] || mtd[1][attCol].v !== 0.9) throw new Error('printed percentage did not come back as a number: ' + JSON.stringify(mtd[1][attCol]));
      const tl = sheets[1][1];
      if (JSON.stringify(tl[0]) !== JSON.stringify(['Metric', 'A Leader', 'Matrix Courtesy total'])) throw new Error('TL MTD header: ' + tl[0].join('|'));
      if (tl.find((r) => r[0] === 'Agents on Target')[2] !== 20) throw new Error('the campaign total column is not the campaign aggregate');
      const daily = sheets[2][1];
      if (daily[0][0] !== 'Date' || daily[0][2] !== 'Agent' || daily[0][3] !== 'Code') throw new Error('Daily sheet header: ' + daily[0].join('|'));
      if (daily.length !== 5) throw new Error('Daily should carry 2 agents × 2 days = 4 rows, got ' + (daily.length - 1));
      if (daily[1][0] !== '2026-08-04' || daily[2][0] !== '2026-08-04') throw new Error('the export must print the date on EVERY row (the screen prints it once per day)');
      const talkCol = daily[0].indexOf('Talk');
      if (daily[1][talkCol] !== '') throw new Error('an unknown talk figure (dash on screen) must export as an empty cell, got ' + JSON.stringify(daily[1][talkCol]));
      const wk = sheets[3][1];
      if (wk[0].indexOf('Score') >= 0 || wk[0].some((h) => /Canc/.test(h))) throw new Error('the weekly sheet carries a column the VAS Weekly does not');
      if (wk[wk.length - 1][0] !== 'Grand Total') throw new Error('the weekly sheet has no Grand Total row');
      ok('Export all writes MTD, TL MTD, Daily and one WTD sheet per week — headers, order and totals as on screen; rand and % as numbers; a dash as an empty cell');
      /* the day picker narrows the export the way it narrows the screen */
      sheets.length = 0; P.setDayFilter('2026-08-03'); P.exportReports('daily_team');
      (sheets.length === 1 && sheets[0][0] === 'Daily 2026-08-03' && sheets[0][1].length === 3)
        ? ok('Export on Daily honours the day picker — one day, two rows, named for the day')
        : bad('the Daily export ignores the day picker', JSON.stringify(sheets.map((s) => [s[0], s[1].length])));
      /* …but Export ALL is the whole month even when the picker was left on a day (review, 2026-09-11) */
      sheets.length = 0; P.exportReports('all');
      (sheets[2] && sheets[2][0] === 'Daily' && sheets[2][1].length === 5)
        ? ok('Export all ignores a day picker left over from the Daily tab — its Daily sheet is the whole month')
        : bad('Export all carried the Daily day picker', JSON.stringify(sheets.map((s) => [s[0], s[1].length])));
      P.setDayFilter('');
      /* cellOf: the four shapes a cell can take */
      const c = P.cellOf;
      (c('<b>R 1&nbsp;234,5</b>') === 1234.5 && c('95%').v === 0.95 && c('–') === '' && c('Exp') === 'Exp' && c('<span class="pill r">no shift</span>') === 'no shift')
        ? ok('cellOf reads printed rand and percentages back as numbers, keeps words as words, and makes a dash an empty cell')
        : bad('cellOf mis-reads a printed cell');
    } catch (e) { bad('the export does not mirror the screen', e.message); }
    finally { delete globalThis.XLSX; }
    P.setD(payload); P.setTeam(payload);
  })();

  /* ---- Never static (2026-09-11): the refresh lands in place ----
     A second page instance whose Worker is a stub. Same figures → the stamp moves and the
     page is NOT redrawn; new figures → redrawn in place on the same sub-tab, and the new
     name is on screen. A refresh that arrives while a KPI form is open waits. */
  (function(){
    let reply = null;
    const stub = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply) });
    const { api: Q, nodes: M } = loadPage(stub);
    const base = { ...payload, updatedAt: '2026-08-04T10:00:00Z' };
    Q.setD(base); Q.setTeam(base); Q.setView('mtd_team'); Q.teamView();
    const before = M.root.innerHTML;
    if (!/Published /.test(before)) { bad('the Reports toolbar does not show when the figures were published'); return; }
    reply = { ...base, updatedAt: '2026-08-04T10:05:00Z' };                         // same figures, later stamp
    PENDING.push(Q.refreshPortal(true).then(() => {
      (Q.getD().updatedAt === '2026-08-04T10:05:00Z' && Q.liveFiguresChanged(base) === false)
        ? ok('a republish with the same figures is taken silently — the stamp moves, nothing is shouted')
        : bad('a same-figures republish was not applied');
      reply = { ...base, updatedAt: '2026-08-04T10:10:00Z', agents: [...team, { code: 'CB9', name: 'Zanele Mokoena', tl: 'A Leader', campaign: 'Courtesy', tenure: 'M0', covered: true, gwpEx: 500, sales: 5, target: 10, pctT: 0.5, spark: [1] }] };
      return Q.refreshPortal(true);
    }).then(() => {
      const after = M.root.innerHTML;
      (after.indexOf('Zanele Mokoena') >= 0 && Q.getView() === 'mtd_team' && /Published /.test(after))
        ? ok('new figures from VAS are redrawn in place on the same sub-tab — the team leader never reloads')
        : bad('new figures were not applied to the open report');
      /* mid-form: the copy waits */
      Q.setForm({ id: 'f1', kind: 'monthly', meta: null, data: {}, page: 1, dirty: true, saving: false }); Q.setView('kpihub');
      reply = { ...reply, updatedAt: '2026-08-04T10:15:00Z', agents: team };
      return Q.refreshPortal(false);
    }).then(() => {
      (Q.getD().updatedAt === '2026-08-04T10:10:00Z')
        ? ok('a refresh that arrives while a KPI form is open is held back, not painted over the form')
        : bad('a background refresh re-rendered over an open form');
      Q.setForm({ id: null, kind: 'monthly', meta: null, data: null, page: 1, dirty: false, saving: false }); Q.setView('mtd_team'); Q.render();
      (Q.getD().updatedAt === '2026-08-04T10:15:00Z')
        ? ok('…and lands on the next safe render, once the form is closed')
        : bad('the held-back refresh never landed');
    }).catch((e) => bad('the live refresh threw', e.message)));
  })();

  P.setView('results'); P.teamView();
  const html = N.root.innerHTML;
  if (html.indexOf('Sipho Ndlovu') < 0 || html.indexOf('Nomsa Zulu') < 0) throw new Error('the team is not listed');
  if (/undefined|NaN|\[object Object\]/.test(html)) throw new Error('rendered a placeholder value');
  if (html.indexOf('81%') < 0) throw new Error('the weighted team %-to-target (130/160 = 81%) is not shown');
  /* The team page is the AgentOS "<TL> — agents" TABLE now, so the coaching count
     is a column rather than the old card's "3 coaching sessions" sentence. The
     guarantee is unchanged — a team leader can see, per agent, how much coaching
     has been recorded — so the check follows the layout instead of pinning it. */
  if (!/<th[^>]*>Coaching<\/th>/.test(html)) throw new Error('the agents table has no Coaching column');
  if (!/<table class="tbl tltable"/.test(html)) throw new Error('the team is not rendered as the AgentOS agents table');
  if (!/class="totrow"/.test(html)) throw new Error('the agents table has no team totals row');
  ok('the team leader page is the AgentOS agents table, with totals and a coaching column');
} catch (e) {
  bad('team leader page', e.message);
}

/* COACHING, and the one thing it must never do: score a theme a coach did not
   choose. Every classified session on the live Hub is 'inferred', so the page
   has to say so in words rather than print a column of zeroes. */
try {
  const c = {
    windowDays: 90,
    agents: [{ code: 'CB1', name: 'Sipho Ndlovu', count: 2, last: '2026-08-20',
      themes: [{ key: 'gap.objection_handling', family: 'gap', shown: 2, scored: 0 }],
      sessions: [
        { typeLabel: 'Quality Assurance Coaching', date: '2026-08-20', qaScore: '78%', teamLeaderComments: 'Confirm the client name.', agentFeedback: 'I will confirm it.' },
        { typeLabel: 'Formal Coaching', date: '2026-08-11', developmentAreas: 'Objection handling.', agentFeedback: 'I will practise.' },
      ] }],
  };
  const html = P.coachHTML(c);
  if (html.indexOf('Objection Handling') < 0) throw new Error('the theme is not shown');
  if (html.indexOf('read from the notes') < 0) throw new Error('an unscored inferred theme is not explained');
  if (html.indexOf('Confirm the client name.') < 0) throw new Error('what was discussed is missing');
  if (html.indexOf('I will confirm it.') < 0) throw new Error('what the agent agreed is missing');
  const down = P.coachHTML({ error: 'Coaching Hub unreachable' });
  if (down.indexOf('could not reach the Coaching Hub') < 0) throw new Error('a Hub outage is not stated');
  if (/No coaching sessions/.test(down)) throw new Error('a Hub outage is shown as "no sessions" — the two must never look the same');
  const empty = P.coachHTML({ windowDays: 90, agents: [{ code: 'CB1', name: 'x', count: 0, themes: [], sessions: [] }] });
  if (empty.indexOf('No coaching sessions') < 0) throw new Error('a genuinely empty history is not stated');
  ok('coaching shows themes and sessions, never scores an inferred theme, and separates "none" from "Hub down"');
} catch (e) {
  bad('coaching card', e.message);
}

/* The greeting must change with South African time, not the machine's. */
try {
  const h = P.sastHour();
  const g = P.greeting();
  const expect = h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
  if (g !== expect) throw new Error(`hour ${h} gave "${g}", expected "${expect}"`);
  ok(`greeting matches South African time (currently ${String(h).padStart(2, '0')}h → "${g}")`);
} catch (e) {
  bad('greeting', e.message);
}

/* ══════════════════════════════════════════════════════════════════════════
   D · Motivation holds at zero.
   Both of these shipped and were caught on a real agent's screen: a giant green
   "R 0" as the headline, and "you are already at the top of the scale" shown to
   someone at the BOTTOM (because "no extra commission" is true at both ends).
   ══════════════════════════════════════════════════════════════════════════ */
head('D · An agent on zero is still shown something to aim at');

const BELOW = { code: 'CB262', name: 'Busiswa Mathenjwa', campaign: 'Courtesy', tenure: 'M1', plan: 'M1',
  gwpEx: 1857.3, sales: 24, target: 42, pctT: 0.571, spd: 1.85, att: 0.93, qa: 0.72, aveG: 77.39,
  ref: 0, act: 13, emp: 14, rankCo: 53, nCo: 84, rankTeam: 14, nTeam: 18, trend: 'up', trendPct: 0.08,
  badges: [], spark: [1, 2, 1] };
const MAXED = { ...BELOW, code: 'CB1', name: 'Top Earner', gwpEx: 30000, sales: 380, pctT: 2.1 };
const DIG = { ...DIGEST, workingDays: 21, diallingDays: 14 };

/* Since 2026-09-03 the money hero is NOT on Today (one home per figure — Nick: "why
   are we repeating the agent's tracking on each page"); it renders on a team leader's
   drilldown and its copy rules are checked on the function itself. Today carries a
   pointer to the Projected Commission tab instead. */
try {
  P.setD({ ...DIG, agents: [BELOW] }); P.setMe(BELOW); P.setView('month'); P.show(BELOW);
  const today = N.root.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (/Projected commission this month|On track to earn/i.test(today)) throw new Error('the money hero is still repeated on Today');
  if (!/Open Projected Commission/.test(today)) throw new Error('Today does not point at the Projected Commission tab');
  if (/pick your rung|Three ways to win/i.test(today)) throw new Error('the rungs are still on Today');
  ok('Today carries no money hero — one pointer to Projected Commission, no rungs');
} catch (e) { bad('one home per figure', e.message); }

try {
  P.setD({ ...DIG, agents: [BELOW] }); P.setMe(BELOW);
  const c = P.commCalc('M1', 13, 21, 1857.3, 1, DIG.comm);
  const html = P.heroHTML(c), text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (/R\s?0\b/.test(text.slice(0, 400))) throw new Error('a bare "R 0" is still the headline');
  if (!/first payout/i.test(text)) throw new Error('no reachable target offered');
  if (!/more sales?/i.test(text)) throw new Error('the gap is not expressed in sales');
  if (/top of the scale/i.test(text)) throw new Error('an agent on ZERO is told they are at the top of the scale');
  ok('below the first bracket: shows the payout to aim at, in sales, never a bare R 0');

  /* Level 1 is the cheapest rung on the ladder (M1: 50 sales for R1,250, ~R25 a
     sale, 32% of premium) and level 3 is 10 sales later for R3,000. Showing only
     the first bracket makes the whole scheme look mean — which is the reaction it
     got. The hero must say where it starts paying. */
  if (!/climbs fast/i.test(text)) throw new Error('the hero does not show that the ladder accelerates past level 1');
  if (!/hard one/i.test(text)) throw new Error('the "first one is the hard one" framing is gone');
  ok('the hero shows the ladder accelerating past the first bracket');

  if (!/\d+ more sales?/.test(text)) throw new Error('the hero does not price the gap in sales');
  ok('the hero prices the gap in sales as well as rand');
} catch (e) { bad('zero-case hero', e.message); }

try {
  P.setD({ ...DIG, agents: [MAXED] }); P.setMe(MAXED);
  const c = P.commCalc('M1', 13, 21, 30000, 1, DIG.comm);
  const text = P.heroHTML(c).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/top of the scale|top bracket/i.test(text)) throw new Error('a maxed agent is not told they are at the top');
  ok('at the top bracket: "top of the scale" appears where it is actually true');
} catch (e) { bad('top-bracket message', e.message); }

/* ═══ 2026-09-03 testing round (Agent OS testing.docx) — Today must be PRECISE ═══
   · days worked never include a day whose files have not landed (A2)
   · one statement replaces the rungs: month target, per-day, days left with dates (A3)
   · last session and momentum read the SAME worked day (A5)
   · headings name their scope (A6); agents see no data-assurance chrome (C4);
     Nikola is off the agent nav (C2) */
try {
  const SEP = { ...DIGEST, period: { from: '2026-09-01', to: '2026-09-30' }, workingDays: 21, diallingDays: 2,
    dates: ['2026-09-01', '2026-09-02'], role: 'agent', updatedAt: new Date().toISOString(),
    coaching: { stale: true, agents: [] } };
  delete SEP.daysWithData;                                   // an older publisher: the page must count for itself
  /* the morning of 3 Sep, pinned: working days left is a CALENDAR fact since 2026-09-28 (LEFT() caps at
     today), so an unpinned fixture read the real date and printed "3 working days left (28 – 30 Sep)" */
  W.__agentToday = '2026-09-03';
  const ENOCH = { code: 'CB70', name: 'Enoch Pillay', campaign: 'Cuddle', tenure: 'Exp', plan: 'EXP_CUDDLE',
    gwpEx: 1800, sales: 20, target: 24, pctT: 0.83, spd: 6.7, att: 1, qa: 0.98, aveG: 90, ref: 2,
    act: 3, emp: 3, rankCo: 1, nCo: 62, rankTeam: 1, nTeam: 15, trend: 'up', trendPct: 0.1, badges: [], spark: [8, 12],
    days: [ { d: '2026-09-01', s: 8, x: 600, t: 8, act: 1 }, { d: '2026-09-02', s: 12, x: 900, t: 8, act: 1 },
            { d: '2026-09-03', s: 0, x: 0, t: 8, act: 1, p: true } ] };   // the register says today; no files yet
  P.setTeam(null); P.setD({ ...SEP, agents: [ENOCH] }); P.setMe(ENOCH); P.setView('month'); P.show(ENOCH);
  const html = N.root.innerHTML, text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/2 of 21 working days worked/.test(text)) throw new Error('days worked still counts today (register 3, files 2): ' + (text.match(/\d+ of 21 working days worked/) || ['not found'])[0]);
  if (!/target of 168 sales/.test(text)) throw new Error('the month target is not stated (8 a day × 21 = 168)');
  if (!/about 8 a day over the 19 working days left \(3 – 30 September\)/.test(text)) throw new Error('the per-day statement is wrong or undated: ' + (text.match(/about .{0,80}/) || [''])[0]);
  if (/pick your rung|Three ways to win/i.test(text)) throw new Error('the rungs are back');
  if (!/Your last session · 2026-09-02/.test(text)) throw new Error('last session is not the last WORKED day');
  if (!/2 sessions in a row on target/.test(text)) throw new Error('momentum does not agree with the last session card');
  if (!/2026-09-03 is still landing/.test(text)) throw new Error('the provisional day is not named as still landing');
  if (!/How you are tracking — September to date/.test(text)) throw new Error('the tracking heading does not name its scope');
  if (!/A projection of how your month is going so far/.test(text)) throw new Error('Today does not say it is a projection');
  if (/Numbers last refreshed|Up to date|older copy|Numbers updated/.test(text)) throw new Error('data-assurance chrome is still shown to an agent');
  /* D2 (sprint 2026-09-29): ONE quiet line instead — what the figures cover and when they last moved */
  if (!/class="fresh-line"[^>]*>Figures to [^<·]+ · updated [^<]*\d\d:\d\d</.test(html)) throw new Error('the agent has no quiet "Figures to … · updated …" line: ' + ((html.match(/fresh-line[^<]*<?[^<]*/) || ['none'])[0]));
  if (/>Nikola</.test(html) || /data-view="nik"/.test(html)) throw new Error('Nikola is still on the agent nav');
  if (!/Projected Commission</.test(html)) throw new Error('the nav tab is not "Projected Commission"');
  if (/\(final\)/.test(html)) throw new Error('a running month is called final');
  ok('Today is precise: 2 of 21 days, 168 target, 8 a day over 19 days (3 – 30 Sep), same last session in both cards, no chrome, no Nikola');
  /* ROLLOVER GRACE (2026-10-01): on 1 October the live digest is still September — the line names it final */
  W.__agentToday = '2026-10-01'; P.show(ENOCH);
  const htmlF = N.root.innerHTML;
  if (!/class="fresh-line"[^>]*>September \(final\) · figures to [^<·]+ · updated [^<]*\d\d:\d\d</.test(htmlF)) throw new Error('the closed month is not named final: ' + ((htmlF.match(/fresh-line[^<]*<?[^<]*/) || ['none'])[0]));
  W.__agentToday = '2026-09-03';
  ok('a closed month reads "September (final) · figures to … · updated …"');

  /* the contradiction Nick saw: a short last session must read as short in BOTH cards */
  const SHORT = { ...ENOCH, days: [ { d: '2026-09-01', s: 8, x: 600, t: 8, act: 1 }, { d: '2026-09-02', s: 3, x: 220, t: 8, act: 1 } ] };
  P.setD({ ...SEP, agents: [SHORT] }); P.setMe(SHORT); P.show(SHORT);
  const t2 = N.root.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/Your last session · 2026-09-02 .{0,60}Short of target/.test(t2)) throw new Error('last session card does not say short');
  if (!/last session \(2026-09-02\) was short of target/.test(t2)) throw new Error('momentum contradicts the last session card');
  ok('a short last session reads as short in both cards — no contradiction possible');

  /* a team leader still gets the freshness card and footer stamp */
  P.setTeam({ name: 'Lead', role: 'team_leader' }); P.setD({ ...SEP, role: 'team_leader', agents: [ENOCH], __back: { name: 'Lead' } }); P.setMe(ENOCH); P.show(ENOCH);
  const t3 = N.root.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/Numbers last refreshed/.test(t3)) throw new Error('a team leader lost the freshness card');
  if (/fresh-line/.test(N.root.innerHTML)) throw new Error('the agent\'s quiet line leaked onto a team leader\'s drilldown');
  ok('team leaders keep the data-assurance chrome');
  P.setTeam(null);
} catch (e) { bad('Today precision (2026-09-03 round)', e.message); }
delete W.__agentToday;

/* ═══ THE CALCULATOR IS FOR THE NEW MONTH (Nick, 2026-10-01: "its october first the projected comms calc
   works for the new month not old, so it differs from the uploaded data") ═══
   On 1 Oct the live digest is still September (the rollover grace). Today / My Progress keep September
   final; the Projected Commission calculator prices OCTOBER — the digest's commNow, 22 working days, no
   October premium yet. Before the month closes, or with an older digest that carries no commNow, the
   calculator is the old September behaviour exactly. */
head('Projected Commission is for the new month on 1 October (commNow)');
try {
  const nf2 = new Intl.NumberFormat('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const flat = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const money = (v) => ('R ' + nf2.format(v)).replace(/\s+/g, ' ');
  const OCT_FIRST = pulseComm.brackets.EXP_CUDDLE[0];                       // read from COMM_RULES, never retyped
  const SEP_FIRST = { gwp: 9751.30, comm: 4000 };
  if (Math.abs(OCT_FIRST.gwp - 10215.65) > 1e-9) throw new Error('fixture assumption: October EXP_CUDDLE first bracket is 10215.65, source says ' + OCT_FIRST.gwp);
  const SEP_COMM = { saleValue: ORIG_SALE_VALUE, brackets: { EXP_CUDDLE: [SEP_FIRST, { gwp: 11000, comm: 6000 }] } };
  const OCT_COMM = { month: '2026-10', ...pulseComm };
  const SEPD = { ...DIGEST, period: { from: '2026-09-01', to: '2026-09-30' }, workingDays: 21, diallingDays: 2,
    dates: ['2026-09-01', '2026-09-02'], daysWithData: 2, role: 'agent', updatedAt: new Date().toISOString(),
    comm: SEP_COMM, coaching: { stale: true, agents: [] } };
  const ENOCH = { code: 'CB70', name: 'Enoch Pillay', campaign: 'Cuddle', tenure: 'Exp', plan: 'EXP_CUDDLE',
    gwpEx: 1800, sales: 20, target: 24, pctT: 0.83, spd: 6.7, att: 1, qa: 0.98, aveG: 90, ref: 2,
    act: 2, emp: 2, rankCo: 1, nCo: 62, rankTeam: 1, nTeam: 15, trend: 'up', trendPct: 0.1, badges: [], spark: [8, 12],
    days: [ { d: '2026-09-01', s: 8, x: 600, t: 8, act: 1 }, { d: '2026-09-02', s: 12, x: 900, t: 8, act: 1 } ] };
  P.setTeam(null);

  /* 1 Oct, September digest WITH commNow: the calculator is October's */
  W.__agentToday = '2026-10-01';
  P.setD({ ...SEPD, commNow: OCT_COMM, agents: [ENOCH] }); P.setMe(ENOCH); P.setView('calc'); P.show(ENOCH);
  let text = flat(N.root.innerHTML);
  if (!/Projected commission — October/.test(text)) throw new Error('the calculator does not name October');
  if (!/October has just started/.test(text)) throw new Error('no plain "October has just started" line');
  if (!/22 working days/.test(text)) throw new Error('October\'s 22 working days are not shown: ' + (text.match(/\d+ working days/g) || ['none']).join(' | '));
  if (text.indexOf(money(OCT_FIRST.gwp)) < 0) throw new Error('October\'s first bracket premium ' + money(OCT_FIRST.gwp) + ' is not on the page');
  if (text.indexOf(money(SEP_FIRST.gwp)) >= 0) throw new Error('September\'s first bracket premium is still on the calculator');
  /* the quiet "September (final) · figures to …" line and the footer legitimately name the data's month */
  const body = flat(N.root.innerHTML.replace(/<div class="fresh-line">[\s\S]*?<\/div>/, '').replace(/<div class="foot">[\s\S]*$/, ''));
  const sepHit = (body.match(/.{0,30}September.{0,30}/) || [''])[0];
  if (text.indexOf(money(1800)) >= 0 || /September/.test(body)) throw new Error('the calculator still prices or names September: ' + sepHit);
  if (/undefined|NaN/.test(text)) throw new Error('placeholder value on the October calculator');
  if (/Your month by campaign|Commission by campaign/.test(text)) throw new Error('September\'s campaign split leaked into October');
  ok('1 Oct: the calculator is October — 22 working days, October\'s first bracket, no September premium priced');

  /* the hero AS THE CALCULATOR PAGE RENDERS IT (#comsHero) — review 2026-10-01: the first version tested
     heroHTML(), which that page never calls, while agents saw "R 0.00 · below the first bracket" */
  const heroEl = (N.root.innerHTML.match(/<div class="coms-hero" id="comsHero">[\s\S]*?<\/div><\/div>(?=\s*<|$)/) || [''])[0];
  const hero = flat(heroEl || N.root.innerHTML);
  if (!heroEl) throw new Error('the calculator page has no #comsHero');
  if (!/Projected commission — October/.test(hero) || hero.indexOf('R 4 000') < 0) throw new Error('first-payout hero is wrong: ' + hero.slice(0, 200));
  if (!/132 sales/.test(hero)) throw new Error('first payout is not priced in sales (ceil(10215.65 ÷ sale value) = 132): ' + hero);
  if (!/about 6 a day/.test(hero)) throw new Error('first payout has no per-day ask over 22 days: ' + hero);
  if (/Once you have worked a day|below the first bracket/.test(hero)) throw new Error('the zero-day dead end is on the page: ' + hero.slice(0, 200));
  P.setMe({ ...ENOCH, plan: 'M0' }); P.show({ ...ENOCH, plan: 'M0' });
  const heroM0 = flat(N.root.innerHTML);
  if (!/full premium/i.test(heroM0)) throw new Error('M0 lost its full-premium wording on the page');
  P.setMe(ENOCH); P.show(ENOCH);
  ok('1 Oct, on the rendered page: first payout under the October model — R4 000, 132 sales, about 6 a day; M0 keeps "full premium"');
  /* the September HISTORY copy carries commNow '2026-10' too — opened in December it must stay September */
  W.__agentToday = '2026-12-01';
  P.setD({ ...SEPD, commNow: OCT_COMM, agents: [ENOCH] }); P.setMe(ENOCH); P.show(ENOCH);
  if (/Projected commission — October|new month/.test(flat(N.root.innerHTML))) throw new Error('a September copy read in December projects "October — the new month"');
  W.__agentToday = '2026-10-01';
  P.setD({ ...SEPD, commNow: OCT_COMM, agents: [ENOCH] }); P.setMe(ENOCH); P.show(ENOCH);
  ok('commNow counts only in the month it names (a September copy opened in December stays September)');

  /* what-if inputs still work and use October's brackets */
  for (const [id, v] of [['cDays', '2'], ['tDays', '22'], ['cGwp', '1000'], ['cPlan', 'EXP_CUDDLE']]) N[id] = Object.assign(N[id] || {}, { value: v });
  const typed = P.calcNow();
  const want = P.commCalc('EXP_CUDDLE', 2, 22, 1000, 1, OCT_COMM);
  for (const id of ['cDays', 'tDays', 'cGwp', 'cPlan']) N[id].value = '';
  if (!typed || Math.abs(typed.projection - want.projection) > 1e-6 || !(typed.projection > 0)) throw new Error('typed what-if is not priced on October\'s brackets: ' + (typed && typed.projection) + ' vs ' + (want && want.projection));
  const wrong = P.commCalc('EXP_CUDDLE', 2, 22, 1000, 1, SEP_COMM);
  if (Math.abs(typed.projection - wrong.projection) < 1e-6) throw new Error('fixture cannot tell October from September');
  ok('a typed what-if (2 days, R1 000, 22 days) uses October\'s brackets');

  /* Today keeps September final — nothing on it moves */
  P.setView('month'); P.show(ENOCH);
  const today = flat(N.root.innerHTML);
  if (!/September \(final\)/.test(today) || !/How you are tracking — September to date/.test(today)) throw new Error('Today stopped saying September');
  ok('Today still reads September final');

  /* 20 Sep, same digest: the month is not closed — the calculator is September's, as before */
  W.__agentToday = '2026-09-20';
  P.setView('calc'); P.show(ENOCH);
  text = flat(N.root.innerHTML);
  if (/Projected commission — October|October has just started/.test(text)) throw new Error('October leaked into a running September');
  if (text.indexOf(money(SEP_FIRST.gwp)) < 0 || text.indexOf(money(OCT_FIRST.gwp)) >= 0) throw new Error('a running September is not on September\'s brackets');
  if (!/21 working days/.test(text)) throw new Error('a running September lost its 21 working days');
  ok('20 Sep with the same digest: September\'s calculator, unchanged');

  /* an older publisher (no commNow) on 1 Oct: no throw, today's behaviour */
  W.__agentToday = '2026-10-01';
  P.setD({ ...SEPD, agents: [ENOCH] }); P.setMe(ENOCH); P.setView('calc'); P.show(ENOCH);
  text = flat(N.root.innerHTML);
  if (/Projected commission — October/.test(text)) throw new Error('October invented from a digest with no commNow');
  if (text.indexOf(money(SEP_FIRST.gwp)) < 0) throw new Error('a digest with no commNow lost September\'s calculator');
  ok('a digest without commNow on 1 Oct keeps today\'s behaviour and does not throw');
} catch (e) { bad('new-month calculator (commNow)', e.message); }
P.setView('month'); P.setTeam(null);
delete W.__agentToday;

/* ═══ LEAVE IS NOT A SHIFT (decision D1, sprint 2026-09-29) — the display half ═══
   The digest carries me.leave (excused days, 0.5-fractional, omitted when 0) and lv (1 or 0.5) on an
   excused days[] entry. The page PAINTS both and never computes leave: one line on Today and My
   Progress (and the leader's drill-down), "Leave" in the sessions table, and a leave day is skipped —
   never short, never "still landing" — by the last-session and momentum cards. */
head('Leave days (D1) — painted, never computed');
try {
  W.__agentToday = '2026-09-05';
  const SEPL = { ...DIGEST, period: { from: '2026-09-01', to: '2026-09-30' }, workingDays: 21, diallingDays: 4,
    dates: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'], role: 'agent', updatedAt: new Date().toISOString(),
    coaching: { stale: true, agents: [] } };
  const BASE = { code: 'CB71', name: 'Lindiwe Mthembu', campaign: 'Cuddle', tenure: 'Exp', plan: 'EXP_CUDDLE',
    gwpEx: 1500, sales: 17, target: 16, pctT: 1.06, spd: 8.5, att: 1, qa: 0.95, aveG: 88, ref: 0,
    act: 2, emp: 2, rankCo: 3, nCo: 62, rankTeam: 1, nTeam: 15, trend: 'up', trendPct: 0.1, badges: [], spark: [8, 9] };
  const txt = () => N.root.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const row = (d) => (N.root.innerHTML.match(new RegExp('<tr><td class="num">' + d + '[\\s\\S]*?</tr>')) || [''])[0];

  /* three whole days of leave; the NEWEST row is a leave day with a target on it (worst case) */
  const LV = { ...BASE, leave: 3, days: [
    { d: '2026-09-01', s: 8, x: 700, t: 8, act: 1 }, { d: '2026-09-02', s: 9, x: 800, t: 8, act: 1 },
    { d: '2026-09-03', s: 0, x: 0, t: 8, act: 0, lv: 1 }, { d: '2026-09-04', s: 0, x: 0, t: 8, act: 0, lv: 1 } ] };
  P.setTeam(null); P.setD({ ...SEPL, agents: [LV] }); P.setMe(LV); P.setView('month'); P.show(LV);
  let t = txt();
  if (!/Leave: 3 days — not counted as shifts, your target is set on the days you were in/.test(t)) throw new Error('Today has no leave line: ' + (t.match(/Leave:.{0,80}/) || ['none'])[0]);
  if (!/Your last session · 2026-09-02 .{0,60}Target hit/.test(t)) throw new Error('the last session is not the last WORKED, non-leave day');
  if (!/2 sessions in a row on target/.test(t)) throw new Error('momentum counted a leave day');
  if (/2026-09-0[34] is still landing/.test(t)) throw new Error('a leave day was called "still landing"');
  ok('Today: "Leave: 3 days — not counted as shifts…", last session and momentum skip the leave days');

  P.setView('progress'); P.show(LV); t = txt();
  if (!/Leave: 3 days/.test(t)) throw new Error('My Progress has no leave line');
  const r3 = row('2026-09-03');
  if (!/>Leave</.test(r3) || /chip2 next|chip2 beat/.test(r3)) throw new Error('the leave session does not read "Leave" (or still carries a Yes/No chip): ' + r3.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  if (!/chip2 beat/.test(row('2026-09-02'))) throw new Error('a worked session lost its Yes chip');
  ok('My Progress: the leave line shows and the sessions table reads "Leave", not a short session');

  /* half a day: an HDAL row the agent half-worked — old code judged it short (1 of 4) */
  const HALF = { ...BASE, leave: 0.5, days: [
    { d: '2026-09-01', s: 8, x: 700, t: 8, act: 1 }, { d: '2026-09-02', s: 1, x: 90, t: 4, act: 0.5, lv: 0.5 } ] };
  P.setD({ ...SEPL, agents: [HALF] }); P.setMe(HALF); P.setView('month'); P.show(HALF); t = txt();
  if (!/Leave: half a day — not counted as a shift/.test(t)) throw new Error('half a day is not said as such: ' + (t.match(/Leave:.{0,60}/) || ['none'])[0]);
  if (!/Your last session · 2026-09-01 .{0,60}Target hit/.test(t) || /was short of target/.test(t)) throw new Error('the half-day leave session was judged');
  P.setView('progress'); P.show(HALF);
  if (!/>Half-day leave</.test(row('2026-09-02'))) throw new Error('the half-day row does not read "Half-day leave"');
  ok('half a day reads "Leave: half a day" and "Half-day leave", and is not judged short');

  /* no leave key → no line */
  const NONE = { ...BASE, days: [{ d: '2026-09-01', s: 8, x: 700, t: 8, act: 1 }] };
  P.setD({ ...SEPL, agents: [NONE] }); P.setMe(NONE); P.setView('month'); P.show(NONE);
  if (/leave-line|Leave:/.test(N.root.innerHTML)) throw new Error('a leave line shows with no leave on the digest');
  P.setView('progress'); P.show(NONE);
  if (/leave-line|Leave:/.test(N.root.innerHTML)) throw new Error('My Progress shows a leave line with no leave on the digest');
  ok('no leave on the digest → no leave line anywhere');

  /* the team leader's drill-down of the same agent shows the same */
  P.setTeam({ name: 'Lead', role: 'team_leader' });
  P.setD({ ...SEPL, role: 'team_leader', agents: [LV], __back: { name: 'Lead' } }); P.setMe(LV); P.setView('month'); P.show(LV); t = txt();
  if (!/Leave: 3 days — not counted as shifts, their target is set on the days they were in/.test(t)) throw new Error('the drill-down has no leave line: ' + (t.match(/Leave:.{0,80}/) || ['none'])[0]);
  P.setView('progress'); P.show(LV);
  if (!/>Leave</.test(row('2026-09-03'))) throw new Error('the drill-down sessions table does not read "Leave"');
  ok('the team leader\'s drill-down shows the same leave line and "Leave" rows');
  P.setTeam(null); P.setView('month');

  /* the page paints; it never derives leave from the rows */
  !/\.leave\s*=|leave\s*\+=|lv\s*\+=/.test(PAGE) ? ok('the page never computes leave (no assignment to or sum of leave/lv)') : bad('the page computes leave instead of painting the digest');
} catch (e) { bad('Leave days (D1)', e.message); }
delete W.__agentToday;
P.setTeam(null);

/* A STALE DIGEST MUST NOT COST AN AGENT MONEY.
   A PULSE tab running the old build publishes no workingDays, so the page fell
   back to elapsed days. For the floor's #2 earner that meant 16 days worked "out
   of 14", a NEGATIVE remaining-day count, and R7,670 on screen where the real
   commission was R17,896 — R10,226 understated, plus "R 0 away from the next
   bracket" and a claim he could not clear the FIRST bracket. The page now counts
   the weekdays in the period itself. */
try {
  const STALE = { ...DIGEST, diallingDays: 14, comm: { saleValue: ORIG_SALE_VALUE, brackets: ORIG_BRACKETS } };
  delete STALE.workingDays;
  const ENOCH = { code: 'CB70', name: 'Enoch Ndlovu', campaign: 'Cuddle', tenure: 'Exp', plan: 'EXP_CUDDLE',
    gwpEx: 14472, sales: 166, target: 128, pctT: 1.30, spd: 10.38, att: 1, qa: 0.98, aveG: 87.18, ref: 48,
    act: 16, emp: 16, rankCo: 2, nCo: 84, rankTeam: 1, nTeam: 11, trend: 'down', trendPct: -0.12,
    badges: [], spark: [8, 10, 12] };
  /* the money now lives on the Projected Commission tab only (2026-09-03) */
  P.setD({ ...STALE, agents: [ENOCH] }); P.setMe(ENOCH); P.setView('calc'); P.show(ENOCH);
  const text = N.root.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  P.setView('month');

  if (/16 .{0,30}(of|out of) 14/i.test(text)) throw new Error('days worked still exceeds the month’s working days');
  /* Figures recomputed for the September 2026 brackets (thresholds rebased 20→21
     dial days) AND holiday-aware working days: August 2026's fallback counts 20
     (21 weekdays − Women's Day observed Mon 10 Aug), so this fixture projects
     18,090.00 — recomputed 2026-10-01 for the OCTOBER brackets (Matrix Vas Comm Model_October26.xlsx,
     22 dial days): 18,090.00 lands in the 17,026.09 bracket → R12,218.60; the elapsed-days bug
     (14 days → 12,663.00, the 11,918.26 bracket) would show ~R6,374.92. September's pair was
     R6,678 wrong / R14,166 right; August's R7,670 / R17,896. */
  if (/R\s?6\s?37\d/.test(text)) throw new Error('still showing the elapsed-days commission (~R6,375)');
  if (!/R\s?12\s?21\d/.test(text)) throw new Error('the corrected commission (R12,219) is not shown');
  if (/R\s?0\b.{0,24}away/i.test(text)) throw new Error('"R 0 away from the next bracket" is back');
  if (/first bracket/i.test(text)) throw new Error('an agent mid-ladder is told he cannot clear the FIRST bracket');
  ok('a stale digest self-corrects: weekdays counted from the period, commission right, no false messages');
} catch (e) { bad('stale-digest recovery', e.message); }

try {
  /* MY PROGRESS is the v22 prototype layout (Nick, 2026-08-26): rating, next best
     action and two checks from the weekly review row, sessions and result tiles
     from the digest's day rows, coaching from the Hub feed. With no nba/coaching
     payload the page must still render its digest-fed sections and say what is
     missing rather than invent — and never print a placeholder. */
  P.setD({ ...DIGEST, workingDays: 21, agents: [SHAPES[0][1]] }); P.setMe(SHAPES[0][1]);
  P.setView('progress'); P.show(SHAPES[0][1]);
  const html = N.root.innerHTML;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (/undefined|NaN/.test(text)) throw new Error('My Progress rendered a placeholder value');
  const me = SHAPES[0][1];
  if (me.days && me.days.length) {
    for (const piece of ['Your last five sessions', 'Sales by session'])
      if (text.indexOf(piece) < 0) throw new Error('My Progress is missing its "' + piece + '" section');
  }
  if (me.score != null && text.indexOf('Agent rating') < 0) throw new Error('the rating card is missing despite a published score');
  ok('My Progress renders the prototype sections from published data, no placeholders');
} catch (e) { bad('My Progress layout', e.message); }

/* THE RATING CARD MUST QUOTE THE WEIGHTS IT WAS ACTUALLY SCORED ON.
   VAS renormalises across the drivers an agent has, so the split is no longer always
   45/25/20/10. The card used to recite those four literals and promise a "ceiling of 90"
   when opt-ins were unreported — telling an agent with no QA evaluations that quality was
   worth 25 of their points when it was worth none of them. */
try {
  const base = { code: 'CB9', name: 'Test Agent', campaign: 'Courtesy', tenure: 'M1', plan: 'M1',
    gwpEx: 5200, sales: 67, target: 60, pctT: 1.1, spd: 3.2, att: 1, aveG: 77.39, ref: 0,
    act: 16, emp: 16, rankCo: 5, nCo: 84, rankTeam: 2, nTeam: 9, trend: 'flat', trendPct: 0,
    badges: [], spark: [2, 3], days: [], score: 0.79 };
  /* an agent with NO QA evaluations: qa stands down, the other three renormalise */
  const noQA = { ...base, qa: null,
    scoreParts: { t: { v: 1.1, w: 60, pts: 60 }, qa: { v: null, w: 0, pts: 0 },
      att: { v: 1, w: 26.7, pts: 26.7 }, opt: { v: null, w: 13.3, pts: 6 } } };
  P.setD({ ...DIGEST, workingDays: 21, agents: [noQA] }); P.setMe(noQA);
  P.setView('progress'); P.show(noQA);
  const t = N.root.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (/45 of the 100 points/.test(t)) throw new Error('the card still recites the fixed 45/25/20/10 split');
  if (/ceiling is 90/.test(t)) throw new Error('the card still promises a 90-point ceiling');
  if (t.indexOf('quality 0') > -1 === false && /quality 25/.test(t))
    throw new Error('the card credits quality with points the agent was not scored on');
  if (!/target achievement 60/.test(t))
    throw new Error('the card does not quote the effective weight it was scored on');
  ok('the rating card quotes the effective weights, not the fixed split');
} catch (e) { bad('rating card weights', e.message); }

/* NO DAYS LEFT MUST NOT PRODUCE A DEAD CARD.
   "+1 / +2 / +3 sales a day" with zero days remaining is three buttons that
   cannot change anything above an apology. That question belongs on the
   figures card, the one place the day counts are editable. Since the v22
   prototype re-skin (Nick, 2026-08-26) the figures card is ALWAYS visible —
   there is no collapsible calculator any more — so the check is: the what-if
   card is present while days remain, dropped when none are, and the always-
   visible figures card says why. The hero, figures, what-if and bracket gap
   table must all render on the tab. */
try {
  const mk = (act) => ({ code: 'CB9', name: 'Test Agent', campaign: 'Courtesy', tenure: 'M1', plan: 'M1',
    gwpEx: 5200, sales: 67, target: 60, pctT: 1.1, spd: 3.2, att: 1, qa: 0.9, aveG: 77.39, ref: 0,
    act, emp: act, rankCo: 5, nCo: 84, rankTeam: 2, nTeam: 9, trend: 'flat', trendPct: 0, badges: [], spark: [2, 3] });
  const D21 = { ...DIGEST, workingDays: 21, diallingDays: 21, daysWithData: 21, comm: { saleValue: ORIG_SALE_VALUE, brackets: ORIG_BRACKETS } };

  const mid = mk(16);
  /* 16 days of data, not 21: since 2026-09-28 the days left are the working days after the last day with
     data — 21 of 21 with data means none are left, whatever the agent's own shift count */
  P.setD({ ...D21, daysWithData: 16, agents: [mid] }); P.setMe(mid); P.setView('calc'); P.show(mid);
  let html = N.root.innerHTML;
  let text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/What if you improve/.test(html)) throw new Error('the what-if card is missing while days remain');
  for (const piece of ['Projected Commission Calculator', 'Bracket you are on pace for', 'Your figures for', 'Bracket gap analysis'])
    if (text.indexOf(piece) < 0) throw new Error('the commission page is missing its "' + piece + '" section');
  /* 2026-09-03 (Nick): the figures are the agent's REAL figures — no inputs, no reset. */
  if (/id="cPlan"|id="cDays"|id="tDays"|id="cGwp"|id="reset"/.test(html)) throw new Error('the figures card still offers editable inputs');
  if (!/real figures from Agent OS/.test(text)) throw new Error('the figures card does not say these are the agent’s real figures');
  if (/undefined|NaN/.test(text)) throw new Error('the commission page rendered a placeholder value');

  const done = mk(21);
  P.setD({ ...D21, agents: [done] }); P.setMe(done); P.setView('calc'); P.show(done);
  html = N.root.innerHTML;
  text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (/What if you improve/.test(html)) throw new Error('a dead what-if card is still rendered with no days left');
  if (!/Your figures for/.test(text)) throw new Error('the figures card is missing with no days left');
  if (!/no remaining days left to add sales to/i.test(text)) throw new Error('the figures card does not explain why the what-if is gone');
  ok('with no days left the what-if card is dropped and the always-visible figures card says why');
} catch (e) { bad('no-days-left routing', e.message); }

/* THE KPI DRILL-DOWN (sprint 2026-09-29, item 3; D3) — the tiles paint the engine's verdicts and a tile
   that needs attention opens the six answers Nick asked for; the page judges nothing */
try {
  if (/function tileState|tileState\(/.test(PAGE.replace(/\/\*[\s\S]*?\*\//g, ''))) throw new Error('the page still decides tile states itself (tileState)');
  const dv = (k, status, extra) => ({ k, label: { ta: 'Target achieved', aveG: 'Average sale (ex VAT)', qa: 'QA score', att: 'Attendance' }[k], status,
    result: null, target: null, below: null, of: null, tlHelp: false, why: null, topic: 'Something else', action: null, ...(extra || {}) });
  const me = { code: 'CB9', name: 'Agent Nine', tl: 'Denise Haripersad', campaign: 'Courtesy', tenure: 'EXP', plan: 'EXP_COURTESY',
    pctT: 0.62, sales: 40, target: 64, spd: 4, emp: 8, act: 8, att: 1, qa: 0.72, aveG: 90, gwpEx: 3600, ref: 0, days: [],
    drill: {
      ta: dv('ta', 'focus', { result: 0.62, target: 1, below: 3, of: 5, tlHelp: true, why: { rule: 'sessions', below: 3, of: 5 }, topic: 'Review my call',
        action: 'Every session at your daily target from here keeps the month on track — plan each shift around that number.' }),
      aveG: dv('aveG', 'pass', { result: 90, target: 86.08 }),
      qa: dv('qa', 'focus', { result: 0.72, target: 0.9, tlHelp: true, why: { rule: 'qa' }, topic: 'Explain my quality result', action: 'One clean week of calls moves this.' }),
      att: dv('att', 'none') } };
  P.setTeam(null); P.setD({ ...DIGEST, role: 'agent', workingDays: 21, agents: [me] }); P.setMe(me);
  const k = P.agentKpis(me, {});
  const tile = (lab) => (k.match(new RegExp('<div class="ac-tile[^"]*"[^>]*>(?:(?!<div class="ac-tile).)*?' + lab, 's')) || [''])[0];
  if (!/ac-tile focus"[^>]*data-drill="ta"/.test(tile('TARGET ACHIEVED'))) throw new Error('the target tile does not paint the engine\'s focus verdict / is not tappable: ' + tile('TARGET ACHIEVED').slice(0, 160));
  if (/data-drill/.test(tile('AVERAGE SALE'))) throw new Error('a tile on target is tappable');
  if (!/ac-tile pass/.test(tile('AVERAGE SALE'))) throw new Error('the average-sale tile ignores the engine\'s pass verdict');
  if (!/ac-tile none/.test(tile('ATTENDANCE'))) throw new Error('a KPI with no verdict is not NO DATA');
  ok('the tiles paint the engine\'s verdicts; only the ones needing attention are tappable');

  const p = P.drillPanelHTML('ta'), pt = p.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const [what, re] of [['the KPI', /Target achieved/], ['the result', /Your result 62%/], ['the target', /Target 100%/],
    ['what drives it', /Below target in 3 of your last 5 sessions/], ['the action', /plan each shift around that number/],
    ['TL help recommended', /Team leader help: recommended/]])
    if (!re.test(pt)) throw new Error('the drill panel does not show ' + what + ': ' + pt.slice(0, 300));
  if (!/openHelp\('Review my call'\)/.test(p)) throw new Error('the panel\'s ask button does not open the help modal on its topic');
  const q = P.drillPanelHTML('qa').replace(/<[^>]+>/g, ' ');
  if (!/lowest band/.test(q) || !/Explain my quality result/.test(P.drillPanelHTML('qa'))) throw new Error('the QA panel does not say why or which topic');
  ok('a tapped KPI answers all six: the KPI, result, target, driver, action and whether to ask the team leader');

  P.setD({ ...DIGEST, role: 'team_leader', workingDays: 21, agents: [me], __back: { name: 'Denise Haripersad' } });
  if (/openHelp\(/.test(P.drillPanelHTML('ta'))) throw new Error('a team leader\'s drilldown offers to file a help request under their own session');
  ok('on a team leader\'s drilldown the panel shows the verdict without an ask button');

  /* leave shrinks the month target the Today statement quotes (item 1 + 3, 2026-09-29) */
  const lv = { ...me, target: 144, emp: 18, leave: 3, drill: undefined, days: [{ d: '2026-09-01', s: 8, x: 800, t: 8, act: 1 }] };
  P.setD({ ...DIGEST, role: 'agent', workingDays: 21, period: { from: '2026-09-01', to: '2026-09-30' }, dates: ['2026-09-01'], agents: [lv] }); P.setMe(lv);
  const tt = P.todayHTML({}).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/target of 144 sales/.test(tt)) throw new Error('the month target ignores leave (8 a day × 18 days = 144): ' + (tt.match(/target of \d+ sales/) || ['none'])[0]);
  ok('leave days come off the month target the Today statement quotes');
} catch (e) { bad('KPI drill-down', e.message); }
P.setTeam(null);

/* A MOVER'S MONTH BY CAMPAIGN (sprint 2026-09-29, item 2; D4) — the page paints PULSE's segments and the
   whole-month row; commission per campaign plan is a labelled projection */
try {
  const segs = [
    { campaign: 'Download & Test', from: '2026-09-01', to: '2026-09-11', sales: 60, gwpEx: 2087, target: 72, pctT: 0.83, act: 9, emp: 9, plan: 'EXP_DOWNUP' },
    { campaign: 'Courtesy', from: '2026-09-14', to: '2026-09-25', sales: 50, gwpEx: 4300, target: 80, pctT: 0.63, act: 10, emp: 10, plan: 'EXP_COURTESY' }];
  const mover = { code: 'CB121', name: 'Joeline Muniappen', tl: 'Denise Haripersad', campaign: 'Courtesy', tenure: 'EXP', plan: 'EXP_COURTESY',
    sales: 110, gwpEx: 6387, target: 152, pctT: 0.72, act: 19, emp: 19, days: [], segments: segs };
  P.setTeam(null);
  P.setD({ ...DIGEST, role: 'agent', workingDays: 22, period: { from: '2026-09-01', to: '2026-09-30' }, dates: ['2026-09-25'], agents: [mover],
    comm: { saleValue: 77.39, saleValues: { EXP_DOWNUP: 34.78 }, brackets: { EXP_DOWNUP: [{ gwp: 1000, comm: 100 }, { gwp: 3000, comm: 450 }], EXP_COURTESY: [{ gwp: 5000, comm: 500 }, { gwp: 12000, comm: 1800 }] } } });
  P.setMe(mover);
  const s = P.campaignSplitHTML(mover).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/Your month by campaign/.test(s) || !/moved to Courtesy on 14 Sep/.test(s)) throw new Error('the split card does not say where and when the agent moved: ' + s.slice(0, 200));
  if (!/Download &(amp;)? Test 0?1 Sept? – 11 Sept? 60/.test(s) || !/Courtesy 14 Sept? – 25 Sept? 50/.test(s)) throw new Error('each campaign\'s own days and sales are not shown: ' + s.slice(0, 400));
  if (!/Whole month 110/.test(s)) throw new Error('the whole-month row is missing or not the published total');
  if (P.campaignSplitHTML({ ...mover, segments: undefined }) !== '') throw new Error('a non-mover gets a split card');
  const c = P.commissionSplitHTML(mover).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/Commission by campaign — a projection/.test(c) || !/still to be confirmed by management/.test(c)) throw new Error('the commission split is not labelled a projection pending sign-off');
  if (!/Download &(amp;)? Test .{0,80}R/.test(c) || !/Courtesy .{0,80}R/.test(c) || !/Split total/.test(c)) throw new Error('the commission split rows are missing: ' + c.slice(0, 300));
  ok('a mover sees each campaign\'s own days beside the whole month, and commission per plan labelled a projection');
} catch (e) { bad('campaign split on the agent page', e.message); }

/* THE HELP CENTER ICON + NICK'S SIX STEPS ON SCREEN (sprint 2026-09-29, D5) */
try {
  P.setTeam({ name: 'Denise Haripersad', role: 'team_leader' }); P.setD({ ...DIGEST, role: 'team_leader' });
  P.setHelpUnread(0);
  if (/nav-badge/.test(P.sidebarHTML('team'))) throw new Error('an icon shows with nothing unread');
  P.setHelpUnread(2);
  const side = P.sidebarHTML('team');
  const helpBtn = (side.match(/<button[^>]*data-view="help"[^>]*>[\s\S]*?<\/button>/) || [''])[0];
  if (!/class="nav-badge"[^>]*>[^<]*2<\/span>/.test(helpBtn)) throw new Error('the Help Center tab does not carry the count: ' + helpBtn.slice(0, 200));
  if (/nav-badge/.test(side.replace(helpBtn, ''))) throw new Error('the icon sits on a tab other than the Help Center');
  P.setHelpUnread(0);
  ok('the Help Center tab carries an icon with the unread count, and nothing when there is none');

  P.setHelpD({ stages: [{ id: 's0', name: 'New' }, { id: 's1', name: 'In progress' }, { id: 's2', name: 'Waiting on agent' }, { id: 's3', name: 'Closed' }],
    requests: [
      { id: 'a', cb: 'CB9', agent: 'New Asker', category: 'Review my call', stageId: 's0', stageIdx: 0, closed: false, created: '2026-09-29T08:00:00Z' },
      { id: 'b', cb: 'CB8', agent: 'Seen Asker', category: 'Explain the product', stageId: 's1', stageIdx: 1, closed: false, created: '2026-09-29T07:00:00Z', seenAt: '2026-09-29T07:30:00Z', seenBy: 'Denise Haripersad' },
      { id: 'c', cb: 'CB7', agent: 'Done Asker', category: 'Something else', stageId: 's2', stageIdx: 2, closed: false, awaitingAgent: true, created: '2026-09-29T06:00:00Z', seenAt: '2026-09-29T06:10:00Z' }] });
  const hp = P.helpPage().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/Review my call .{0,40}new — not opened yet/.test(hp)) throw new Error('an unopened request is not marked new');
  if (!/Explain the product .{0,40}seen 29 Sep/.test(hp)) throw new Error('a seen request does not say when it was seen');
  if (!/waiting for the agent to confirm/.test(hp)) throw new Error('a done request does not say it waits on the agent');
  P.setHelpD(null);
  ok('the team leader\'s rows read new → seen → waiting for the agent to confirm');

  P.setTeam(null);
  const me = { code: 'CB9', name: 'Agent Nine', tl: 'Denise Haripersad', campaign: 'Courtesy', tenure: 'M1', plan: 'M1', days: [] };
  P.setD({ ...DIGEST, role: 'agent', agents: [me] }); P.setMe(me);
  P.setMyHelp({ requests: [
    { id: 'x', category: 'Review my call', stage: 'Waiting on agent', closed: false, awaitingAgent: true, created: '2026-09-29T06:00:00Z', seenAt: '2026-09-29T06:10:00Z', seenBy: 'Denise Haripersad' },
    { id: 'y', category: 'Explain the product', stage: 'New', closed: false, created: '2026-09-29T08:00:00Z' }] });
  const mh = P.pgMyHelp();
  const mt = mh.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  if (!/seen by Denise Haripersad 29 Sep/.test(mt)) throw new Error('the agent does not see who opened their request');
  if (!/not opened yet/.test(mt)) throw new Error('an unopened request does not say so to the agent');
  if (!/Did Denise sort it out\?/.test(mt) || !/myhelp-yes/.test(mh) || !/myhelp-no/.test(mh)) throw new Error('a done request does not ask the agent to confirm');
  if ((mh.match(/myhelp-close/g) || []).length !== 1) throw new Error('"Close it off" should remain only on the request not yet done');
  P.setMyHelp(null);
  ok('the agent sees who opened their request and confirms a done one (Yes, I was helped / Not yet)');
} catch (e) { bad('Help Center icon + six steps on screen', e.message); }
P.setTeam(null);

{
  /* The projection must divide by the month's WORKING days, not the days we have
     data for. Sending elapsed days told an agent on 23 August she had 1 day left
     and needed R2,012 a day — 26 sales in a day — instead of 3 a day over 8. */
  /workingDays:\(function\(\)\{/.test(PULSE)
    ? ok('PULSE publishes workingDays (weekdays in the period), not just elapsed days')
    : bad('PULSE does not publish workingDays — the projection would divide by elapsed days');
  const usesElapsed = /commCalc\([^)]*D\.diallingDays/.test(PAGE);
  usesElapsed
    ? bad('the calculator is still fed diallingDays (elapsed), not workingDays')
    : ok('the calculator is fed the month’s working days');
}

head('Change my password (Nick, 2026-09-08)');
/* CHANGE MY PASSWORD (Nick, 2026-09-08): in the user card for every role, current password required, forced mode unchanged */
/id="pwBtn"/.test(PAGE) ? ok('the user card carries a Change-password button (every role sees the same card)') : bad('no Change-password button in the user card');
/pwBtn'\)[^\n]*changePassword\(true\)/.test(PAGE) ? ok('the button opens the voluntary change screen') : bad('the Change-password button is not wired');
/body\.current_password\s*=\s*cur/.test(PAGE) ? ok('a voluntary change sends the current password for the Worker to verify') : bad('the voluntary change does not send the current password');
/if\(U\.must_change_password\) return changePassword\(\);/.test(PAGE) ? ok('the forced first-sign-in change still runs without asking for the current password') : bad('forced change path altered');

head('Links tab (Nick, 2026-09-08) — agent view only');
/\['links','Links',ICON\.links\]/.test(PAGE) ? ok('the agent nav carries a Links tab') : bad('no Links tab on the agent nav');
!/TL_VIEWS=\[[^\]]*'links'/.test(PAGE) && !/CM_VIEWS=\[[^\]]*'links'/.test(PAGE) ? ok('team leaders and campaign managers do NOT get the tab (agent view only)') : bad('Links leaked onto a management nav');
/function linksPage\(\)/.test(PAGE) && /VIEW==='links' \? linksPage\(\)/.test(PAGE) ? ok('the view renders linksPage()') : bad('links view not wired');
/indexOf\('data:image\/'\)===0/.test(PAGE) ? ok('only a data-URI screenshot the Worker served is ever painted') : bad('screenshot source not guarded');
/rel="noopener noreferrer"/.test(PAGE) && /lk-off/.test(PAGE) ? ok('live links open in a new tab; a link without an address is shown greyed, never invented') : bad('link cards missing the safe-open or the greyed state');

await Promise.all(PENDING);
head(fails ? `\x1b[31m${fails} of ${checks} checks FAILED — do not deploy\x1b[0m`
           : `\x1b[32mAll ${checks} checks passed\x1b[0m`);
process.exit(fails ? 1 : 0);
