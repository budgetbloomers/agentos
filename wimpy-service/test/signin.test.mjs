/* THE WIMPY SIGN-IN NEEDS THE PERSON'S PASSWORD (Spec Kit 009, 2026-10-06; ported to the Wimpy service, Spec Kit 018).
 *
 * The cross-door cases — a wrong guess on the suite's main sign-in and one here count toward ONE lock — need both files
 * and live in the suite: nicks_code/diagnostics/verify-wimpy-service-drift.mjs. Everything else is driven here.
 *
 * Nick: "for the wimpy app users must put this password as well, for example dalwin cb number and his password to
 * login". Until now a CB number alone signed anyone in to Wimpy. This drives the REAL auth.signinWimpy (and login(),
 * whose lockout it now shares) against a mocked database holding real PBKDF2 hashes, and pins every answer in
 * specs/009-wimpy-password-signin/plan.md C2–C3. Every account here is synthetic.
 *
 * Run: node verify-wimpy-signin.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
const SERVICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auth = await import(pathToFileURL(path.join(SERVICE, 'src', 'auth.mjs')).href);
const app = await import(pathToFileURL(path.join(SERVICE, 'src', 'app.mjs')).href);

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const head = (t) => console.log('\n' + t);

const signin = typeof auth.signinWimpy === 'function' ? auth.signinWimpy
  : async () => ({ ok: false, status: 0, error: 'auth.signinWimpy does not exist' });

const PW_MGR = 'Lunch-Pass-145', PW_AGENT = 'agent-pass-9101', PW_NOAPP = 'no-wimpy-9102', PW_OFF = 'gone-9103';
const HASH = {
  mgr: await auth.hashPassword(PW_MGR), agent: await auth.hashPassword(PW_AGENT),
  noapp: await auth.hashPassword(PW_NOAPP), off: await auth.hashPassword(PW_OFF),
};
const WD = auth.WIMPY_DEFAULT_PASSWORD;   // the start password every account begins on (Spec Kit 025: wimpy123)
const SECRETS = [PW_MGR, PW_AGENT, PW_NOAPP, PW_OFF, WD, 'wrong-one', 'Wrong-Pass'];

/* a fresh database per scenario: accounts, an append-only auth_log, sessions, and a count of account lookups */
function makeDB(opts = {}) {
  const users = [
    /* a manager whose username is NOT their CB — the shape of Dalwin's account (username dalwin, CB145) */
    { id: 'u-mgr', username: 'mgr.jane', cb: 'CB9145', full_name: 'Jane Manager', role: 'campaign_manager', active: true,
      apps: ['vas', 'wimpy'], password_hash: HASH.mgr, failed_attempts: 0, locked_until: null },
    { id: 'u-agent', username: 'cb9101', cb: 'CB9101', full_name: 'Sam Agent', role: 'agent', active: true,
      apps: ['agent', 'wimpy'], password_hash: HASH.agent, failed_attempts: 0, locked_until: null },
    { id: 'u-noapp', username: 'cb9102', cb: 'CB9102', full_name: 'Lee NoLunch', role: 'agent', active: true,
      apps: ['agent'], password_hash: HASH.noapp, failed_attempts: 0, locked_until: null },
    { id: 'u-off', username: 'cb9103', cb: 'CB9103', full_name: 'Pat Left', role: 'agent', active: false,
      apps: ['agent', 'wimpy'], password_hash: HASH.off, failed_attempts: 0, locked_until: null },
  ];
  const st = { users, log: [], sessions: [], userLookups: 0, inserts: [], seq: 0 };
  const val = (q, k) => { const m = new RegExp('[?&]' + k + '=([^&]+)').exec(q); return m ? decodeURIComponent(m[1]) : null; };
  st.DB = {
    async select(q) {
      if (q.startsWith('app_users?')) {
        st.userLookups++;
        const un = val(q, 'username'), cb = val(q, 'cb'), id = val(q, 'id');
        let rows = users;
        if (un) rows = rows.filter((u) => 'eq.' + u.username === un);
        if (cb) rows = rows.filter((u) => cb.startsWith('ilike.') && String(u.cb).toLowerCase() === cb.slice(6).toLowerCase());
        if (id) rows = rows.filter((u) => 'eq.' + u.id === id);
        if (/active=is\.true/.test(q)) rows = rows.filter((u) => u.active);
        return rows.slice(0, 1).map((u) => ({ ...u, apps: [...u.apps] }));
      }
      if (q.startsWith('auth_log?')) {
        const since = (val(q, 'at') || 'gte.1970').slice(4);
        let rows = st.log.filter((r) => r.at >= since);
        const uid = val(q, 'user_id'), ip = val(q, 'ip'), ev = val(q, 'event'), un = val(q, 'username');
        if (uid) rows = rows.filter((r) => 'eq.' + r.user_id === uid);
        if (ip) rows = rows.filter((r) => 'eq.' + r.ip === ip);
        if (un) rows = rows.filter((r) => 'eq.' + r.username === un);
        if (ev && ev.startsWith('eq.')) rows = rows.filter((r) => r.event === ev.slice(3));
        else if (ev && ev.startsWith('like.')) { const pre = ev.slice(5).replace(/[*%]$/, ''); rows = rows.filter((r) => String(r.event).startsWith(pre)); }
        /* like PostgREST: newest first ONLY when the query asks for it (review 2026-10-06 — a mock that always sorted
           would hide a dropped `order=at.desc`, and the tally's "stop at the last success" would silently break) */
        rows = /[?&]order=at\.desc/.test(q)
          ? rows.slice().sort((a, b) => (b.at === a.at ? b.seq - a.seq : String(b.at).localeCompare(String(a.at))))
          : rows.slice().sort((a, b) => a.seq - b.seq);
        const lim = +(val(q, 'limit') || 1e9);
        return rows.slice(0, lim).map((r) => ({ event: r.event, at: r.at }));
      }
      return [];
    },
    async insert(table, rows) {
      st.inserts.push({ table, rows: JSON.parse(JSON.stringify(rows)) });
      if (table === 'auth_log' && opts.logDown) throw new Error('auth_log unwritable');
      if (table === 'auth_log') for (const r of rows) st.log.push({ ...r, at: new Date().toISOString(), seq: ++st.seq });
      if (table === 'app_sessions') st.sessions.push(...rows);
      return rows;
    },
    async update(q, patch) { const id = val(q, 'id'); for (const u of users) if ('eq.' + u.id === id) Object.assign(u, patch); return null; },
    async del() { return null; },
  };
  st.user = (id) => users.find((u) => u.id === id);
  return st;
}
/* the Node adapter writes the socket's address into x-wimpy-socket-ip; that is what clientIp() reads without TRUST_PROXY */
const reqFrom = (ip) => ({ headers: { get: (h) => (h === 'x-wimpy-socket-ip' ? ip : h === 'user-agent' ? 'verify' : '') } });
const pending = [];
const ctx = { waitUntil: (p) => { pending.push(p); } };
const settle = async () => { await Promise.all(pending.splice(0)); };
const GENERIC = 'That CB number and password do not match.';

