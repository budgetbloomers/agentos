#!/usr/bin/env node
/**
 * verify-grant-tabs-071.mjs — tools/vt-grant-tabs.mjs plans the VT grants and never removes anything (spec 071, A5).
 *
 *   node nicks_code/diagnostics/verify-grant-tabs-071.mjs
 *
 * Fictional accounts only (usernames fx-*, CB91xx; the four VT team-leader CBs appear as bare codes). No network:
 * the dry run reads a fixture written to diagnostics/scratch/vt-grant/.
 */
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const TOOL = path.join(ROOT, 'tools', 'vt-grant-tabs.mjs');
const { planGrants, VT_TABS } = await import(pathToFileURL(TOOL).href);
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

const users = [
  { id: '1', username: 'fx-viewer', role: 'viewer', apps: ['ops', 'tracker'], tabs: { ops: ['exec'], tracker: ['*'] }, cb: null },
  { id: '2', username: 'fx-onlytracker', role: 'campaign_manager', apps: ['agent', 'tracker'], tabs: { tracker: ['*'] }, cb: null },
  { id: '3', username: 'fx-tl', role: 'tl', apps: ['agent'], tabs: {}, cb: 'cb-194' },
  { id: '4', username: 'fx-cm', role: 'campaign_manager', apps: ['agent', 'vas'], tabs: { vas: ['dashboard', 'vt_mtd'] }, cb: null },
  { id: '5', username: 'fx-exec', role: 'exec', apps: ['ops', 'vas', 'tracker'], tabs: { ops: ['*'], vas: ['*'], tracker: ['*'] }, cb: null },
  { id: '6', username: 'fx-agent', role: 'agent', apps: ['agent'], tabs: {}, cb: 'CB9101' },
  { id: '7', username: 'fx-done', role: 'viewer', apps: ['vas', 'tracker'], tabs: { vas: ['dashboard', ...VT_TABS] }, cb: null },
];
const assignments = { 'fx-cm': { campaigns: ['courtesy', 'VT'] }, 'fx-other': { campaigns: ['cuddle'] } };
const before = JSON.stringify(users);
const plan = planGrants(users, assignments);
const by = Object.fromEntries(plan.map((p) => [p.username, p]));

console.log('\n1 · who is in the plan');
ok('a tracker holder is listed', !!by['fx-viewer'] && by['fx-viewer'].why.includes('tracker holder'));
ok('a VT team leader is found by CB (normalised)', !!by['fx-tl'] && by['fx-tl'].why.includes('VT team leader'));
ok('a campaign manager whose assignment names VT is listed', !!by['fx-cm'] && by['fx-cm'].why.includes('VT campaign manager'));
ok('an agent with no tracker grant is not listed', !by['fx-agent']);

console.log('\n2 · what it proposes');
ok("tracker holder gets apps += vas and the three VT tabs", JSON.stringify(by['fx-viewer'].addApps) === '["vas"]' && JSON.stringify(by['fx-viewer'].addTabs) === JSON.stringify(VT_TABS));
ok('a tab already held is not added twice', JSON.stringify(by['fx-cm'].addTabs) === '["vt_weekly","vt_daily"]' && by['fx-cm'].addApps.length === 0);
ok("vas:'*' needs no tab ids", by['fx-exec'].addTabs.length === 0 && by['fx-exec'].noop);
ok('an account already fully granted is a no-op', by['fx-done'].noop);
ok('a tracker-only campaign manager is flagged as becoming a manager', by['fx-onlytracker'].becomesManager === true);
ok('a team leader gaining vas is flagged as becoming a manager', by['fx-tl'].becomesManager === true);
ok('a viewer is not flagged (already a manager)', by['fx-viewer'].becomesManager === false);

console.log('\n3 · never removes anything');
let removes = 0;
for (const p of plan) {
  const u = users.find((x) => x.id === p.id);
  for (const a of u.apps) if (!p.nextApps.includes(a)) removes++;
  for (const [k, v] of Object.entries(u.tabs)) {
    if (!(k in p.nextTabs)) { removes++; continue; }
    for (const t of v) if (!p.nextTabs[k].includes(t)) removes++;
  }
}
ok('no app, tab key or tab id is ever dropped (tracker entries stay)', removes === 0, String(removes));
ok("stale 'tracker' entries are kept", by['fx-viewer'].nextApps.includes('tracker') && 'tracker' in by['fx-viewer'].nextTabs);
ok('the input accounts are not mutated', JSON.stringify(users) === before);

console.log('\n4 · the command line');
const dir = path.join(HERE, 'scratch', 'vt-grant'); fs.mkdirSync(dir, { recursive: true });
const fx = path.join(dir, 'fixture.json'); fs.writeFileSync(fx, JSON.stringify({ app_users: users, assignments }));
const dry = spawnSync(process.execPath, [TOOL, '--fixture', fx], { encoding: 'utf8' });
ok('the fixture dry run exits 0', dry.status === 0, dry.stderr);
ok('the dry run prints the plan', /fx-viewer/.test(dry.stdout) && /tabs\.vas \+= vt_mtd, vt_weekly, vt_daily/.test(dry.stdout));
ok('the dry run says nothing was written', /nothing written/.test(dry.stdout));
const noOwner = spawnSync(process.execPath, [TOOL, '--apply'], { encoding: 'utf8', env: { ...process.env, VT_GRANT_APPLY: '' } });
ok('--apply refuses without VT_GRANT_APPLY=owner', noOwner.status === 2 && /refused/.test(noOwner.stderr));
const fxApply = spawnSync(process.execPath, [TOOL, '--apply', '--fixture', fx], { encoding: 'utf8', env: { ...process.env, VT_GRANT_APPLY: 'owner' } });
ok('--apply never runs against a fixture', fxApply.status === 2);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
