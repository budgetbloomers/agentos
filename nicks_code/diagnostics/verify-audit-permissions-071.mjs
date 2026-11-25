#!/usr/bin/env node
/**
 * verify-audit-permissions-071.mjs — tools/audit-permissions.mjs knows the Vehicle Tracking pages and the retired
 * Tracker app (spec 071, F1).
 *
 *   node nicks_code/diagnostics/verify-audit-permissions-071.mjs
 *
 * The page ids are read from the REAL sources (PULSE NAV, Ops); the accounts are fictional (fx-*). No network.
 */
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const A = await import(pathToFileURL(path.join(ROOT, 'tools', 'audit-permissions.mjs')).href);
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

console.log('\n1 · page ids come from the apps');
const PAGES = A.readPages(fs.readFileSync(path.join(ROOT, 'nicks_code', 'index.html'), 'utf8'), fs.readFileSync(path.join(ROOT, 'Chatterbox_AgentOS_Analytics.html'), 'utf8'));
ok('PULSE NAV yields the VAS pages (dashboard, mtd, data …)', ['dashboard', 'mtd', 'data'].every((x) => PAGES.vas.includes(x)), PAGES.vas.join());
ok('every VT page is a real VAS page now (' + A.VT_TABS.join(', ') + ')', A.VT_TABS.every((x) => PAGES.vas.includes(x)), PAGES.vas.join());
ok('Ops pages are read', PAGES.ops.length > 5, String(PAGES.ops.length));
ok('tracker is not a known app any more (only vas and ops tab lists are audited)', A.APPS.join() === 'vas,ops' && A.RETIRED_APPS.includes('tracker'));

console.log('\n2 · per-account verdicts');
const scoped = PAGES.vas.filter((x) => !A.VT_TABS.includes(x));
const u1 = { username: 'fx-vt', role: 'viewer', apps: ['vas'], tabs: { vas: [...PAGES.vas] } };
const r1 = A.auditUser(u1, PAGES);
ok('an account holding the VT tabs: they are not DEAD', !r1.dead.vas, JSON.stringify(r1.dead));
const r2 = A.auditUser({ username: 'fx-novt', role: 'viewer', apps: ['vas'], tabs: { vas: scoped } }, PAGES);
ok('an account without them: VT tabs reported MISSING', A.VT_TABS.every((x) => (r2.missing.vas || []).includes(x)), JSON.stringify(r2.missing));
ok('…and it is not a former Tracker user, so no VT line', r2.vtMissing === null);
const u3 = { username: 'fx-tracker', role: 'viewer', apps: ['ops', 'tracker'], tabs: { ops: ['*'], tracker: ['*'], vas: ['dashboard'] } };
const before = JSON.stringify(u3);
const r3 = A.auditUser(u3, PAGES, { fixDead: true });
ok('a stale tracker grant is reported DEAD-INERT (apps and tabs)', r3.inert.join() === 'apps:tracker,tabs.tracker', r3.inert.join());
ok('a former Tracker user without the VT tabs is named', JSON.stringify(r3.vtMissing) === JSON.stringify(A.VT_TABS), JSON.stringify(r3.vtMissing));
ok('the tracker tab key is never counted as a DEAD tab id', !r3.dead.tracker && !Object.keys(r3.dead).includes('tracker'));
ok('--dead with no dead ids proposes no write (the tracker grant stays)', r3.nextTabs === null);
const r4 = A.auditUser({ username: 'fx-dead', role: 'viewer', apps: ['vas', 'tracker'], tabs: { vas: ['dashboard', 'lead_alloc'], tracker: ['*'] } }, PAGES, { fixDead: true });
ok('a real dead VAS id is still DEAD', JSON.stringify(r4.dead.vas) === '["lead_alloc"]', JSON.stringify(r4.dead));
ok('--dead strips it but keeps tabs.tracker untouched', r4.nextTabs && !r4.nextTabs.vas.includes('lead_alloc') && JSON.stringify(r4.nextTabs.tracker) === '["*"]', JSON.stringify(r4.nextTabs));
ok('the input account is not mutated', JSON.stringify(u3) === before);
const r5 = A.auditUser({ username: 'fx-admin', role: 'admin', apps: ['vas', 'tracker'], tabs: { tracker: ['*'] } }, PAGES);
ok('an admin sees every VT page: inert grant reported, no VT line', r5.inert.length === 2 && r5.vtMissing === null);
const L = A.linesFor(r3).join('\n');
ok('the printed lines say DEAD-INERT and VT in plain words', /DEAD-INERT apps:tracker, tabs\.tracker/.test(L) && L.includes('VT: a former Tracker user without ' + A.VT_TABS.join(', ')), L);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
