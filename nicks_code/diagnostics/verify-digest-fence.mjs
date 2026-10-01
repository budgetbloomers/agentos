/* verify-digest-fence.mjs — the live agent digest at month rollover (2026-10-01).
 *
 * Agents read the LIVE digest key. It is fenced to the current SAST month (3 Sep: an August browser
 * overwrote September). But at midnight on the 1st the new month has no data, so the fence froze agents
 * on the last copy of the closed month — "1–29 September" on 1 October, the final day never shown.
 * ROLLOVER GRACE: the live key also takes the PREVIOUS month, but only while it is not already on the
 * current month; never anything older; the current month always wins once it publishes. One rule
 * (worker/src/rules.mjs liveDigestAllowed) — the Worker's 409, PULSE's publisher (inline mirror) and the
 * republish tool all ask it. Run: node verify-digest-fence.mjs (no network)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const { liveDigestAllowed } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'rules.mjs')).href);

let pass = 0, fail = 0;
const ok = (name, cond, note) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (note ? ' — ' + note : '')); } };
const OCT1 = Date.parse('2026-10-01T06:00:00Z');   // 08:00 SAST, 1 October

console.log('\n1 · the rule');
ok('the current month is always allowed', liveDigestAllowed('2026-10-01', '2026-09-01', OCT1) === true);
ok('the closed month is allowed while the live key still holds it (rollover grace)', liveDigestAllowed('2026-09-01', '2026-09-01', OCT1) === true);
ok('…or holds something older', liveDigestAllowed('2026-09-01', '2026-08-01', OCT1) === true);
ok('…or nothing yet', liveDigestAllowed('2026-09-01', '', OCT1) === true);
ok('the closed month is REFUSED once the current month has published', liveDigestAllowed('2026-09-01', '2026-10-01', OCT1) === false);
ok('an older month is never allowed (the 3 Sep protection)', liveDigestAllowed('2026-08-01', '2026-08-01', OCT1) === false);
ok('a future month is never allowed', liveDigestAllowed('2026-11-01', '2026-09-01', OCT1) === false);
ok('the month is SAST, not UTC (23:30 UTC on 30 Sep is already 1 Oct)', liveDigestAllowed('2026-10-01', '', Date.parse('2026-09-30T23:30:00Z')) === true);
ok('no period → refused', liveDigestAllowed('', '', OCT1) === false);

console.log('\n2 · every writer asks it');
const W = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'index.mjs'), 'utf8');
ok('the Worker\'s live-key 409 uses liveDigestAllowed', /liveDigestAllowed\(/.test(W));
ok('the Worker REFUSES when it cannot read what is live (fail closed, never "nothing live")', /live digest not readable[\s\S]{0,200}503/.test(W) && !/loadDigest\(DB\)\.catch\(\(\) => null\)/.test(W));
ok('the Worker stamps the live pointer row with its period (the cheap read)', /period: digestFrom/.test(W));
const T = fs.readFileSync(path.join(ROOT, 'tools', 'digest-republish.mjs'), 'utf8');
ok('the republish tool uses liveDigestAllowed', /liveDigestAllowed\(/.test(T));
ok('the tool stamps the live pointer too, and fails closed on an unreadable live digest', /store, period: /.test(T) && /throw new Error\('the live digest has a row but its object did not read'\)/.test(T));
ok('the tool falls back to the month just closed when the live month is empty', /building the month just closed/.test(T));
const HL = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'health.mjs'), 'utf8');
ok('the health sentinel knows the grace (no false "wrong month" on the 1st)', /closedMonthInGrace/.test(HL));
const P = fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8');
const m = P.match(/function liveDigestMonthOk\([^)]*\)\{[\s\S]*?\n\}/);
ok('PULSE carries the inline mirror liveDigestMonthOk', !!m);
if (m) {
  // eslint-disable-next-line no-new-func
  const f = new Function(m[0] + '\nreturn liveDigestMonthOk;')();
  ok('PULSE: the current month publishes live', f('2026-10', OCT1) === true);
  ok('PULSE: the closed month offers itself live (the Worker decides against what the key holds)', f('2026-09', OCT1) === true);
  ok('PULSE: anything older never does', f('2026-08', OCT1) === false);
}

console.log('\n3 · the calculator\'s new-month model reaches the page (commNow)');
const PORTAL = fs.readFileSync(path.join(ROOT, 'worker', 'src', 'portal.mjs'), 'utf8');
ok('the portal envelope passes commNow (a field the envelope does not name never reaches the page)', /commNow:\s*digest\.commNow\s*\|\|\s*null/.test(PORTAL));
ok('the agent page decides the calculator\'s month in ONE helper (calcMonth) from commNow', /function calcMonth\(\)/.test(fs.readFileSync(path.join(ROOT, 'agent', 'index.html'), 'utf8')) && /D\.commNow/.test(fs.readFileSync(path.join(ROOT, 'agent', 'index.html'), 'utf8')));

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exitCode = fail ? 1 : 0;
