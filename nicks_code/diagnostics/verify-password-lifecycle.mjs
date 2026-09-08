#!/usr/bin/env node
/**
 * verify-password-lifecycle.mjs — the database owns the password lifecycle (migration-025).
 *
 *   node nicks_code/diagnostics/verify-password-lifecycle.mjs
 *
 * NOTHING IS COMMITTED: one transaction, BEGIN … ROLLBACK, on fixture accounts CB9000xx that
 * can never collide with a real agent. Proves, against the REAL functions and triggers:
 *   · an account born on the start password must change it (insert trigger);
 *   · a hash written by any path flips the row to a personal password (update trigger);
 *   · set_password(): flags, lockout reset, every OTHER session dropped, own kept, auth_log row,
 *     refuses a hash outside the Worker's scheme and an inactive account;
 *   · reset_password_to_default(): back on the default, forced change, ALL sessions dropped;
 *   · accounts_on_default_password lists exactly the rows on the default.
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(HERE, '..', '..');
const pg = (await import(pathToFileURL(path.join(HERE, 'node_modules', 'pg', 'lib', 'index.js')).href)).default;
const { hashPassword, START_PASSWORD } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'auth.mjs')).href);
const env = {}; for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2]; }
let pass = 0, fail = 0; const ok = (c, n, d) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d !== undefined ? ' — ' + d : '')); } };
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await c.connect();
const q = async (sql, args) => (await c.query(sql, args)).rows; const one = async (sql, args) => (await q(sql, args))[0];
const DEFAULT = await hashPassword(START_PASSWORD), PERSONAL = await hashPassword('my-own-long-password'), PERSONAL2 = await hashPassword('another-of-my-own');
try {
  await c.query('BEGIN');
  await c.query(`delete from app_users where cb in ('CB900011','CB900012')`);
  console.log('\nA · BORN ON THE START PASSWORD');
  const u = await one(`insert into app_users (username, full_name, role, cb, apps, tabs, active, password_hash, must_change_password)
                        values ('cb900011', 'Fixture One', 'agent', 'CB900011', array['agent']::text[], '{}'::jsonb, true, $1, false)
                        returning id, password_is_default, must_change_password, password_changed_at`, [DEFAULT]);
  ok(u.password_is_default === true, 'a new account is on the default (column default)');
  ok(u.must_change_password === true, 'and MUST change it — even though the insert said false', String(u.must_change_password));
  ok(!!u.password_changed_at, 'password_changed_at is stamped at birth');
  ok((await q(`select 1 from accounts_on_default_password where username = 'cb900011'`)).length === 1, 'the view lists it');

  console.log('\nB · ANY HASH WRITE IS A PERSONAL PASSWORD');
  await c.query(`update app_users set password_hash = $1 where id = $2`, [PERSONAL, u.id]);
  let r = await one(`select password_is_default, must_change_password from app_users where id = $1`, [u.id]);
  ok(r.password_is_default === false && r.must_change_password === false, 'a plain update of the hash flips both flags (old code paths behave)', JSON.stringify(r));
  ok((await q(`select 1 from accounts_on_default_password where username = 'cb900011'`)).length === 0, 'the view no longer lists it');

  console.log('\nC · set_password()');
  await c.query(`insert into app_sessions (token_hash, user_id, expires_at) values ('mine', $1, now() + interval '1 hour'), ('phone', $1, now() + interval '1 hour'), ('laptop', $1, now() + interval '1 hour')`, [u.id]);
  await c.query(`update app_users set failed_attempts = 4, locked_until = now() + interval '10 minutes' where id = $1`, [u.id]);
  const s1 = (await one(`select set_password($1, $2, 'mine', '1.2.3.4') as out`, [u.id, PERSONAL2])).out;
  ok(s1.ok === true && s1.sessions_dropped === 2, 'returns ok and the number of OTHER sessions dropped', JSON.stringify(s1));
  const left = await q(`select token_hash from app_sessions where user_id = $1`, [u.id]);
  ok(left.length === 1 && left[0].token_hash === 'mine', 'my own session survives, the others are gone', JSON.stringify(left));
  r = await one(`select password_hash, password_is_default, must_change_password, failed_attempts, locked_until from app_users where id = $1`, [u.id]);
  ok(r.password_hash === PERSONAL2 && !r.password_is_default && !r.must_change_password, 'hash stored, flags personal');
  ok(r.failed_attempts === 0 && r.locked_until === null, 'lockout state cleared with the new password');
  ok((await q(`select 1 from auth_log where user_id = $1 and event = 'password_change' and ip = '1.2.3.4'`, [u.id])).length === 1, 'auth_log carries password_change with the ip');
  let threw = null; try { await c.query('SAVEPOINT s'); await q(`select set_password($1, 'plain-text-not-a-hash', null, '')`, [u.id]); } catch (e) { threw = e.message; await c.query('ROLLBACK TO SAVEPOINT s'); }
  ok(/pbkdf2h/.test(threw || ''), 'a hash outside the Worker scheme is refused', threw);
  await c.query(`update app_users set active = false where id = $1`, [u.id]);
  threw = null; try { await c.query('SAVEPOINT s2'); await q(`select set_password($1, $2, null, '')`, [u.id, PERSONAL]); } catch (e) { threw = e.message; await c.query('ROLLBACK TO SAVEPOINT s2'); }
  ok(/no active account/.test(threw || ''), 'an inactive account cannot set a password', threw);
  await c.query(`update app_users set active = true where id = $1`, [u.id]);

  console.log('\nD · reset_password_to_default()');
  await c.query(`insert into app_sessions (token_hash, user_id, expires_at) values ('again', $1, now() + interval '1 hour')`, [u.id]);
  const s2 = (await one(`select reset_password_to_default($1, $2, 'nick') as out`, [u.id, DEFAULT])).out;
  r = await one(`select password_hash, password_is_default, must_change_password, failed_attempts from app_users where id = $1`, [u.id]);
  ok(s2.ok === true && s2.must_change_password === true, 'returns ok with the forced flag', JSON.stringify(s2));
  ok(r.password_hash === DEFAULT && r.password_is_default === true && r.must_change_password === true, 'back on the default and forced to change', JSON.stringify(r));
  ok((await q(`select 1 from app_sessions where user_id = $1`, [u.id])).length === 0, 'EVERY session is dropped on a reset');
  ok((await q(`select 1 from auth_log where user_id = $1 and event = 'password_reset' and ip = 'by nick'`, [u.id])).length === 1, 'auth_log carries password_reset by the actor');
  ok((await q(`select 1 from accounts_on_default_password where username = 'cb900011'`)).length === 1, 'the view lists it again');
  const v = await one(`select days_on_default from accounts_on_default_password where username = 'cb900011'`);
  ok(v.days_on_default === 0, 'days_on_default counts from the reset', String(v.days_on_default));
} finally {
  await c.query('ROLLBACK'); await c.end();
}
console.log('\n' + pass + ' passed, ' + fail + ' failed  (transaction rolled back — nothing was written)');
process.exit(fail ? 1 : 0);
