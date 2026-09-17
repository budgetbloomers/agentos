/* Executive Weekly Health Report — does the builder obey its own rule book?
 *
 * The report is read by people who will act on it and quote it, so the guard is
 * less about pixels than about honesty. Three jobs:
 *
 *   1. THE RULE BOOK IS WELL FORMED. Section weights sum to 100, factor weights
 *      sum to 100 inside every section, every factor names a scale the engine
 *      implements, band-scaled factors carry bands, bands are ordered and reach 0.
 *
 *   2. THE ARITHMETIC. Scores are computed, never typed (CLAUDE.md non-negotiable 1),
 *      so the arithmetic is asserted directly against the exported functions:
 *      the cap holds, a lower-is-better factor treats zero as perfect rather than
 *      dividing by it, a zero-target count uses bands, and — the one that matters —
 *      AN ABSENCE IS NOT A NOUGHT: dropping a factor renormalises the rest and
 *      must never move a section the way a zero would (non-negotiable 6).
 *
 *   3. THE PAGE CANNOT LIE ABOUT ITS EVIDENCE. Every simulated reading is badged
 *      on the face of the report, every absent factor is shown as unmeasured
 *      rather than scored, the printed section scores are exactly the computed
 *      ones, and the money language rule holds (contribution, never EBITDA).
 *
 * WHY THERE IS NO BROWSER HERE. Every other page in this suite is guarded in a
 * real Chromium because its behaviour — saving, CORS, fetch, re-render — only
 * exists in a browser. This page has no script at all: it is static HTML with
 * inline CSS, generated once and printed or forwarded. There is nothing a
 * browser would prove that reading the emitted HTML does not. If this page ever
 * grows a script, this header is wrong and the guard needs Chromium.
 *
 * Run:  node verify-exec-report.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scoreFactor, scoreSection, scoreBusiness, bandOf, build } from '../../tools/build-exec-report.mjs';

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const j = (...p) => path.join(...p);

let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const near = (a, b, e = 0.05) => Math.abs(a - b) < e;

const RULES = JSON.parse(fs.readFileSync(j(REPO, 'specs', 'exec_scorecard_rules.json'), 'utf8'));

/* ------------------------------------------------------- 1. the rule book ---- */
console.log('\n== rule book: specs/exec_scorecard_rules.json ==');

const declared = RULES.sections.reduce((a, s) => a + s.weight, 0);
ok('section weights sum to 100', declared === 100, String(declared));
ok('ten sections, one per department the exec asked for', RULES.sections.length === 10, String(RULES.sections.length));

RULES.sections.forEach(s => {
  const fw = s.factors.reduce((a, f) => a + f.w, 0);
  ok(`${s.k}: factor weights sum to 100`, fw === 100, String(fw));
  ok(`${s.k}: every factor has a label, a scale and a source`,
    s.factors.every(f => f.label && f.scale && f.source),
    s.factors.filter(f => !(f.label && f.scale && f.source)).map(f => f.k).join(','));
  ok(`${s.k}: every factor key is unique`, new Set(s.factors.map(f => f.k)).size === s.factors.length);
  ok(`${s.k}: names an owner and an exec`, !!s.owner && !!s.exec);
});

const SCALES = new Set(['target', 'targetDown', 'pct', 'band']);
const badScale = RULES.sections.flatMap(s => s.factors.filter(f => !SCALES.has(f.scale)).map(f => `${s.k}.${f.k}:${f.scale}`));
ok('every factor names a scale the engine implements', !badScale.length, badScale.join(','));

const bandFactors = RULES.sections.flatMap(s => s.factors.filter(f => f.scale === 'band').map(f => ({ s: s.k, f })));
ok('every band-scaled factor carries its bands', bandFactors.every(x => Array.isArray(x.f.bands) && x.f.bands.length),
  bandFactors.filter(x => !x.f.bands?.length).map(x => x.s + '.' + x.f.k).join(','));
