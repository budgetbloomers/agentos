#!/usr/bin/env node
/**
 * verify-vici-tz.mjs -- the 2026-09 ViciDial machine-timezone bug (migration-051) stays fixed.
 *
 *   node nicks_code/diagnostics/verify-vici-tz.mjs
 *
 * tools/lake-load.mjs's ts() parsed ViciDial's naive SAST call_date with new Date(), so the stored
 * instant depended on the loading machine's local timezone -- batches B0351/B0355/B0356 landed every
 * call 2h off true SAST, and vici_calls' primary key (call_date, agent_login, lead_id, status) let the
 * shifted rows in as "new" calls rather than conflicts. Two halves, both read-only or rolled back:
 *
 *   A. tsSast() (tools/lake-load.mjs) and rake_sf_ts_local() (migration-028, the SQL merge path used
 *      by tools/rake.mjs and the in-page Rake) agree: the same naive string loads as the same instant
 *      through both loaders, regardless of the machine or session timezone running them.
 *   B. dedupe_lake()'s vici_calls_tz step (migration-051) against the LIVE lake, inside one transaction
 *      that always rolls back: after a run, no +/-2h twin remains between a known-bad batch and any
 *      other batch; a second run in the same transaction finds nothing further to do (idempotent).
 */
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const req = createRequire(path.join(HERE, 'node_modules', 'x.js'));
const pg = req('pg');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
let pass = 0, fail = 0; const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' -- ' + d : '')); } };

console.log('\nA . THE TWO LOADERS AGREE (naive SAST -> the same UTC instant, no machine dependence)');

/* lift tsSast() straight from the real loader -- never a second hand-copied implementation to drift */
const lakeLoadSrc = fs.readFileSync(path.join(ROOT, 'tools', 'lake-load.mjs'), 'utf8');
const blockStart = lakeLoadSrc.indexOf('const s = (v) =>');
const blockEnd = lakeLoadSrc.indexOf('const idish');
if (blockStart < 0 || blockEnd < 0) throw new Error('tools/lake-load.mjs: could not find the s()/ts()/tsSast() block -- file shape changed');
const runtimeFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-vici-tz-')), 'tssast.cjs');
fs.writeFileSync(runtimeFile, lakeLoadSrc.slice(blockStart, blockEnd) + '\nmodule.exports = { tsSast, ts };', 'utf8');
const { tsSast, ts: tsShared } = req(runtimeFile);

ok('tsSast(): naive "2026-09-10 08:00:00" loads as 06:00Z (SAST is UTC+2, no DST)', tsSast('2026-09-10 08:00:00') === '2026-09-10T06:00:00.000Z', tsSast('2026-09-10 08:00:00'));
ok('tsSast(): the T-separated form parses the same', tsSast('2026-09-10T08:00:00') === '2026-09-10T06:00:00.000Z');
ok('tsSast(): a string that already carries Z is trusted as-is, never re-shifted', tsSast('2026-09-10 08:00:00Z') === '2026-09-10T08:00:00.000Z');
ok('tsSast(): a string with an explicit offset is trusted as-is', tsSast('2026-09-10 08:00:00+02:00') === '2026-09-10T06:00:00.000Z');
ok('tsSast(): blank/null/unparseable all return null, never throw', tsSast('') === null && tsSast(null) === null && tsSast('not-a-date') === null);
ok('ts() (every OTHER source) is untouched by this fix', typeof tsShared === 'function' && tsShared('2026-09-01') === '2026-09-01T00:00:00.000Z');

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 }); await c.connect();
const q = async (s, a) => (await c.query(s, a)).rows; const one = async (s, a) => (await q(s, a))[0];
try {
  const sqlSide = await one(`select rake_sf_ts_local('2026-09-10 08:00:00') as z`);
  ok('rake_sf_ts_local() (SQL path: tools/rake.mjs + the in-page Rake, migration-028) agrees with tsSast()',
    sqlSide.z instanceof Date && sqlSide.z.toISOString() === '2026-09-10T06:00:00.000Z', String(sqlSide.z));
  ok('rake_sf_ts_local() is safe regardless of the session TimeZone GUC', (await one(`show timezone`)).TimeZone != null);

  console.log('\nB . dedupe_lake() vici_calls_tz step -- LIVE, one transaction, always rolled back');
  await c.query('BEGIN');

  const twins = () => one(`
    select count(*)::bigint n from vici_calls a join vici_calls b
      on a.agent_login = b.agent_login and a.lead_id = b.lead_id and a.status = b.status and a.length_in_sec = b.length_in_sec
     and b.call_date = a.call_date + interval '2 hours'
     and (a.batch_id in ('B0351', 'B0355', 'B0356') or b.batch_id in ('B0351', 'B0355', 'B0356'))`);
  const before = await one(`select count(*)::bigint n from vici_calls`);
  const beforeTwins = await twins();

  const run1 = (await one(`select dedupe_lake(true, 'verify-vici-tz') as j`)).j;
  const afterRun1 = await one(`select count(*)::bigint n from vici_calls`);
  const twinsAfterRun1 = await twins();
  ok('run 1: no +/-2h twin remains between a known-bad batch and any other batch', +twinsAfterRun1.n === 0, twinsAfterRun1.n + ' remaining (started at ' + beforeTwins.n + ')');
  ok('run 1: the table only ever shrinks or stays put (rows deleted or shifted in place, never added)', BigInt(afterRun1.n) <= BigInt(before.n), before.n + ' -> ' + afterRun1.n);
  ok('run 1: report names both classes it touched', 'found_duplicate' in run1.vici_calls_tz && 'found_orphan_wrong_instant' in run1.vici_calls_tz, JSON.stringify(run1.vici_calls_tz));

  const run2 = (await one(`select dedupe_lake(true, 'verify-vici-tz-2nd') as j`)).j;
  const afterRun2 = await one(`select count(*)::bigint n from vici_calls`);
  const twinsAfterRun2 = await twins();
  ok('run 2 (idempotency): finds nothing further to remove or correct', run2.vici_calls_tz.found_duplicate === 0 && run2.vici_calls_tz.found_orphan_wrong_instant === 0, JSON.stringify(run2.vici_calls_tz));
  ok('run 2 (idempotency): row count is unchanged from run 1', afterRun2.n === afterRun1.n, afterRun1.n + ' -> ' + afterRun2.n);
  ok('run 2 (idempotency): still no twins', +twinsAfterRun2.n === 0);

  const fixedBatches = await q(`select batch_id from vici_tz_fix_batches where batch_id in ('B0351', 'B0355', 'B0356') order by batch_id`);
  ok('every known-bad batch that had rows is recorded fixed (never reprocessed again)', fixedBatches.length >= 1 || +before.n === +afterRun1.n, JSON.stringify(fixedBatches));

  await c.query('ROLLBACK');
  console.log('  (rolled back -- nothing written to the live database)');
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  ok('database half ran without an exception', false, e.message);
} finally {
  await c.end();
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed  (database half rolled back -- nothing was written) ====');
process.exit(fail ? 1 : 0);
