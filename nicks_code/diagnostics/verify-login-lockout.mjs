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
const AGENTOS = 'C:/Users/aarav/OneDrive/Desktop/Chatterbox Agent OS/agentos';
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

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
