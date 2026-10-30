#!/usr/bin/env node
/**
 * verify-deps-guard.mjs — the tick heals its own packages (30 Oct 2026).
 *
 *   node nicks_code/diagnostics/verify-deps-guard.mjs
 *
 * WHY: on 30 Oct Windows' "free up space" emptied nicks_code/diagnostics/node_modules and every scheduled step failed
 * twice (relay, lake-load, agent digest, NBA, rake, QA sales sync) with "Cannot find module …playwright". The tick now
 * checks, before any step, that every package that folder's package.json names is installed; a missing one is put back
 * from the lockfile (npm ci) and the folder pinned "always keep on this device", or the tick fails ONCE, loudly.
 * Everything here is injected — no npm, no disk, no network.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = await import(pathToFileURL(path.join(ROOT, 'tools', 'tick-local.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const J = JSON.stringify;
const has = (fn) => typeof T[fn] === 'function';

const pkg = { devDependencies: { playwright: '^1', pg: '^8', '@duckdb/node-api': '1.5.5' }, dependencies: { xlsx: '^0.18' } };
const DIR = path.join('X', 'diag');
const at = (dep) => path.join(DIR, 'node_modules', ...dep.split('/'), 'package.json');

console.log('\nA · what is missing');
ok('every package the package.json names is checked, scoped ones included',
  has('missingDeps') && J(T.missingDeps(pkg, DIR, () => false)) === J(['@duckdb/node-api', 'pg', 'playwright', 'xlsx']));
ok('nothing is missing when every package.json is on disk', has('missingDeps') && T.missingDeps(pkg, DIR, () => true).length === 0);
ok('only the absent ones are named', has('missingDeps') && J(T.missingDeps(pkg, DIR, (p) => p !== at('pg'))) === J(['pg']));

console.log('\nA2 · a half-deleted folder (ecc silent-failure review, 30 Oct)');
const lock = { packages: { '': {}, 'node_modules/playwright': {}, 'node_modules/playwright-core': {}, 'node_modules/@duckdb/node-bindings-win32-x64': {} } };
const present = new Set(['playwright', 'pg', '@duckdb/node-api', 'xlsx', 'playwright'].map(at));
ok('a transitive or platform package npm installed (playwright-core, duckdb\'s Windows binary) is checked too',
  has('missingDeps') && J(T.missingDeps(pkg, DIR, (p) => present.has(p), lock)) === J(['@duckdb/node-bindings-win32-x64', 'playwright-core']),
  has('missingDeps') ? J(T.missingDeps(pkg, DIR, (p) => present.has(p), lock)) : '');
ok('the two timeouts together stay inside the tick lock (a second tick never starts mid-install)',
  typeof T.INSTALL_TIMEOUT_MS === 'number' && 2 * T.INSTALL_TIMEOUT_MS < T.LOCK_STALE_MS);

console.log('\nB · heal, or fail once and loudly');
if (has('ensureDeps')) {
  let installs = 0;
  const healthy = await T.ensureDeps({ dir: DIR, readPkg: () => pkg, exists: () => true, install: () => { installs++; return { ok: true }; } });
  ok('all present: nothing installed, ok', healthy.ok && !healthy.repaired && installs === 0, J(healthy));

  let disk = new Set();   // empty folder, as the cleanup left it; install() fills it
  const heal = await T.ensureDeps({ dir: DIR, readPkg: () => pkg, exists: (p) => disk.has(p),
    install: () => { installs++; disk = new Set(['playwright', 'pg', '@duckdb/node-api', 'xlsx'].map(at)); return { ok: true }; } });
  ok('missing packages are reinstalled once, and the run goes on', heal.ok && heal.repaired && installs === 1, J(heal));
  ok('the note names what was missing', /playwright/.test(heal.note) && /reinstalled/i.test(heal.note), heal.note);

  const broken = await T.ensureDeps({ dir: DIR, readPkg: () => pkg, exists: () => false, install: () => ({ ok: false, note: 'npm ERR! network' }) });
  ok('a failed reinstall fails the tick, with npm\'s reason', !broken.ok && /network/.test(broken.note), J(broken));
  ok('…and says the folder may now be empty (npm ci removes it first)', /emptied|removed/i.test(broken.note), broken.note);
  const thrown = await T.ensureDeps({ dir: DIR, readPkg: () => pkg, exists: () => false, install: () => { throw new Error('spawn EPERM'); } });
  ok('an install that throws is a failure with its message, never a crash', !thrown.ok && /EPERM/.test(thrown.note), J(thrown));
  ok('npm\'s own error lines are what the note keeps', has('npmNote') &&
    /ENOTFOUND/.test(T.npmNote({ status: 1, stderr: 'npm error code ENOTFOUND\nnpm error network request failed\nnpm error A complete log of this run can be found in: C:\\x.log' })));
  ok('a timeout says so', has('npmNote') && /timed out after 10 min/.test(T.npmNote({ status: null, error: Object.assign(new Error('spawnSync npm ETIMEDOUT'), { code: 'ETIMEDOUT' }) })));
  ok('npm missing from PATH says so', has('npmNote') && /could not run/.test(T.npmNote({ status: null, error: Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' }) })));

  const partial = await T.ensureDeps({ dir: DIR, readPkg: () => pkg, exists: (p) => p !== at('pg'), install: () => ({ ok: true }) });
  ok('an install that "succeeds" but leaves a package missing still fails', !partial.ok && /pg/.test(partial.note), J(partial));

  const noPkg = await T.ensureDeps({ dir: DIR, readPkg: () => { throw new Error('ENOENT'); }, exists: () => true, install: () => ({ ok: true }) });
  ok('no package.json at all fails, never "nothing to check"', !noPkg.ok, J(noPkg));
} else ok('tick-local exports ensureDeps', false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