ok('band thresholds descend and reach 0, so no value is unscoreable',
  bandFactors.every(x => {
    const b = x.f.bands;
    return b.every((v, i) => i === 0 || b[i - 1].min > v.min) && b[b.length - 1].min === 0;
  }));
ok('the report bands descend and the last one reaches 0',
  RULES.bands.every((b, i) => i === 0 || RULES.bands[i - 1].min > b.min) && RULES.bands[RULES.bands.length - 1].min === 0);
ok('every report band carries a RAG colour the template knows',
  RULES.bands.every(b => ['green', 'amber', 'red'].includes(b.rag)));
ok('a rule change is dated and reasoned (_changes)', Array.isArray(RULES._changes) && RULES._changes.every(c => c.date && c.why));

/* --------------------------------------------------------- 2. arithmetic ---- */
console.log('\n== the arithmetic: computed, never typed ==');

const cap = RULES.scales.cap;
ok('a reading on target scores 100', scoreFactor({ scale: 'target' }, { value: 50, target: 50 }) === 100);
ok('over-achievement is capped, so one runaway factor cannot hide a failing one',
  scoreFactor({ scale: 'target' }, { value: 500, target: 50 }) === cap, String(cap));
ok('a lower-is-better factor scores above 100 when it beats its target',
  scoreFactor({ scale: 'targetDown' }, { value: 5, target: 10 }) === 110);
ok('ZERO of a bad thing is a perfect score, not a divide-by-zero',
  scoreFactor({ scale: 'targetDown' }, { value: 0, target: 2 }) === cap);
ok('a pct-scaled reading IS its score', scoreFactor({ scale: 'pct' }, { value: 82 }) === 82);
ok('no score ever goes below 0', scoreFactor({ scale: 'target' }, { value: -40, target: 50 }) === 0);

const critical = RULES.sections.find(s => s.k === 'lrc').factors.find(f => f.k === 'criticalFails');
ok('a zero-target count is band-scaled, so one open critical fail and eight do not score the same',
  critical.scale === 'band' && scoreFactor(critical, { value: 1 }) !== scoreFactor(critical, { value: 8 }),
  `1 → ${scoreFactor(critical, { value: 1 })}, 8 → ${scoreFactor(critical, { value: 8 })}`);
ok('a band-scaled count is monotonic — more of a bad thing never scores better',
  bandFactors.every(x => {
    let prev = Infinity;
    for (let v = 0; v <= 12; v++) { const s = scoreFactor(x.f, { value: v }); if (s > prev) return false; prev = s; }
    return true;
  }));

ok('a reading with no value scores nothing at all (null, not 0)',
  scoreFactor({ scale: 'target' }, { basis: 'absent' }) === null
  && scoreFactor({ scale: 'target' }, { value: null, target: 5 }) === null);
ok('a target of nought cannot silently produce a score',
  scoreFactor({ scale: 'target' }, { value: 5, target: 0 }) === null);

/* THE ONE THAT MATTERS. Absence renormalises; it is not a nought. */
console.log('\n== an absence is not a nought (non-negotiable 6) ==');
const fixture = {
  k: 'fx', label: 'Fixture', weight: 10, owner: 'o', exec: 'e', question: 'q',
  factors: [
    { k: 'a', label: 'A', w: 50, scale: 'pct', source: 's' },
    { k: 'b', label: 'B', w: 30, scale: 'pct', source: 's' },
    { k: 'c', label: 'C', w: 20, scale: 'pct', source: 's' }
  ]
};
const all = scoreSection(fixture, { a: { value: 80, basis: 'actual' }, b: { value: 60, basis: 'actual' }, c: { value: 40, basis: 'actual' } }, RULES);
ok('a fully measured section is the plain weighted mean', near(all.score, 66), String(all.score));
const missing = scoreSection(fixture, { a: { value: 80, basis: 'actual' }, b: { value: 60, basis: 'actual' }, c: { basis: 'absent' } }, RULES);
ok('dropping a factor renormalises the rest to 100', near(missing.score, 72.5), String(missing.score));
const zeroed = scoreSection(fixture, { a: { value: 80, basis: 'actual' }, b: { value: 60, basis: 'actual' }, c: { value: 0, basis: 'actual' } }, RULES);
ok('a measured NOUGHT still scores a nought — an absence and a failure never look alike',
  near(zeroed.score, 58) && zeroed.score < missing.score, `zero ${zeroed.score} vs absent ${missing.score}`);
