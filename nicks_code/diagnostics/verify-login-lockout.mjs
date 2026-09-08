/* AN ONLINE BRUTE FORCE MUST GET LOCKED OUT — EVEN WHEN THE GUESSES ARRIVE AT ONCE.
 *
 * The lockout used to be `failed_attempts = (read value) + 1`. Fire N guesses in parallel
 * and every one reads 0 and writes 1, so locked_until was never set and the account
 * absorbed unlimited attempts. The count now comes from auth_log, which is append-only
 * and therefore cannot race. This drives the REAL login() against a mocked database.
 *
 * Run: node verify-login-lockout.mjs
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const AGENTOS = process.env.AGENTOS || decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');   // repo-relative (2026-09-08): the laptop path failed every cloud run
const auth = await import(pathToFileURL(path.join(AGENTOS, 'worker', 'src', 'auth.mjs')).href);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + ' — ' + d); } };

const USER = { id: 'u1', username: 'cb93', active: true, role: 'agent', cb: 'CB93',
  password_hash: 'pbkdf2$100000$c2FsdA==$bm90dGhlcmlnaHRoYXNo', failed_attempts: 0, locked_until: null };
let authLog = [];
const DB = {
  async select(q) {
    if (q.startsWith('app_users?')) return [USER];
    if (q.startsWith('auth_log?')) {
      const m = /at=gte\.([^&]+)/.exec(q); const since = m ? decodeURIComponent(m[1]) : '1970';
      return authLog.filter(r => r.username === 'cb93' && r.at >= since)
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))       // order=at.desc
        .map(r => ({ event: r.event, at: r.at }));
    }
    return [];
  },
  async insert(table, rows) {
    if (table === 'auth_log') for (const r of rows) authLog.push({ ...r, at: new Date().toISOString() });
    return rows;
  },
  async update(q, patch) { Object.assign(USER, patch); return null; },
};
const req = { headers: { get: () => '' } };
const ctx = { waitUntil: () => {} };

/* --- 12 guesses ALL AT ONCE, the shape that defeated the old counter --- */
const results = await Promise.all(
  Array.from({ length: 12 }, () => auth.login(DB, req, { username: 'cb93', password: 'wrong' }, ctx))
);
ok('every parallel guess is rejected', results.every(r => !r.ok), JSON.stringify(results.map(r => r.status)));
ok('every failure is written to the append-only log', authLog.length >= 12, String(authLog.length));
ok('the account IS locked after a parallel burst', !!USER.locked_until, 'locked_until=' + USER.locked_until);
ok('the stored counter reflects the real number of failures', (USER.failed_attempts || 0) >= 5, String(USER.failed_attempts));

/* --- a locked account is refused before any password work --- */
const during = await auth.login(DB, req, { username: 'cb93', password: 'wrong' }, ctx);
ok('further attempts are refused while locked', during.status === 423, String(during.status));

/* --- once the window passes, ONE typo must not instantly re-lock --- */
USER.locked_until = null;
authLog = authLog.map(r => ({ ...r, at: new Date(Date.now() - 60 * 60000).toISOString() }));  // failures now an hour old
const afterWait = await auth.login(DB, req, { username: 'cb93', password: 'wrong-again' }, ctx);
ok('a single typo after the lockout expires does not re-lock', !USER.locked_until,
  'locked_until=' + USER.locked_until + ' status=' + afterWait.status);