head('A · THE RIGHT CB NUMBER AND THE WIMPY START PASSWORD SIGN IN — ONLY TO WIMPY');
{
  const st = makeDB();
  const r = await signin(st.DB, reqFrom('10.0.0.1'), { cb: 'CB9101', password: WD }, ctx); await settle();
  ok('CB number + the Wimpy start password (wimpy123) → signed in', r.ok === true && typeof r.token === 'string' && r.token.length >= 32, JSON.stringify(r));
  ok('the session it makes is the lunch-only one (scope wimpy, 12 h)', st.sessions.length === 1 && st.sessions[0].scope === 'wimpy'
    && st.sessions[0].user_id === 'u-agent' && Math.abs(new Date(st.sessions[0].expires_at) - Date.now() - 12 * 3600000) < 60000, JSON.stringify(st.sessions));
  ok('the token is stored only as a hash', st.sessions[0] && st.sessions[0].token_hash && st.sessions[0].token_hash !== r.token);
  ok('the answer names the person and says scope wimpy, and carries no hash', r.user && r.user.cb === 'CB9101' && r.user.scope === 'wimpy'
    && !('password_hash' in r.user), JSON.stringify(r.user));
  ok('the success is in the audit log as login_ok:wimpy, with the network address', st.log.some((l) => l.event === 'login_ok:wimpy' && l.user_id === 'u-agent' && l.ip === '10.0.0.1'));
  ok('...never as the bare login_ok the Analytics sign-in reports count', !st.log.some((l) => l.event === 'login_ok'));
}
{
  /* the old password-less success event proved nothing — it must NOT settle failures counted after it */
  const st = makeDB();
  for (let i = 0; i < 3; i++) await signin(st.DB, reqFrom('10.0.0.9'), { cb: 'CB9101', password: 'Wrong-Pass' }, ctx);
  st.log.push({ user_id: 'u-agent', username: 'wimpy:cb9101', event: 'wimpy_signin_ok', ip: '10.0.0.9', at: new Date().toISOString(), seq: ++st.seq });
  for (let i = 0; i < 2; i++) await signin(st.DB, reqFrom('10.0.0.9'), { cb: 'CB9101', password: 'Wrong-Pass' }, ctx);
  ok('an old CB-only success in the log does not reset the count (3 + 2 wrong = locked)', !!st.user('u-agent').locked_until);
}