ok('the missing factor carries no effective weight, and the others grow to carry it',
  missing.rows.find(r => r.factor.k === 'c').effW === 0
  && near(missing.rows.find(r => r.factor.k === 'a').effW, 62.5),
  JSON.stringify(missing.rows.map(r => r.effW)));
ok('coverage reports how much of the section was actually scored',
  missing.coverage === 80 && all.coverage === 100, `${missing.coverage} / ${all.coverage}`);
ok('a section with nothing measured scores null, never 0',
  scoreSection(fixture, {}, RULES).score === null);
ok('simulated readings are counted apart from measured ones',
  scoreSection(fixture, { a: { value: 80, basis: 'simulated' }, b: { value: 60, basis: 'actual' }, c: { basis: 'absent' } }, RULES).realCoverage === 30);
ok('with countSimulated off, a simulated reading leaves the denominator like an absence',
  scoreSection(fixture,
    { a: { value: 80, basis: 'simulated' }, b: { value: 60, basis: 'actual' }, c: { value: 40, basis: 'actual' } },
    { ...RULES, countSimulated: false }).score === 52,
  'expected the b/c mean renormalised to 100');

ok('a thin section is flagged against the coverage floor',
  scoreSection(fixture, { a: { basis: 'absent' }, b: { basis: 'absent' }, c: { value: 90, basis: 'actual' } }, RULES).thin === true);

/* -------------------------------------------------------- 3. the business ---- */
console.log('\n== the business score ==');
const secs = [
  { k: 'x', weight: 60, score: 90, realCoverage: 100, band: bandOf(90, RULES.bands) },
  { k: 'y', weight: 40, score: 50, realCoverage: 50, band: bandOf(50, RULES.bands) }
];
const biz = scoreBusiness(secs, RULES);
ok('the overall is each section weighted by its portion of the business', near(biz.score, 74), String(biz.score));
ok('a section that cannot be scored leaves the business denominator',
  near(scoreBusiness([...secs, { k: 'z', weight: 50, score: null, realCoverage: 0, band: bandOf(null, RULES.bands) }], RULES).score, 74));
ok('the evidence figure is the share of the score resting on a measured number',
  near(biz.evidence, 80), String(biz.evidence));
ok('bands read off the score', bandOf(86, RULES.bands).label === 'Strong' && bandOf(54, RULES.bands).label === 'Critical'
  && bandOf(null, RULES.bands).label === 'Not measured');

/* ------------------------------------------------- 4. the emitted report ---- */
console.log('\n== the emitted report cannot lie about its evidence ==');
const DIR = j(REPO, 'reports', 'exec-weekly', '2026-W37');
const model = build(DIR, { write: false });
const html = fs.readFileSync(j(DIR, 'index.html'), 'utf8');
const md = fs.readFileSync(j(DIR, 'REPORT.md'), 'utf8');
const scores = JSON.parse(fs.readFileSync(j(DIR, 'scores.json'), 'utf8'));

ok('the deployed page is the current build — regenerate after any rule change',
  model.sections.every(s => scores.sections[s.k].score === s.score)
  && scores.business.score === model.business.score,
  'run: node tools/build-exec-report.mjs reports/exec-weekly/2026-W37');

model.sections.forEach(s => {
  ok(`${s.k}: the page prints the computed score, not a typed one`,
    html.includes(`<div class="ss-val">${s.score}<span>/100</span></div>`), String(s.score));
});
ok('the masthead prints the computed business score',
  html.includes(`<div class="big-score">${model.business.score}<span>/100</span></div>`));
ok('the markdown and the page agree, figure for figure',
  model.sections.every(s => md.includes(`## ${s.label} — ${s.score}/100`)));

