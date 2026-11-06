// A shortened first name must reach the right agent, and nothing else may move (6 Nov 2026).
// HighLevel's "Kuben Govender" is the Agent List's "Kubenderan Govender" (CB328): five letters apart, so the one-edit
// tiers refused him and 15 referrals read as 0. The rule is one block, copied byte for byte into the three matchers;
// this suite runs that block and fails if the copies drift. No browser, no network, no company data.
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const FILES = ['nicks_code/index.html', 'Chatterbox_AgentOS_Analytics.html', 'tools/fetch-referrals.mjs'];
const blockOf = (f) => {
  const m = /\/\*REF-SHORT-NAME-BEGIN\*\/([\s\S]*?)\/\*REF-SHORT-NAME-END\*\//.exec(fs.readFileSync(path.join(REPO, f), 'utf8'));
  return m ? m[1].replace(/\r\n/g, '\n').trim() : null;   // git checks two of these out as CRLF on Windows; all three commit as LF
};

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  pass  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };

const blocks = FILES.map(blockOf);
FILES.forEach((f, i) => ok('the rule is in ' + f, !!blocks[i]));
ok('all three copies are byte-identical', blocks[0] && blocks.every((b) => b === blocks[0]));

if (!blocks[0]) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
const refShortName = new Function(blocks[0] + '\nreturn refShortName;')();

const person = (name, code) => ({ toks: name.toLowerCase().split(' '), code });
const FLOOR = [
  person('kubenderan govender', 'CB328'), person('priyesh govender', 'CB383'), person('cohen govender', 'CB240'),
  person('thulani greatman mbonambi', 'CB142'), person('lungelo mnikathi', 'CB417'), person('loyiso juta', 'CB384'),
  person('krishna naidoo', 'CB1'), person('krishen naidoo', 'CB2'), person('wandile nxumalo', 'CB252'), person('zandile chamane', 'CB150'),
  person('kenneth moodley', 'CB3'),
];
const run = (raw, people = FLOOR) => refShortName(raw.toLowerCase().split(' '), people);

// the cases this exists for
ok('Kuben Govender reaches CB328', run('Kuben Govender') === 'CB328', run('Kuben Govender'));
ok('it works the other way round: the list has the short form', run('Kubenderan Govender', [person('kuben govender', 'CB328')]) === 'CB328');
ok('a middle name on the list does not stop it', run('Kuben Govender', [person('kubenderan rajen govender', 'CB328')]) === 'CB328');
ok('name.surname reaches its agent', run('lungelo.mnikathi') === 'CB417', run('lungelo.mnikathi'));
ok('namesurname reaches its agent', run('loyisojuta') === 'CB384', run('loyisojuta'));
ok('one agent carried twice (name + Sales Force) is still one', run('Kuben Govender', [person('kubenderan govender', 'CB328'), person('kubenderan govender', 'CB328')]) === 'CB328');

// what must stay unmatched
ok('two agents fit: nobody is picked', run('Kris Naidoo') === '', run('Kris Naidoo'));
ok('a different surname is not him', run('Kuben Pillay') === '', run('Kuben Pillay'));
ok('a short form under 5 letters is too thin', run('Ken Moodley') === '', run('Ken Moodley'));
// a different person who shares the start of a name must never be credited: unique on the list proves nothing if they left
for (const [left, onList] of [['Dean Smith', 'deanne smith'], ['Joan Smith', 'joanna smith'], ['Anne Smith', 'annette smith'], ['Lize Smith', 'lizette smith'], ['Chris Smith', 'christine smith']])
  ok(left + ' is not ' + onList, run(left, [person(onList, 'CB9')]) === '', run(left, [person(onList, 'CB9')]));
ok('one word alone never matches on a prefix', run('Kuben') === '', run('Kuben'));
ok('a bare first name stays with the earlier tiers', run('Wandile') === '', run('Wandile'));
ok('a surname that only shares a start is not a surname match', run('Kuben Gov') === '', run('Kuben Gov'));
ok('empty input is nobody', refShortName([''], FLOOR) === '' && refShortName([], FLOOR) === '');
ok('an empty floor is nobody', refShortName(['kuben', 'govender'], []) === '');

// the guards at each call site are what keep this tier last: without them it would settle ambiguity or override a person's "no"
const src = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const pulse = src(FILES[0]), ops = src(FILES[1]), tool = src(FILES[2]);
ok('PULSE: an ambiguous name stops before this tier', pulse.includes("if(hits.size) return hits.size===1?[...hits][0]:'';"));
ok('PULSE: a leaver or "not the same man" is never re-read', pulse.includes("return known?'':refShortName(toks,rn)") && pulse.includes('fuzzy(p.agent,code||S.map[p.agent])'));
ok('Ops: an ambiguous name stops before this tier', ops.includes('if(cands.size)return (_refCache[n]=cands.size===1?[...cands][0]:null);'));
ok('Ops: two agents with one exact name stay unmatched', /ownerAmbig\[n\]\)return \(_refCache\[n\]=null\);[^\n]*\r?\n\s*const people=/.test(ops));
ok('Ops: Salesforce owner matching does not use this tier', !/function _ownerCandidates[\s\S]*?\n\}/.exec(ops)[0].includes('refShortName') && !/function ownerMatch[\s\S]*?\n\}/.exec(ops)[0].includes('refShortName'));
ok('tool: an ambiguous name stops before this tier', tool.includes('if (!cb && !subset.length) cb = refShortName('));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