head('B · EVERY SPELLING, AND A USERNAME (DALWIN\'S SHAPE: USERNAME ≠ CB)');
for (const typed of ['CB-9101', 'cb 9101', '9101', 'cb09101']) {
  const st = makeDB();
  const r = await signin(st.DB, reqFrom('10.0.0.2'), { cb: typed, password: WD }, ctx);
  ok('"' + typed + '" + password signs in as CB9101', r.ok === true && r.user && r.user.cb === 'CB9101', JSON.stringify(r));
}
{
  const st = makeDB();
  const byCb = await signin(st.DB, reqFrom('10.0.0.3'), { cb: 'CB9145', password: WD }, ctx);
  const byName = await signin(st.DB, reqFrom('10.0.0.3'), { cb: 'mgr.jane', password: WD }, ctx);
  const alias = await signin(st.DB, reqFrom('10.0.0.3'), { username: 'mgr.jane', password: WD }, ctx);
  ok('a manager signs in with their CB number + password', byCb.ok === true && byCb.user.username === 'mgr.jane', JSON.stringify(byCb));
  ok('...and with their username + password', byName.ok === true && byName.user.username === 'mgr.jane', JSON.stringify(byName));
  ok('`username` is still accepted in place of `cb`', alias.ok === true, JSON.stringify(alias));
}

head('C · A CB NUMBER ALONE NO LONGER SIGNS ANYONE IN');
{
  const st = makeDB();
  const old = await signin(st.DB, reqFrom('10.0.0.4'), { cb: 'CB9101' }, ctx);
  ok('the old page (no password key) is refused with 400', old.ok === false && old.status === 400, JSON.stringify(old));
  ok('...and told to reload for the new sign-in', /reload/i.test(old.error || ''), old.error);
  const empty = await signin(st.DB, reqFrom('10.0.0.4'), { cb: 'CB9101', password: '' }, ctx);
  ok('an empty password → 400 "Type your CB number and your password."', empty.status === 400 && empty.error === 'Type your CB number and your password.', JSON.stringify(empty));
  const noCb = await signin(st.DB, reqFrom('10.0.0.4'), { cb: '  ', password: WD }, ctx);
  ok('an empty CB number → the same 400', noCb.status === 400 && noCb.error === 'Type your CB number and your password.', JSON.stringify(noCb));
  ok('none of those looked an account up', st.userLookups === 0, String(st.userLookups));
  const longCb = await signin(st.DB, reqFrom('10.0.0.4'), { cb: 'x'.repeat(41), password: WD }, ctx);
  const longPw = await signin(st.DB, reqFrom('10.0.0.4'), { cb: 'CB9101', password: 'p'.repeat(201) }, ctx);
  ok('an over-long CB (41) or password (201) → 400 before any lookup', longCb.status === 400 && longPw.status === 400 && st.userLookups === 0,
    longCb.status + ' ' + longPw.status + ' lookups=' + st.userLookups);
  ok('no session was made for any of them', st.sessions.length === 0);
}