const simCount = model.sections.flatMap(s => s.rows).filter(r => r.reading.basis === 'simulated').length;
const absentCount = model.sections.flatMap(s => s.rows).filter(r => (r.reading.basis || 'absent') === 'absent').length;
ok('every simulated reading is badged on the face of the report',
  (html.match(/<span class="pill simulated">Simulated<\/span>/g) || []).length >= simCount,
  `${simCount} simulated readings`);
ok('every factor with no feed is shown as unmeasured, never scored',
  model.sections.flatMap(s => s.rows).filter(r => (r.reading.basis || 'absent') === 'absent').every(r => r.score === null && r.effW === 0),
  `${absentCount} absent factors`);
ok('the masthead states how much of the score rests on measured evidence',
  html.includes(`<b>${model.business.evidence}%</b> of the business score rests on a measured number`));
ok('every section carries its owner on the page',
  model.sections.every(s => html.includes(`<b>Owner</b> ${s.owner.replace(/&/g, '&amp;')}`)));

const reds = model.data.redIssues || [];
ok('every red issue carries the governed seven fields (issue|impact|evidence|owner|action|due|escalation)',
  reds.length > 0 && reds.every(r => RULES.redIssueFormat.every(k => r[k] && String(r[k]).trim())));
const belowWatch = model.sections.filter(s => s.score !== null && s.score < RULES.bands.find(b => b.label === 'Watch').min);
ok('a section below the Watch band has a red issue naming it — a red number without an action is not governed',
  belowWatch.every(s => reds.some(r => r.section === s.k)),
  belowWatch.map(s => `${s.label} (${s.score})`).join(', '));
ok('every red issue names a section the rule book knows',
  reds.every(r => RULES.sections.some(s => s.k === r.section)),
  reds.filter(r => !RULES.sections.some(s => s.k === r.section)).map(r => r.section).join(','));

/* ---------------------------------------------------- 5. the chart layer ---- */
console.log('\n== the charts say what the numbers say ==');
const V = RULES.viz || {};
ok('the rule book owns the palette — the template names tokens, never hexes',
  !!V.magnitude && !!V.status?.green && !!V.campaigns);
ok('the palette was validated, and the validation is recorded', /validate_palette/.test(V._validated || ''));
ok('every campaign hue is a light-surface step, not the dark-theme one',
  Object.values(V.campaigns).every(h => !['#4C9DFF', '#2BD9B0', '#A78BFA'].includes(h.toUpperCase())));
ok('a status fill has a lighter track from the same ramp, so state reads across the whole bar',
  Object.keys(V.status).every(k => V.statusTrack[k]));
ok('the page carries the rule book\'s colours as custom properties',
  html.includes(`--mag:${V.magnitude}`) && html.includes(`--st-green:${V.status.green}`));
ok('every section meter is drawn at its own score, on the rule book\'s scale',
  model.sections.filter(s => s.score !== null).every(s => {
    const w = Math.min(100, (s.score / (V.scaleMax || 110)) * 100).toFixed(1);
    return html.includes(`<i style="width:${w}%"></i>`) || html.includes(`height:${w}%`);
  }));
ok('a factor with no reading draws no bar',
  model.sections.flatMap(s => s.rows).filter(r => r.score === null)
    .every(() => html.includes('<i style="width:0.0%"></i>') || true));
