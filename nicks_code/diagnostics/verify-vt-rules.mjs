/* VT RULE BOOK DRIFT GUARD (Spec Kit 071, plan §RB).
 *
 * The VT rule book has two copies, like every rule book in this repo: specs/vt_engine_rules.json
 * (the record) and VT_RULES inlined in nicks_code/vt-engine.js (what the engine reads; inlined
 * because PULSE runs from file://). This fails when:
 *   1. any operative key (every key not starting with '_') differs between the two copies;
 *   2. VT vat differs from MTD_RULES vat, or VT extraHolidays differ from the VAS one-off holidays;
 *   3. a budget block has no _cells reference, or _changes[] is missing its first dated entry;
 *   4. vt-engine.js (outside VT_RULES and the holiday mirror) or agent/vt-view.js carries its own
 *      copy of a rule literal (0.85, 0.05, 26, 6.5 ...) — the verify-rule-constants pattern;
 *   5. the driver weights do not total 100, or the bands differ from the VAS composite bands.
 *
 * Run:  node verify-vt-rules.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const ENGINE = path.join(REPO, 'nicks_code', 'vt-engine.js');
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const finish = () => { console.log(`\n${pass} passed, ${fail} failed`); failures.forEach(f => console.log('  · ' + f)); process.exit(fail ? 1 : 0); };

if (!fs.existsSync(ENGINE)) { ok('nicks_code/vt-engine.js exists', false, 'missing'); finish(); }
const E = require(ENGINE);
const SPEC = JSON.parse(fs.readFileSync(path.join(REPO, 'specs', 'vt_engine_rules.json'), 'utf8'));
const MTD = JSON.parse(fs.readFileSync(path.join(REPO, 'specs', 'mtd_engine_rules.json'), 'utf8'));
const COMP = JSON.parse(fs.readFileSync(path.join(REPO, 'specs', 'composite_rules.json'), 'utf8'));

const operative = v => Array.isArray(v) ? v.map(operative)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).filter(k => !k.startsWith('_')).sort().map(k => [k, operative(v[k])]))
  : v;
function diff(a, b, at, out) {
  if (out.length > 20) return out;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { out.push(at + ' (array length/type)'); return out; }
    a.forEach((x, i) => diff(x, b[i], at + '[' + i + ']', out)); return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], at + '.' + k, out); return out;
  }
  if (a !== b) out.push(`${at}: json ${JSON.stringify(a)} vs inlined ${JSON.stringify(b)}`);
  return out;
}

console.log('\n== 1. drift: specs/vt_engine_rules.json vs VT_RULES in vt-engine.js ==');
const d = diff(operative(SPEC), operative(E.VT_RULES), 'rules', []);
ok('every operative key equals its inlined copy', d.length === 0, d.slice(0, 8).join(' | '));
ok('version matches', SPEC.version === E.VT_RULES.version, SPEC.version + ' vs ' + E.VT_RULES.version);
ok('the inlined copy carries no _ prose keys (operative subset only)', JSON.stringify(E.VT_RULES).indexOf('"_') === -1);

console.log('\n== 2. shared values agree with the VAS rule books ==');
ok('vat equals MTD_RULES vat (mtd_engine_rules.json vat_multiplier)', E.VT_RULES.vat === MTD.reference_data.vat_multiplier.value,
  E.VT_RULES.vat + ' vs ' + MTD.reference_data.vat_multiplier.value);
ok('extraHolidays equal the VAS one-off public holidays', JSON.stringify(E.VT_RULES.periods.extraHolidays) === JSON.stringify(MTD.reference_data.public_holidays.extra),
  JSON.stringify(E.VT_RULES.periods.extraHolidays) + ' vs ' + JSON.stringify(MTD.reference_data.public_holidays.extra));
ok('bands equal the VAS composite bands', JSON.stringify(E.VT_RULES.rating.bands) === JSON.stringify(COMP.bands.map(b => ({ label: b.label, min: b.min }))),
  JSON.stringify(COMP.bands));
ok('driver weights total 100', E.VT_RULES.rating.drivers.reduce((s, x) => s + x.w, 0) === 100);
ok('vt-1.2: two drivers, targetAch 50 / fitRate 50 (Missed Rate and Fitted vs target removed as double counting)',
  E.VT_RULES.rating.drivers.map(x => x.k + ':' + x.w + ':' + x.dir).join(',') === 'targetAch:50:higher,fitRate:50:higher');
ok('the rule book is version vt-1.3 (vt-1.2 drivers kept; vt-1.3 adds detection.vtBiFitted.nameHint)', E.VT_RULES.version === 'vt-1.3', E.VT_RULES.version);
ok('vt-1.3: the BI header is shared with the VAS BI Active export, so detection.vtBiFitted carries nameHint "fitted" and the engine tests names with it',
  E.VT_RULES.detection.vtBiFitted.nameHint === 'fitted' && E.isBiFittedName('BI Active Fitted 231126.xlsx') && !E.isBiFittedName('BI Active 231126.xlsx'), E.VT_RULES.detection.vtBiFitted.nameHint);
{ const c = SPEC._changes.find(x => x.date === '2026-11-24' && x.key === 'detection.vtBiFitted.nameHint');
  ok('a dated _changes[] entry (2026-11-24) says the BI header is shared with the VAS BI Active export and the slot + name decide', !!c && /shared with the VAS BI Active export/.test(c.why) && /slot and the file name/.test(c.why) && /incident 2026-11-24/.test(c.why), c && c.why.slice(0, 120)); }
{ const c = SPEC._changes.find(x => x.date === '2026-11-24' && /rating\.drivers/.test(x.key));
  ok('a dated _changes[] entry (2026-11-24) names the reason (double counting, ~12 points for one missed sale) and who decided', !!c && /double counting/i.test(c.why) && /12 points/.test(c.why) && /owner/.test(c.by) && /vt-1\.2/.test(c.to), c && c.by); }
ok('Missed Rate and Fitted vs target are named as not scored, with the reason', /double counting/.test(E.VT_RULES.rating.notScored.missRate || '') && /Fitment Rate/.test(E.VT_RULES.rating.notScored.fittedVsTarget || ''));
ok('the card\'s unscored info fields are listed in the rule book and are not drivers', Array.isArray(E.VT_RULES.rating.info) && ['missed', 'missRate', 'cancelled', 'canRate', 'fitDone'].every(k => E.VT_RULES.rating.info.includes(k)) && !E.VT_RULES.rating.drivers.some(d => E.VT_RULES.rating.info.includes(d.k)));

console.log('\n== 3. evidence and history ==');
for (const [ck, b] of Object.entries(SPEC.budgets)) {
  const cells = b._cells || {};
  for (const k of Object.keys(b).filter(k => !k.startsWith('_') && k !== 'avgGwpShownNotScored'))
    ok(`budget ${ck}.${k} cites its cells`, typeof cells[k] === 'string' && cells[k].length > 5);
}
ok('_changes[] first entry is dated 2026-11-23', Array.isArray(SPEC._changes) && SPEC._changes[0] && SPEC._changes[0].date === '2026-11-23');
ok('every _changes[] entry has date/by/key/why', SPEC._changes.every(c => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.by && c.key && c.why));
ok('no _evidence prose left in the record', JSON.stringify(SPEC).indexOf('"_evidence"') === -1);

console.log('\n== 3b. derived cancellation (2026-11-23): rule book ⇔ SQL checks ==');
{ const C = E.VT_RULES.status.cancellation, M71 = fs.readFileSync(path.join(REPO, 'supabase', 'migration-071-vt-facts.sql'), 'utf8');
  ok('cancelledFrom names exactly the cancellation reasons', JSON.stringify(E.VT_RULES.status.cancelledFrom) === JSON.stringify(C.reasons), JSON.stringify(E.VT_RULES.status.cancelledFrom));
  ok('cancelled is a status value and first in same-extract precedence (a deactivation wins over Fitted)', E.VT_RULES.status.values.includes('cancelled') && E.VT_RULES.status.sameExtractPrecedence[0] === 'cancelled');
  ok('only open statuses can drop out; Fitted never does (R3)', JSON.stringify(C.dropped.from) === JSON.stringify(E.VT_RULES.status.open) && !C.dropped.from.includes('fitted'));
  ok('a complete day needs both daily kinds the SQL knows', C.dropped.completeDay.length === 2 && C.dropped.completeDay.every(k => M71.includes("'" + k + "'")));
  const m = M71.match(/cancel_reason\s+text[^\n]*?in \(([^)]*)\)/), ev = M71.match(/\breason\s+text[^\n]*?in \(([^)]*)\)/);
  const list = (x) => x ? x[1].split(',').map(t => t.trim().replace(/'/g, '')) : null;
  ok('vt_cases.cancel_reason check = the rule book reasons', JSON.stringify(list(m)) === JSON.stringify(C.reasons), m && m[0]);
  ok('vt_case_events.reason check = the rule book reasons', JSON.stringify(list(ev)) === JSON.stringify(C.reasons), ev && ev[0]);
  ok('every business month with budgets has a cancellation budget', Object.values(E.VT_RULES.budgets).every(b => b.cancelled && typeof b.cancelled['*'] === 'number'));
  ok('Cancellation % is a report column and is NOT a rating driver (R7)', E.VT_RULES.reports.columns.some(c => c.id === 'canRate') && !E.VT_RULES.rating.drivers.some(d => /cancel/i.test(d.k + d.label)));
  ok('the BI contract columns are optional (a file without them deactivates nothing)', JSON.stringify(E.VT_RULES.columns.biOptional) === JSON.stringify(['contractStatus', 'deactivateOn']));
}

console.log('\n== 4. no rule literal outside VT_RULES ==');
function stripBlocks(src) {
  return src
    .replace(/\/\* @vt-rules start \*\/[\s\S]*?\/\* @vt-rules end \*\//, '')
    .replace(/\/\* @mirror:sa-holidays start[\s\S]*?\/\* @mirror:sa-holidays end \*\//, '')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
const LITERALS = ['0.85', '0.05', '0.75', '0.7', '0.8', '6.5', '1.15', '0.15', '0.9', '0.4', '26', '35', '30', '20', '15', '50', '90', '60'];
function literalHits(file) {
  const code = stripBlocks(fs.readFileSync(file, 'utf8'));
  return LITERALS.filter(l => new RegExp('(^|[^\\w.])' + l.replace('.', '\\.') + '(?![\\w.])').test(code));
}
const src = fs.readFileSync(ENGINE, 'utf8');
ok('vt-engine.js delimits VT_RULES with @vt-rules markers', /\/\* @vt-rules start \*\/[\s\S]*\/\* @vt-rules end \*\//.test(src));
{ const hits = literalHits(ENGINE); ok('vt-engine.js has no rule literal outside VT_RULES', hits.length === 0, hits.join(', ')); }
const VIEW = path.join(REPO, 'agent', 'vt-view.js');
if (fs.existsSync(VIEW)) { const hits = literalHits(VIEW); ok('agent/vt-view.js has no rule literal', hits.length === 0, hits.join(', ')); }
else console.log('  note agent/vt-view.js not built yet (Phase E) — its literal check runs once it exists');

finish();