head('D · WRONG, UNKNOWN AND DISABLED GET ONE ANSWER');
{
  const st = makeDB();
  const wrong = await signin(st.DB, reqFrom('10.0.0.5'), { cb: 'CB9101', password: 'wrong-one' }, ctx);
  const unknown = await signin(st.DB, reqFrom('10.0.0.5'), { cb: 'CB9999', password: 'wrong-one' }, ctx);
  const off = await signin(st.DB, reqFrom('10.0.0.5'), { cb: 'CB9103', password: WD }, ctx);
  ok('a wrong password → 401 "' + GENERIC + '"', wrong.status === 401 && wrong.error === GENERIC, JSON.stringify(wrong));
  ok('an unknown CB → the same status and words', unknown.status === wrong.status && unknown.error === wrong.error, JSON.stringify(unknown));
  ok('a disabled account, even with the right Wimpy password → the same', off.status === wrong.status && off.error === wrong.error, JSON.stringify(off));
  ok('no session for any of them', st.sessions.length === 0);
  ok('each failure is logged as a Wimpy login_fail', ['bad_password', 'no_user', 'disabled'].every((w) => st.log.some((l) => l.event === 'login_fail:wimpy:' + w)),
    st.log.map((l) => l.event).join(','));
}

head('E · GUESSING LOCKS THE ACCOUNT — THE SAME LOCK AS THE MAIN SIGN-IN');
{
  const st = makeDB();
  for (let i = 0; i < 5; i++) await signin(st.DB, reqFrom('10.0.1.' + i), { cb: 'CB9101', password: 'Wrong-Pass' }, ctx);
  ok('five wrong Wimpy passwords lock the account', !!st.user('u-agent').locked_until, 'locked_until=' + st.user('u-agent').locked_until);
  const right = await signin(st.DB, reqFrom('10.0.1.9'), { cb: 'CB9101', password: WD }, ctx);
  ok('the right password is then refused on Wimpy with 423', right.status === 423 && /locked/i.test(right.error || ''), JSON.stringify(right));
  ok('...logged as locked:wimpy with the network address', st.log.some((l) => l.event === 'locked:wimpy' && l.user_id === 'u-agent' && l.ip === '10.0.1.9'),
    st.log.map((l) => l.event).join(','));
  ok('no session was made while locked', st.sessions.length === 0);
}
{
  /* the fail-CLOSED path: the audit log cannot be written, so the tally falls back to the counter and still locks */
  const st = makeDB({ logDown: true });
  for (let i = 0; i < 5; i++) await signin(st.DB, reqFrom('10.0.2.2'), { cb: 'CB9101', password: 'Wrong-Pass' }, ctx);
  ok('with the audit log unwritable, five wrong Wimpy passwords still lock the account', !!st.user('u-agent').locked_until,
    'failed_attempts=' + st.user('u-agent').failed_attempts);
}
{
  const st = makeDB();
  for (let i = 0; i < 4; i++) await signin(st.DB, reqFrom('10.0.3.1'), { cb: 'CB9101', password: 'Wrong-Pass' }, ctx);
  const good = await signin(st.DB, reqFrom('10.0.3.1'), { cb: 'CB9101', password: WD }, ctx); await settle();
  ok('four wrong then the right one → signed in', good.ok === true, JSON.stringify(good));
  /* stability plan (2026-10-26): a Wimpy success settles the WIMPY tally (its login_ok:wimpy row) but no longer writes the
     account's counter or lock — those belong to the AgentOS door too, and clearing them reopened AgentOS after 4 guesses */
  ok('...and the success leaves the account\'s lock clear without rewriting the AgentOS counter', !st.user('u-agent').locked_until && st.user('u-agent').failed_attempts === 4,
    'failed_attempts=' + st.user('u-agent').failed_attempts);
  await signin(st.DB, reqFrom('10.0.3.1'), { cb: 'CB9101', password: 'Wrong-Pass' }, ctx);
  ok('one typo after a Wimpy success does not lock (earlier failures are settled)', !st.user('u-agent').locked_until);
}