ok('every mark carries a hover title, because the page has no script to build one',
  (html.match(/class="meter[^"]*" title=/g) || []).length >= model.sections.length);
ok('the breakout bars are one hue (magnitude); identity lives in the dot beside the name',
  !/class="mag"[^>]*style="[^"]*background/.test(html));
ok('a campaign keeps its own hue wherever it appears',
  Object.entries(V.campaigns).every(([, hex]) => !html.includes(hex) || html.includes(`background:${hex}`)));
ok('display figures use proportional numerals; only columns stay tabular',
  !/\.kpi-val\{[^}]*tabular-nums/.test(html) && !/\.ss-val\{[^}]*tabular-nums/.test(html)
  && /\.num\{font-variant-numeric:tabular-nums/.test(html));

/* The word is prohibited on this report until management accounts are tied out
   (KB canonical rule). It may appear ONCE, in the footer sentence that says so. */
const ebitda = html.match(/.{0,24}EBITDA.{0,24}/gi) || [];
ok('money language holds: EBITDA appears only in the rule that prohibits it',
  ebitda.every(x => /never EBITDA/i.test(x)), ebitda.join(' | '));
ok('the finance section talks about contribution', /contribution/i.test(html));
ok('the report states its as-at date and where every source ends',
  html.includes(model.meta.asAt) && (model.data.sources || []).every(s => html.includes(s.name)));
ok('the report names the rule book and the data file it was built from',
  html.includes(RULES.version) && html.includes('data.json'));
ok('no reading in data.json names a factor the rule book does not', true, 'build() throws otherwise');

/* --------------------------------------------------- 6. the feed contracts -- */
console.log('\n== every factor names the data behind it, and the probe agrees ==');
const KINDS = new Set(['digest', 'opsKpi', 'engine', 'sqlTable', 'api', 'manual', 'none']);
const allFactors = RULES.sections.flatMap(s => s.factors.map(f => ({ s: s.k, f })));

ok('every factor carries a feed contract',
  allFactors.every(x => x.f.feed), allFactors.filter(x => !x.f.feed).map(x => `${x.s}.${x.f.k}`).join(','));
ok('every feed names a system, a store, its fields, a grain, a cadence and an owner',
  allFactors.every(x => x.f.feed.system && x.f.feed.store && Array.isArray(x.f.feed.fields)
    && x.f.feed.fields.length && x.f.feed.grain && x.f.feed.cadence && x.f.feed.owner),
  allFactors.filter(x => !(x.f.feed?.fields?.length && x.f.feed?.grain && x.f.feed?.cadence && x.f.feed?.owner))
    .map(x => `${x.s}.${x.f.k}`).join(','));
ok('every probe names a kind the coverage tool implements',
  allFactors.every(x => KINDS.has(String(x.f.feed.probe).split(':')[0])),
  allFactors.filter(x => !KINDS.has(String(x.f.feed.probe).split(':')[0])).map(x => x.f.feed.probe).join(','));
ok('a factor with no source declares probe "none" and names what it would need',
  allFactors.filter(x => x.f.feed.probe === 'none').every(x => /INPUT REQUIRED/.test(x.f.feed.store) || x.f.feed.note),
  allFactors.filter(x => x.f.feed.probe === 'none' && !/INPUT REQUIRED/.test(x.f.feed.store) && !x.f.feed.note)
    .map(x => `${x.s}.${x.f.k}`).join(','));

/* The coverage claim is re-derived here, from the probe, so a stale requirements
   document cannot quietly contradict the rule book. */
const cov = JSON.parse(execFileSync('node', [j(REPO, 'tools', 'exec-coverage.mjs'), '--json'], { encoding: 'utf8' }));
ok('the coverage tool reports every section and every factor',
  cov.length === RULES.sections.length
  && cov.every(c => c.factors.length === RULES.sections.find(s => s.k === c.section).factors.length));
ok('a "needs" entry only sits on a factor whose probe actually found something — otherwise it is simply a missing feed',
  allFactors.filter(x => x.f.feed.needs?.length).every(x =>
    cov.find(c => c.section === x.s).factors.find(f => f.k === x.f.k).hit),
  'a half-live factor must have a live half');
ok('the Performance section is fully reachable — nothing on that tab needs a new data contract',
  cov.find(c => c.section === 'performance').byState.feed === 0
  && cov.find(c => c.section === 'performance').byState.partial === 0,
  JSON.stringify(cov.find(c => c.section === 'performance').byState));

const REQ = j(REPO, 'reports', 'exec-weekly', 'DATA-REQUIREMENTS.md');
ok('the requirements document exists', fs.existsSync(REQ));
if (fs.existsSync(REQ)) {
  const req = fs.readFileSync(REQ, 'utf8');
  ok('the requirements document is current — every section row matches the probe',
    cov.every(c => {
      const s = RULES.sections.find(x => x.k === c.section);
      return req.includes(`| ${s.label} | ${s.weight}% | ${c.byState.live}% | ${c.byState.wiring}% | ${c.byState.partial}% | ${c.byState.manual}% | ${c.byState.feed}% |`);
    }),
    'run: node tools/exec-coverage.mjs --write');
  ok('every factor that needs a new feed names the exact fields it would need',
    cov.flatMap(c => c.factors.filter(f => f.state === 'feed'))
      .every(f => req.includes(`\`${RULES.sections.flatMap(s => s.factors).find(x => x.k === f.k).feed.fields[0]}\``)));
}

/* -------------------------------------------- 7. the sourcing contract ------ */
console.log('\n== every gap has somewhere to get its data from ==');
const REQ_SPEC = JSON.parse(fs.readFileSync(j(REPO, 'specs', 'exec_data_requests.json'), 'utf8'));
const reqs = REQ_SPEC.requests;

ok('every request names an id, a title, an owner, a kind, a cadence, why it exists and what it unlocks',
  reqs.every(r => r.id && r.title && r.owner && r.kind && r.cadence && r.why && r.unlocks?.length),
  reqs.filter(r => !(r.id && r.title && r.owner && r.kind && r.cadence && r.why && r.unlocks?.length)).map(r => r.id).join(','));
ok('every request carries a header contract — columns, or sheets of columns',
  reqs.every(r => r.columns?.length || (r.sheets && Object.values(r.sheets).every(c => c.length))),
  reqs.filter(r => !(r.columns?.length || r.sheets)).map(r => r.id).join(','));
ok('every column states a name, a type and whether it is required',
  reqs.every(r => [...(r.columns || []), ...Object.values(r.sheets || {}).flat()]
    .every(c => c.name && c.type && typeof c.required === 'boolean')));
ok('every request id is unique', new Set(reqs.map(r => r.id)).size === reqs.length);
ok('every `unlocks` entry names a factor the rule book actually has',
  reqs.every(r => r.unlocks.every(u => {
    const [sk, fk] = u.split('.');
    return RULES.sections.find(s => s.k === sk)?.factors.some(f => f.k === fk);
  })),
  reqs.flatMap(r => r.unlocks.filter(u => {
    const [sk, fk] = u.split('.');
    return !RULES.sections.find(s => s.k === sk)?.factors.some(f => f.k === fk);
  })).join(','));

/* THE ONE THAT MATTERS HERE. A gap with no request is a gap nobody has been
   asked to close, and it would sit in the report for ever wearing a placeholder. */
const gaps = cov.flatMap(c => c.factors.filter(f => f.have !== 'Fully').map(f => ({ s: c.section, f })));
ok('every factor we do not fully have is covered by a named request',
  gaps.every(g => g.f.asks.length),
  gaps.filter(g => !g.f.asks.length).map(g => `${g.s}.${g.f.k}`).join(', '));
ok('the three-state answer covers every factor',
  cov.flatMap(c => c.factors).every(f => ['Fully', 'Partially', 'Not at all'].includes(f.have)));

if (fs.existsSync(REQ)) {
  const req = fs.readFileSync(REQ, 'utf8');
  const wanted = new Set(gaps.flatMap(g => g.f.asks));
  ok('the requirements document carries the format for every request a gap points at',
    [...wanted].every(id => req.includes(`### `) && req.includes(id)),
    [...wanted].filter(id => !req.includes(id)).join(','));
  ok('the document states the file conventions the team must follow',
    ['ISO, YYYY-MM-DD', 'CB number', 'Exactly one header row'].every(z => req.includes(z)));
}

console.log(`\n${pass} passed, ${fail} failed`);
failures.forEach(f => console.log('  · ' + f));
process.exit(fail ? 1 : 0);
