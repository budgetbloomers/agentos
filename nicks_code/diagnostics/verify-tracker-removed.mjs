#!/usr/bin/env node
/**
 * verify-tracker-removed.mjs — the old Tracker Analytics app is gone, and the VAS tracker is not (spec 071, US6, SC-006).
 *
 *   node nicks_code/diagnostics/verify-tracker-removed.mjs             (runs node tools/prepare-site.js first)
 *   node nicks_code/diagnostics/verify-tracker-removed.mjs --no-build  (checks the site/ already on disk)
 *
 * "tracker" means three things in this codebase (specs/vt-analytics/current-state.md): the retired Tracker Analytics app
 * (/tracker/, app grant 'tracker'), the hand-built VAS MTD tracker (PULSE trackerDaily, STORE_KEY) and the HighLevel
 * referral tracker. Only the first goes, so this suite asserts both directions: the app is absent from the build, the
 * switchers, the sign-in gate and the Worker's manager set — and the VAS tracker is still there.
 *
 * The old VT MTD Report shipped a July 2026 seed with real first names. Those names are read from GIT HISTORY at run time
 * (the commit that added tracker/vt-mtd-report.html) and are never written into this file or printed: a hit is reported
 * by file and count only. No network, no Supabase.
 */
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const SITE = path.join(ROOT, 'site');
let pass = 0, fail = 0; const failures = [];
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const read = (rel) => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/* ---- 1. the build ---- */
console.log('\n1 · the build');
if (!process.argv.includes('--no-build')) {
  let built = true;
  try { execFileSync(process.execPath, [path.join(ROOT, 'tools', 'prepare-site.js')], { cwd: ROOT, stdio: 'pipe' }); }
  catch (e) { built = false; }
  ok('node tools/prepare-site.js succeeds (build consistency check passes)', built);
}
ok('site/tracker/ is absent after the build', !fs.existsSync(path.join(SITE, 'tracker')));
const prep = read('tools/prepare-site.js');
ok('prepare-site.js no longer copies the tracker app', !/\[\s*'tracker'\s*,\s*'tracker'/.test(prep));
ok('prepare-site.js no longer copies vt-mtd-report.html', !/vt-mtd-report/.test(prep));
ok('prepare-site.js shell list no longer names tracker/index.html', !/'tracker\/index\.html'/.test(prep));
ok('tracker/index.html and tracker/vt-mtd-report.html are deleted from the repo',
  !fs.existsSync(path.join(ROOT, 'tracker', 'index.html')) && !fs.existsSync(path.join(ROOT, 'tracker', 'vt-mtd-report.html')));

/* ---- 2. no route to it from the apps ---- */
console.log('\n2 · no link to it from Ops or PULSE');
const ops = read('Chatterbox_AgentOS_Analytics.html'); const pulse = read('nicks_code/index.html');
ok('Ops source has no tracker/index.html link', ops && !/tracker\/index\.html/.test(ops));
ok('PULSE source has no tracker/index.html link', pulse && !/tracker\/index\.html/.test(pulse));
ok('PULSE app switcher no longer offers "Tracker Analytics"', !/>\s*Tracker Analytics\s*</.test(pulse));
ok('Ops app switcher no longer offers "Tracker Analytics"', !/>\s*Tracker Analytics\s*</.test(ops));
/* A4: the latent "Matrix Tracker" view is reachable only through a header campaign filter left on 'VT' (CAMPS never
   offers it). rebuild() now clears that stale value like any other unreported campaign; buildModel/aggCols are untouched. */
ok("PULSE rebuild no longer keeps a stale 'VT' header filter", !/S\.ui\.camp!=='VT'&&!CAMPS\.includes\(S\.ui\.camp\)/.test(pulse));
ok('PULSE keeps the hidden VT branch (aggCols vt:true) untouched', /if\(camp==='VT'\) opts=\{\.\.\.opts,vt:true,canc:false\};/.test(pulse));
for (const rel of ['index.html', 'pulse/index.html']) {
  const p = path.join(SITE, rel);
  ok('built site/' + rel + ' has no tracker/index.html link', fs.existsSync(p) && !/tracker\/index\.html/.test(fs.readFileSync(p, 'utf8')));
}

/* ---- 3. the sign-in gate and the Worker ---- */
console.log('\n3 · auth-gate.js and the Worker');
const gate = read('site/auth-gate.js');
ok('auth-gate.js has no /tracker → tracker APP branch', gate && !/'\/tracker'/.test(gate) && !/\?\s*'tracker'/.test(gate));
ok('auth-gate.js NAMES/PATHS carry no tracker key', !/\btracker\s*:\s*['"]/.test(gate));
const idx = read('worker/src/index.mjs');
const mgmt = (idx.match(/const MANAGEMENT_APPS = new Set\(\[([^\]]*)\]\)/) || [])[1];
ok('MANAGEMENT_APPS exists', mgmt != null);
ok('MANAGEMENT_APPS has no tracker', mgmt != null && !/tracker/.test(mgmt), mgmt);
ok('MANAGEMENT_APPS still holds ops and vas', mgmt != null && /'ops'/.test(mgmt) && /'vas'/.test(mgmt));
ok('the AI context no longer pulls ai-digest-tracker', !/ai-digest-tracker/.test(idx));
ok('the AI prompt no longer describes a Tracker Analytics app', !/Tracker Analytics|TRACKER ANALYTICS/.test(idx));
ok('KEPT: /api/eod route is still mounted (data is never deleted, D9)', /path === '\/api\/eod'/.test(idx));
ok("KEPT: 'POST /api/eod' is still in GATED_WRITES", /GATED_WRITES = \[[^\]]*'POST \/api\/eod'/.test(idx));
ok('site/_headers no longer mentions /tracker/', !/\/tracker\//.test(read('site/_headers')));

/* ---- 4. the VAS hand-built tracker stays ---- */
console.log('\n4 · the VAS MTD tracker is untouched');
ok("PULSE still carries STORE_KEY = 'vas_mtd_tracker_v1'", /STORE_KEY = 'vas_mtd_tracker_v1'/.test(pulse));
ok('PULSE still carries the trackerDaily upload type', (pulse.match(/trackerDaily/g) || []).length >= 4);
ok('PULSE still carries the S.tracker store', /S\.tracker\b/.test(pulse));

/* ---- 5. the old seed names ship nowhere ---- */
console.log('\n5 · no shipped file carries the old seed names (read from git history, never printed)');
let names = [];
try {
  const sha = git('log', '--diff-filter=A', '--format=%H', '--', 'tracker/vt-mtd-report.html').trim().split(/\s+/).pop();
  const seed = git('show', sha + ':tracker/vt-mtd-report.html');
  const block = seed.slice(seed.indexOf('const SEED'), seed.indexOf('/* ---------------- state'));
  const set = new Set();
  for (const re of [/\bname:\s*"([^"]+)"/g, /"a":"([^"]+)"/g, /"sch":"([^"]+)"/g]) for (const m of block.matchAll(re)) set.add(m[1].trim());
  names = [...set].filter((n) => /^[A-Za-z][A-Za-z' -]{2,}$/.test(n));
} catch (e) { /* reported below */ }
ok('the seed names were recovered from git history', names.length >= 2, 'found ' + names.length);
const shipped = [];
(function walk(d) { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(html|js|txt|json|css)$/i.test(e.name)) shipped.push(p); } })(SITE);
ok('the built site has shipped files to scan', shipped.length >= 5, String(shipped.length));
/* The seed's per-case detail list is the PII: a first name next to a Salesforce case number. A shipped page that names
   a scheduler or agent from that list with its seed shape ("a":"<name>" / name: "<name>", sch) is the leak. Bare first
   names also occur in other people's comments, so the check looks for the seed's own record shapes. */
const hits = [];
for (const f of shipped) {
  const t = fs.readFileSync(f, 'utf8');
  let n = 0;
  for (const nm of names) {
    const q = nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('"(a|sch)":"' + q + '"|\\bname:\\s*"' + q + '"').test(t)) n++;
  }
  if (/SEED_MONTH|vtmtd\.projInputs/.test(t)) n++;
  if (n) hits.push(path.relative(ROOT, f) + ' (' + n + ')');
}
ok('no shipped file carries a seed record or the seed itself', hits.length === 0, hits.join(', '));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (fail) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