head('F · RIGHT PASSWORD, NO WIMPY APP');
{
  const st = makeDB();
  const r = await signin(st.DB, reqFrom('10.0.4.1'), { cb: 'CB9102', password: WD }, ctx); await settle();
  ok('refused with 403 and told why', r.status === 403 && /cannot order from Wimpy/i.test(r.error || ''), JSON.stringify(r));
  ok('no session is made', st.sessions.length === 0);
  ok('it is not counted as a wrong password', !st.log.some((l) => l.user_id === 'u-noapp' && String(l.event).startsWith('login_fail'))
    && (st.user('u-noapp').failed_attempts || 0) === 0, st.log.map((l) => l.event).join(','));
  ok('it is logged as a refusal, with the network address', st.log.some((l) => l.event === 'wimpy_signin_refused:no_app' && l.ip === '10.0.4.1'));
  const wrong = await signin(st.DB, reqFrom('10.0.4.1'), { cb: 'CB9102', password: 'wrong-one' }, ctx);
  ok('a WRONG password for that account gets the ordinary answer (nothing learnt about its apps)', wrong.status === 401 && wrong.error === GENERIC, JSON.stringify(wrong));
}

/* 100, not 30 (security review 2026-10-06): the floor may share one address and launch day will be full of first-time
   password typos — 30 could close lunch for everyone; the per-account lock is the real guard, and /api/login (the same
   password) has no per-network cap at all, so a low one here protected little and cost a lot */
head('G · ONE NETWORK: A HUNDRED FAILURES IN TEN MINUTES, THEN STOP');
{
  const st = makeDB();
  for (let i = 0; i < 99; i++) await signin(st.DB, reqFrom('10.9.9.9'), { cb: 'CB' + (8000 + i), password: 'wrong-one' }, ctx);
  const at99 = await signin(st.DB, reqFrom('10.9.9.9'), { cb: 'CB9101', password: WD }, ctx);
  ok('after 99 failures from one network a real sign-in still works (a lunch rush is not locked out)', at99.ok === true, JSON.stringify(at99));
  await signin(st.DB, reqFrom('10.9.9.9'), { cb: 'CB8999', password: 'wrong-one' }, ctx);
  const before = st.userLookups;
  const at30 = await signin(st.DB, reqFrom('10.9.9.9'), { cb: 'CB9145', password: WD }, ctx);
  ok('the 100th failure closes that network for ten minutes — even a right password gets 429', at30.status === 429 && /ten minutes/i.test(at30.error || ''), JSON.stringify(at30));
  ok('...without looking any account up', st.userLookups === before, (st.userLookups - before) + ' lookups');
  const other = await signin(st.DB, reqFrom('10.1.1.1'), { cb: 'CB9145', password: WD }, ctx);
  ok('another network is not affected', other.ok === true, JSON.stringify(other));
}