/* --- CHANGE MY OWN PASSWORD (Nick, 2026-09-08) — the rule in auth.changePassword --- */
{
  const real = await auth.hashPassword('agentos123');
  const ACC = { id: 'u2', username: 'cb17', password_hash: real, must_change_password: false };
  const sessions = [{ user_id: 'u2', token_hash: 'mine' }, { user_id: 'u2', token_hash: 'phone' }, { user_id: 'u9', token_hash: 'other' }];
  const deletes = []; const logs = [];
  const DB2 = {
    async select(q) { return q.startsWith('app_users?') ? [{ password_hash: ACC.password_hash, must_change_password: ACC.must_change_password }] : []; },
    async update(q, patch) { Object.assign(ACC, patch); },
    async del(q) { deletes.push(q); const m = /token_hash=neq\.(\w+)/.exec(q); for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].user_id === 'u2' && sessions[i].token_hash !== (m && m[1])) sessions.splice(i, 1); },
    async insert(t, rows) { if (t === 'auth_log') logs.push(...rows); },
    /* set_password (migration-025) — the mock does what the SQL does: hash + flags, other sessions dropped, auth_log row */
    async rpc(fn, a) { if (fn !== 'set_password') throw new Error('unexpected rpc ' + fn);
      Object.assign(ACC, { password_hash: a.p_new_hash, password_is_default: false, must_change_password: false });
      let d = 0; for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].user_id === a.p_user_id && sessions[i].token_hash !== a.p_keep_token) { sessions.splice(i, 1); d++; }
      logs.push({ user_id: a.p_user_id, username: ACC.username, event: 'password_change', ip: a.p_ip }); return { ok: true, sessions_dropped: d }; },
  };
  const me = { user_id: 'u2', username: 'cb17', token_hash: 'mine' };
  const r1 = await auth.changePassword(DB2, me, { new_password: 'short' }, req, ctx);
  ok('a short password is refused', r1.status === 400, String(r1.status));
  const r0 = await auth.changePassword(DB2, me, { current_password: 'agentos123', new_password: 'agentos123' }, req, ctx);
  ok('the start password itself is refused as a new password', r0.status === 400 && /start password/.test(r0.body.error), r0.status + ' ' + r0.body.error);
  const r2 = await auth.changePassword(DB2, me, { new_password: 'a-good-long-one' }, req, ctx);
  ok('a voluntary change without the current password is refused', r2.status === 400 && /current/.test(r2.body.error), r2.status + ' ' + r2.body.error);
  const r3 = await auth.changePassword(DB2, me, { current_password: 'not-it', new_password: 'a-good-long-one' }, req, ctx);
  ok('a wrong current password is refused', r3.status === 403, String(r3.status));
  ok('nothing was written on the refusals', ACC.password_hash === real && logs.length === 0 && sessions.length === 3);
  const r4 = await auth.changePassword(DB2, me, { current_password: 'agentos123', new_password: 'agentos123' }, req, ctx);
  ok('re-using the current password is refused', r4.status === 400, String(r4.status));
  const r5 = await auth.changePassword(DB2, me, { current_password: 'agentos123', new_password: 'a-good-long-one' }, req, ctx);
  ok('the right current password changes it', r5.status === 200 && r5.body.ok, String(r5.status));
  ok('the stored hash verifies the NEW password and not the old', await auth.verifyPassword('a-good-long-one', ACC.password_hash) && !(await auth.verifyPassword('agentos123', ACC.password_hash)));
  ok('every OTHER session of the account is signed out, mine and other people\'s survive', sessions.length === 2 && sessions.some(x => x.token_hash === 'mine') && sessions.some(x => x.token_hash === 'other'), JSON.stringify(sessions));
  ok('auth_log records password_change', logs.length === 1 && logs[0].event === 'password_change' && logs[0].username === 'cb17');
  ACC.must_change_password = true;
  const r6 = await auth.changePassword(DB2, me, { new_password: 'first-sign-in-pick' }, req, ctx);
  ok('a FORCED first-sign-in change needs no current password', r6.status === 200 && ACC.must_change_password === false, String(r6.status));
  ACC.must_change_password = true;
  const r7 = await auth.changePassword(DB2, me, { current_password: 'wrong-one', new_password: 'another-long-pick' }, req, ctx);
  ok('but a WRONG current password given on a forced change is still refused', r7.status === 403 && ACC.must_change_password === true, String(r7.status));
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