head('H · THE PASSWORD IS NEVER WRITTEN ANYWHERE');
{
  const st = makeDB();
  await signin(st.DB, reqFrom('10.0.5.1'), { cb: 'CB9101', password: 'wrong-one' }, ctx);
  await signin(st.DB, reqFrom('10.0.5.1'), { cb: 'CB9101', password: WD }, ctx);
  await signin(st.DB, reqFrom('10.0.5.1'), { cb: 'CB9102', password: WD }, ctx);
  await signin(st.DB, reqFrom('10.0.5.1'), { cb: 'CB9999', password: 'Wrong-Pass' }, ctx);
  await settle();
  const written = JSON.stringify(st.inserts) + JSON.stringify(st.users.map(({ password_hash, ...u }) => u));
  ok('no insert or update carries a typed password', !SECRETS.some((s) => written.includes(s)), SECRETS.filter((s) => written.includes(s)).join(','));
}
{
  /* two boxes make a swap likely: a password typed into the CB box must not land in the audit log as a "username"
     (code review 2026-10-06) — an unknown name that is not CB-shaped is logged without its text */
  const st = makeDB();
  const r = await signin(st.DB, reqFrom('10.0.5.2'), { cb: 'My-Secret-Pass9', password: 'CB9101' }, ctx);
  ok('a password typed into the CB box is refused with the ordinary answer', r.status === 401 && r.error === GENERIC, JSON.stringify(r));
  ok('...and its text is nowhere in the audit log', !JSON.stringify(st.inserts).toLowerCase().includes('my-secret-pass9'), JSON.stringify(st.log.map((l) => l.username)));
  ok('...though the failure itself is still logged (it counts toward the network limit)', st.log.some((l) => l.event === 'login_fail:wimpy:no_user' && l.ip === '10.0.5.2'));
  const cbTypo = makeDB();
  await signin(cbTypo.DB, reqFrom('10.0.5.3'), { cb: 'CB9998', password: 'x' }, ctx);
  ok('an unknown CB number is still logged as typed (support can see the typo)', cbTypo.log.some((l) => l.username === 'cb9998'));
}

head('I · THE SERVICE: THE ROUTE, THE SHARED BLOCKS, THE SCOPE GATE');
{
  const appSrc = fs.readFileSync(path.join(SERVICE, 'src', 'app.mjs'), 'utf8');
  const authSrc = fs.readFileSync(path.join(SERVICE, 'src', 'auth.mjs'), 'utf8');
  ok('the route calls signinWimpy, passing ctx and env', /path === '\/api\/wimpy\/signin'[\s\S]{0,400}signinWimpy\(DB, req, await req\.json\(\)\.catch\(\(\) => \(\{\}\)\), ctx, env\)/.test(appSrc));
  ok('no CB-only sign-in exists', !/signinByCb/.test(appSrc + authSrc) && typeof auth.signinByCb === 'undefined');
  ok('the session gate accepts only wimpy sessions', appSrc.includes("user.scope !== 'wimpy'"));
  for (const b of ['hashing', 'lookup', 'lock', 'session']) ok('auth.mjs carries the shared block "' + b + '" between drift markers', authSrc.includes('SHARED-AUTH:' + b + ' BEGIN') && authSrc.includes('SHARED-AUTH:' + b + ' END'));
  ok('the network address comes from clientIp(), never a Cloudflare header', /clientIp\(req, env\)/.test(authSrc) && !/cf-connecting-ip/.test(authSrc));
  /* the gate itself, through handle(): a FULL-scope session (the suite's sign-in) is refused; a wimpy one answers */
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const row = (scope) => ({ user_id: 'u-1', expires_at: '2099-01-01T00:00:00Z', scope, app_users: { username: 'cb9101', full_name: 'Sam Agent', role: 'agent', apps: ['agent', 'wimpy'], active: true, cb: 'CB9101' } });
  const SESS = { [sha('tok-full')]: row('full'), [sha('tok-wimpy')]: row('wimpy'), [sha('tok-ref')]: row('referrals') };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { const url = new URL(String(u)); if (url.pathname === '/rest/v1/app_sessions') { const m = /^eq\.(.*)$/.exec(url.searchParams.get('token_hash') || ''); const s = m && SESS[m[1]]; return new Response(JSON.stringify(s ? [s] : []), { status: 200 }); } return new Response('[]', { status: 200 }); };
  try {
    const ENV = { SUPABASE_URL: 'http://stub.local', SUPABASE_SECRET_KEY: 'svc-test' };
    const ask = (tok, p = '/api/wimpy/menu') => app.handle(new Request('http://wimpy.local' + p, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} }), ENV, { waitUntil() {} });
    const full = await ask('tok-full'), ref = await ask('tok-ref'), w = await ask('tok-wimpy'), none = await ask(null), me = await ask('tok-full', '/api/wimpy/me');
    ok('a full-scope session → 403 on the menu', full.status === 403 && /Wimpy orders only/.test(await full.text()), String(full.status));
    ok('a referrals-scoped session → 403', ref.status === 403, String(ref.status));
    ok('…and on /api/wimpy/me too (nothing answers a foreign session)', me.status === 403, String(me.status));
    ok('a wimpy session reads the menu', w.status === 200 && Array.isArray((await w.json()).items), String(w.status));
    ok('no session → 401', none.status === 401, String(none.status));
  } finally { globalThis.fetch = realFetch; }
}

head('J · THE WIMPY PASSWORD (Spec Kit 025): wimpy123 to start, the person\'s own once set, never the Agent Analytics one');
{
  const PW_W = 'wimpy-only-pass-1', PW_NEW = 'brand-new-pass-1';
  ok('the start password is wimpy123 (Nick, 9 Oct)', WD === 'wimpy123');
  const st0 = makeDB();
  const a0 = await signin(st0.DB, reqFrom('10.5.0.0'), { cb: 'CB9101', password: PW_AGENT }, ctx);
  ok('the Agent Analytics password does NOT open Wimpy (401, the usual words)', a0.status === 401 && a0.error === GENERIC, JSON.stringify(a0));
  const a1 = await signin(st0.DB, reqFrom('10.5.0.0'), { cb: 'CB9101', password: WD }, ctx);
  ok('the start password does, and the answer says the person is still on it', a1.ok === true && a1.user.wimpy_password_is_default === true, JSON.stringify(a1).slice(0, 160));
  const st = makeDB(); st.user('u-agent').wimpy_password_hash = await auth.hashPassword(PW_W);
  const a = await signin(st.DB, reqFrom('10.5.0.1'), { cb: 'CB9101', password: PW_W }, ctx);
  ok('with an own Wimpy password set, that password signs in — and the flag is off', a.ok === true && a.user.wimpy_password_is_default === false, JSON.stringify(a).slice(0, 160));
  const b = await signin(st.DB, reqFrom('10.5.0.1'), { cb: 'CB9101', password: WD }, ctx);
  ok('…and the start password no longer opens that account (401)', b.status === 401 && b.error === GENERIC, JSON.stringify(b));
  const b2 = await signin(st.DB, reqFrom('10.5.0.1'), { cb: 'CB9101', password: PW_AGENT }, ctx);
  ok('…nor does the Agent Analytics password', b2.status === 401, JSON.stringify(b2));
  const eff = await auth.wimpyAccount({ id: 1, password_hash: 'A', wimpy_password_hash: 'W' }), dflt = await auth.wimpyAccount({ id: 1, password_hash: 'A' });
  ok('wimpyAccount() hands the shared check the own hash, else a hash of the start password — never the Agent Analytics hash', eff.password_hash === 'W' && dflt.password_hash !== 'A' && await auth.verifyPassword(WD, dflt.password_hash) === true && await auth.wimpyAccount(null) === null);
  /* the change itself */
  const sess = { user_id: 'u-agent', username: 'cb9101', token_hash: 'th-current' };
  const st3 = makeDB(); const deleted = []; st3.DB.del = async (q) => { deleted.push(q); return null; };
  const chg = (body, ip = '10.5.0.3') => auth.changeWimpyPassword(st3.DB, sess, body, reqFrom(ip), ctx, {});
  const wrong = await chg({ current: 'nope-nope-nope', new: PW_NEW });
  ok('a wrong current password → 401 "That is not your current Wimpy password."', wrong.status === 401 && /current Wimpy password/.test(wrong.body.error), JSON.stringify(wrong));
  ok('…and it counts toward the account lock like any Wimpy failure', st3.log.some((l) => l.event === 'login_fail:wimpy:bad_password' && l.user_id === 'u-agent'));
  const agentPw = await chg({ current: PW_AGENT, new: PW_NEW });
  ok('the Agent Analytics password is not the "current" Wimpy password either → 401', agentPw.status === 401, JSON.stringify(agentPw));
  ok('a new password under 10 characters → 400', (await chg({ current: WD, new: 'short' })).status === 400);
  ok('a new password equal to the current → 400', (await chg({ current: WD, new: WD })).status === 400);
  const toStart = await chg({ current: 'whatever-10', new: WD });
  ok('choosing the start password as the new one → 400 in words, before any lookup', toStart.status === 400 && /start password/.test(toStart.body.error || ''), JSON.stringify(toStart));
  ok('a missing box → 400', (await chg({ current: WD })).status === 400 && (await chg({ new: PW_NEW })).status === 400);
  ok('nothing was written by the refusals', !st3.user('u-agent').wimpy_password_hash && !deleted.length);
  const done = await chg({ current: WD, new: PW_NEW }); await settle();
  ok('the start password as current + a new one → 200', done.status === 200 && done.body.ok === true, JSON.stringify(done));
  ok('the Wimpy hash is written and verifies; the Agent Analytics hash is untouched', !!st3.user('u-agent').wimpy_password_hash && st3.user('u-agent').password_hash === HASH.agent && await auth.verifyPassword(PW_NEW, st3.user('u-agent').wimpy_password_hash) === true);
  ok('every OTHER Wimpy session of the account is ended (this one stays)', deleted.length === 1 && /^app_sessions\?user_id=eq\.u-agent&scope=eq\.wimpy&token_hash=neq\.th-current$/.test(deleted[0]), deleted.join(' | '));
  ok('logged as wimpy_password_change with the network address', st3.log.some((l) => l.event === 'wimpy_password_change' && l.ip === '10.5.0.3'));
  ok('the failure counters are settled by the change', st3.user('u-agent').failed_attempts === 0 && !st3.user('u-agent').locked_until);
  const e = await signin(st3.DB, reqFrom('10.5.0.4'), { cb: 'CB9101', password: PW_NEW }, ctx);
  ok('signing in with the new Wimpy password works', e.ok === true, JSON.stringify(e).slice(0, 100));
  const f = await signin(st3.DB, reqFrom('10.5.0.4'), { cb: 'CB9101', password: WD }, ctx);
  ok('…and the start password is refused on that account from now on', f.status === 401, JSON.stringify(f));
  const again = await chg({ current: PW_NEW, new: 'another-new-pass-2' }); await settle();
  ok('the NEW Wimpy password is the current one for the next change', again.status === 200, JSON.stringify(again));
  ok('no typed password reached any insert or update', !JSON.stringify(st3.inserts).includes(PW_NEW) && !JSON.stringify(st3.inserts).includes('another-new-pass-2'));
  /* the route through handle(): it sits behind the bearer + scope gate like every account route */
  const appSrc = fs.readFileSync(path.join(SERVICE, 'src', 'app.mjs'), 'utf8');
  ok('POST /api/wimpy/password is routed after the scope gate to changeWimpyPassword', appSrc.indexOf("user.scope !== 'wimpy'") < appSrc.indexOf("path === '/api/wimpy/password'") && /changeWimpyPassword\(DB, user, await req\.json\(\)\.catch\(\(\) => \(\{\}\)\), req, ctx, env\)/.test(appSrc));
  ok('GET /api/wimpy/me reports wimpy_password_is_default', /wimpy\/me'[\s\S]{0,600}wimpy_password_is_default/.test(appSrc));
}

console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====');
process.exit(fail ? 1 : 0);
