/**
 * SIGN-IN FOR THE WIMPY SERVICE (Spec Kit 018, 2026-10-09).
 *
 * The lunch app left the Cloudflare Worker but kept the suite's accounts and the suite's rules: a person signs in with
 * their CB number (managers: username) and the SAME password Agent Analytics checks, through the SAME checkPassword()
 * and the same lock — a wrong guess here counts toward the account's lock there. Those rules are not re-implemented;
 * the four SHARED-AUTH blocks below are copied verbatim from worker/src/auth.mjs and a guard in the suite
 * (verify-wimpy-service-drift.mjs) fails the moment the two copies differ. Only signinWimpy() and logout() are this
 * file's own, and signinWimpy differs from the Worker's old one in exactly one line: where the client address comes
 * from (net.mjs clientIp — the socket, or a trusted proxy's x-forwarded-for).
 *
 * Backed by app_users / app_sessions / auth_log (migration 003; scope column migration-037). Passwords never touch
 * disk or logs in plaintext.
 */
import { clientIp } from './net.mjs';

/* SHARED-AUTH:hashing BEGIN — copied VERBATIM from worker/src/auth.mjs (Spec Kit 018); nicks_code/diagnostics/
   verify-wimpy-service-drift.mjs fails if this block differs from the Worker's by one character. Change both together. */
const ITER = 100000; // Cloudflare Workers caps PBKDF2 at 100k iterations
// Hex encoding — unambiguous across runtimes (no atob/btoa variance).
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (s) => new Uint8Array((s.match(/.{2}/g) || []).map((h) => parseInt(h, 16)));

async function pbkdf2(password, salt, iterations = ITER) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `pbkdf2h$${ITER}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iters, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'pbkdf2h') return false; // only the hex scheme is accepted
    const calc = await pbkdf2(password, fromHex(saltHex), parseInt(iters, 10));
    const want = fromHex(hashHex);
    if (calc.length !== want.length) return false;
    let diff = 0; for (let i = 0; i < calc.length; i++) diff |= calc[i] ^ want[i]; // constant-time
    return diff === 0;
  } catch { return false; }
}

const sha256hex = async (s) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

const log = (DB, user_id, username, event, ip) =>
  DB.insert('auth_log', [{ user_id, username, event, ip }]).catch(() => {});
/* SHARED-AUTH:hashing END */

/* SHARED-AUTH:lookup BEGIN — copied VERBATIM from worker/src/auth.mjs (Spec Kit 018); nicks_code/diagnostics/
   verify-wimpy-service-drift.mjs fails if this block differs from the Worker's by one character. Change both together. */
/* CB NUMBERS ARE USERNAMES. Agent Analytics signs people in with their CB
   number, and this is deliberately the SAME login as everyone else's rather
   than a second authentication system: one hasher, one lockout, one session
   table, one audit log. tools/provision-agent-logins.mjs stores the portal
   accounts with username = the normalised CB number in lower case ("cb93"),
   so all that is needed here is to accept the ways a person actually types it
   — "CB-93", "cb 93", "093" — and normalise before the lookup. A name with no
   digits is untouched, so management logins behave exactly as before.
   Shared by login() and signinWimpy() (Spec Kit 009) so the two can never spell a CB differently. */
function loginKey(typed) {
  const raw = String(typed || '').trim();
  if (/^\s*cb[\s-]*0*\d+\s*$/i.test(raw)) return 'cb' + String(parseInt(raw.replace(/[^0-9]/g, ''), 10));
  if (/^\s*\d+\s*$/.test(raw)) return 'cb' + String(parseInt(raw, 10));
  return raw.toLowerCase();
}

/* ...AND A CB NUMBER IS AN IDENTIFIER IN ITS OWN RIGHT, not merely a spelling of
   a username. The username lookup assumes username === cb, which holds for every
   account provision-agent-logins created and fails for anyone who already had a
   management username before being given a CB. Dalwin is exactly that: the
   account is `dalwin`, the CB is CB145, and typing the number he was told to use
   answered "Invalid username or password" — which reads, to the person typing
   it, as the campaign view being broken.
   So fall back to the cb COLUMN. `app_users_cb_uniq` is a unique index on
   upper(cb), so at most one account can answer and there is no ambiguity to
   resolve. Nothing about the password check, the lockout or the audit trail
   changes. Username is still tried FIRST, so an account literally named
   "cb145" would still win. */
async function findAccount(DB, username) {
  let rows = await DB.select(`app_users?username=eq.${encodeURIComponent(username)}&limit=1`);
  if ((!rows || !rows.length) && /^cb[0-9]+$/.test(username))
    rows = await DB.select(`app_users?cb=ilike.${encodeURIComponent(username)}&limit=1`);
  return (rows && rows[0]) || null;
}
/* SHARED-AUTH:lookup END */

/* SHARED-AUTH:lock BEGIN — copied VERBATIM from worker/src/auth.mjs (Spec Kit 018); nicks_code/diagnostics/
   verify-wimpy-service-drift.mjs fails if this block differs from the Worker's by one character. Change both together. */
const MAX_FAILS = 5;
const LOCK_MIN = 15;
const LOCKED_MSG = 'Account locked after repeated failures. Try again in a few minutes.';
const WIMPY_NO_MATCH = 'That CB number and password do not match.';

/* THE PASSWORD CHECK — ONE FOR EVERY SIGN-IN (Spec Kit 009, 2026-10-06). The main sign-in and the Wimpy
   sign-in both come through here, so a password guessed on either page counts toward the SAME lock: a
   separate, laxer Wimpy limit would have been a second door to the very password that opens Analytics.
   `via` is '' for the main sign-in and 'wimpy' for Wimpy; it only changes the audit event names, the
   wording of the wrong-password answer, and whether the no-account/locked notes are awaited (Wimpy's
   per-network limit counts them, so they must land before the next attempt is counted).
   → {ok:true} or {ok:false, status, error}. */
async function checkPassword(DB, u, username, password, ip, defer, via) {
  const fail = via ? 'login_fail:' + via + ':' : 'login_fail:';
  const wrong = via === 'wimpy' ? WIMPY_NO_MATCH : 'Invalid username or password.';
  const note = async (event) => { const p = log(DB, u?.id, username, event, ip); if (via) await p; else defer(p); };

  if (!u || !u.active) { await note(fail + (u ? 'disabled' : 'no_user')); return { ok: false, status: 401, error: wrong }; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    await note(via ? 'locked:' + via : 'locked');
    return { ok: false, status: 423, error: LOCKED_MSG };
  }
  if (!(await verifyPassword(String(password || ''), u.password_hash))) {
    /* COUNTED FROM THE APPEND-ONLY LOG, NOT FROM A READ-MODIFY-WRITE COUNTER (audit round 4,
       2026-08-28). `failed_attempts = read + 1` raced: fire N guesses in parallel, every one
       reads 0, every one writes 1, and locked_until is never set — so an online brute force
       was never locked out however many attempts it made. auth_log only ever has rows
       INSERTED, so counting recent failures in it cannot race, whatever the concurrency.
       The counter column is still maintained for the admin screens; the LOCK now follows
       the log. Note the failure is logged before counting so this attempt is included. */
    /* The insert must be OBSERVED, not swallowed: log() catches internally, so a failing
       auth_log write used to resolve as success, the count then returned 0 rows, and the
       lock could never fire — unlimited guesses, strictly worse than the counter it
       replaced. If the write did not land we fall back to the counter and still lock. */
    let logged = true;
    try { await DB.insert('auth_log', [{ user_id: u.id, username, event: fail + 'bad_password', ip }]); }
    catch (e) { logged = false; }
    let recent = (u.failed_attempts || 0) + 1;               // the fail-CLOSED default
    if (logged) try {
      /* Count failures SINCE THE LAST SUCCESSFUL LOGIN, not just within the window. Counting
         the bare window punished someone who had just proved they know the password: four
         typos at 08:00, a good sign-in at 08:01, then ONE slip at 08:06 hit five-in-fifteen
         and locked them out. One query fetches both events and the tally stops at the last
         login_ok — or `login_ok:wimpy`, a Wimpy sign-in that proved the same password (Spec Kit 009).
         NOT the old `wimpy_signin_ok`: that sign-in took no password and proved nothing. Wimpy
         failures (`login_fail:wimpy:…`) start with login_fail, so they count here like any other. */
      const since = new Date(Date.now() - LOCK_MIN * 60000).toISOString();
      /* COUNTED PER ACCOUNT, NOT PER SPELLING (audit, 2026-09-03). The log used to be
         read back by the username as TYPED, so an account reachable two ways — `dalwin`
         and its CB `cb145` — carried two independent tallies and alternating them
         doubled the guesses before the lock. Every failure row above carries the resolved
         user_id, so that is what is counted. */
      const rows = await DB.select(`auth_log?user_id=eq.${u.id}&at=gte.${since}&select=event,at&order=at.desc&limit=60`);
      let n = 0;
      for (const r of (rows || [])) {
        const ev = String(r.event || '');
        if (ev === 'login_ok' || ev.startsWith('login_ok:')) break;      // everything older is settled
        if (ev.startsWith('login_fail')) n++;
      }
      recent = n;
    } catch (e) { /* log unreadable — keep the fail-closed counter above */ }
    const patch = { failed_attempts: Math.max(recent, (u.failed_attempts || 0) + 1) };
    if (recent >= MAX_FAILS) patch.locked_until = new Date(Date.now() + LOCK_MIN * 60000).toISOString();
    await DB.update(`app_users?id=eq.${u.id}`, patch);
    /* already logged above — return the same generic answer without logging twice */
    return { ok: false, status: 401, error: wrong };
  }
  return { ok: true };
}
/* SHARED-AUTH:lock END */

/* SHARED-AUTH:session BEGIN — copied VERBATIM from worker/src/auth.mjs (Spec Kit 018); nicks_code/diagnostics/
   verify-wimpy-service-drift.mjs fails if this block differs from the Worker's by one character. Change both together. */
/** Session middleware: returns the user or null. Token from cookie or bearer. */
export async function session(DB, req) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/cbx_session=([^;]+)/);
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = m ? decodeURIComponent(m[1]) : bearer;
  if (!token) return null;
  const th = await sha256hex(token);
  /* cb and team are selected because the Agent Analytics portal derives its
     ENTIRE authorisation scope from them (worker/src/portal.mjs). They must come
     from the session row, never from anything the caller sends. */
  /* must_change_password TRAVELS ON EVERY REQUEST, not just the login response (audit round
     4, 2026-08-28). auth-gate reads it from /api/me on every page load to decide whether to
     show the "set a new password" overlay; it was absent from this select, so the flag read
     undefined and a simple RELOAD walked straight past the overlay — leaving the account on
     its temporary password for good. That matters most for exactly the accounts being handed
     out with a shared starter password. */
  /* scope (migration-037): 'full' for every main login; 'wimpy' for the Wimpy sign-in (CB number +
     password since Spec Kit 009), which index.mjs refuses everywhere outside /api/wimpy/*. It travels
     on the user object so the check is one line at the gate, never a second lookup. */
  const rows = await DB.select(`app_sessions?token_hash=eq.${th}&select=expires_at,user_id,scope,app_users(username,full_name,role,apps,tabs,pii_unmask,active,cb,team,hub_ids,must_change_password,theme)`);
  const s = rows && rows[0];
  if (!s || new Date(s.expires_at) < new Date() || !s.app_users?.active) return null;
  return { ...s.app_users, user_id: s.user_id, token_hash: th, scope: s.scope || 'full' };
}
/* SHARED-AUTH:session END */

/**
 * THE WIMPY SIGN-IN — a CB number AND the person's password (Spec Kit 009, 2026-10-06; Nick: "for the
 * wimpy app users must put this password as well, for example dalwin cb number and his password to
 * login"). From 10 Sep it took a CB number alone, so knowing a colleague's CB bought lunch in their
 * name. The password is the account's own — the one Agent Analytics and VAS check — proved by the
 * same checkPassword() as login(), so a wrong guess here counts toward the same lock as one there.
 * The session it mints is unchanged: app_sessions.scope = 'wimpy' — the ONLY scope this service accepts, and one the
 * suite's Worker refuses on every route since Spec Kit 018, so knowing the password still opens only lunch from this page.
 *
 *   · the field takes a CB number in any spelling, or a username (managers, or anyone), exactly as
 *     login() reads it; `username` is accepted in place of `cb`;
 *   · an old page sends no `password` key at all → told to reload, before anything is looked up;
 *   · a hundred failures from one network in ten minutes → 429 before any lookup — a flood guard,
 *     not the lock (security review 2026-10-06): the floor may share one address and launch day is
 *     full of first-time password typos, so thirty could close lunch for everyone; the per-account
 *     lock is the real guard, and /api/login checks the same password with no network cap at all;
 *   · unknown, disabled and wrong-password get ONE answer, so the page cannot find which CBs exist;
 *   · the right password on an account without the Wimpy app is told so (it proved who it is) and
 *     is not counted as a failure.
 * Pure of transport: {ok, status, error} or {ok, token, user}.
 */
const WIMPY_NET_MAX = 100, WIMPY_NET_MIN = 10, WIMPY_SESSION_HOURS = 12;
export async function signinWimpy(DB, req, body, ctx, env) {
  const defer = (p) => { try { ctx && ctx.waitUntil(p); } catch { /* no ctx */ } return p; };
  const ip = clientIp(req, env) || '';   // net.mjs: the socket's address, or a trusted proxy's x-forwarded-for (spec 018)
  const b = body && typeof body === 'object' ? body : {};
  if (!('password' in b))
    return { ok: false, status: 400, error: 'Wimpy now asks for your password too — reload this page (Ctrl+Shift+R) to sign in.' };
  const raw = String((b.cb ?? b.username) || '').trim();
  const password = b.password == null ? '' : String(b.password);
  if (!raw || !password) return { ok: false, status: 400, error: 'Type your CB number and your password.' };
  if (raw.length > 40 || password.length > 200) return { ok: false, status: 400, error: 'That is too long to be a CB number or password.' };

  /* the per-network limit, before any lookup — counts only Wimpy failures, so a burst of main
     sign-in typos on the same office network does not close lunch */
  if (ip) try {
    const since = new Date(Date.now() - WIMPY_NET_MIN * 60000).toISOString();
    const recent = await DB.select(`auth_log?ip=eq.${encodeURIComponent(ip)}&event=like.${encodeURIComponent('login_fail:wimpy:*')}&at=gte.${since}&select=at&limit=${WIMPY_NET_MAX + 1}`);
    if ((recent || []).length >= WIMPY_NET_MAX)
      return { ok: false, status: 429, error: 'Too many wrong sign-ins from this network. Wait ten minutes and try again.' };
  } catch { /* the log unreadable — carry on; the per-account lock below still holds */ }

  const username = loginKey(raw);
  const u = await findAccount(DB, username);
  /* Two boxes make a swap likely, and a password typed into the CB box would otherwise land in auth_log as the
     "username" of a no_user failure (code review 2026-10-06). An unknown name that is not CB-shaped is logged
     without its text; an unknown CB number is logged as typed, so support can still see the typo. */
  const logged = u || /^cb[0-9]+$/.test(username) ? username : '(unknown — not a CB number)';
  const checked = await checkPassword(DB, await wimpyAccount(u), logged, password, ip, defer, 'wimpy');
  if (!checked.ok) return checked;
  if (!(Array.isArray(u.apps) && u.apps.includes('wimpy'))) {
    defer(log(DB, u.id, username, 'wimpy_signin_refused:no_app', ip));
    return { ok: false, status: 403, error: 'Your account cannot order from Wimpy yet — ask your team leader.' };
  }
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await DB.insert('app_sessions', [{
    token_hash: await sha256hex(token), user_id: u.id, scope: 'wimpy',
    expires_at: new Date(Date.now() + WIMPY_SESSION_HOURS * 3600000).toISOString(),
    ip, user_agent: (req.headers.get('user-agent') || '').slice(0, 200),
  }]);
  /* the password was proved, so earlier failures are settled — as a main sign-in settles them
     (last_login is left alone: it means "last opened Analytics" to the admin screens) */
  defer(DB.update(`app_users?id=eq.${u.id}`, { failed_attempts: 0, locked_until: null }).catch(() => {}));
  defer(log(DB, u.id, username, 'login_ok:wimpy', ip));
  /* wimpy_password_is_default: the page nudges a person still on wimpy123 to choose their own (Spec Kit 025) */
  return { ok: true, token, user: { username: u.username, full_name: u.full_name || '', role: u.role, cb: u.cb || '', scope: 'wimpy', wimpy_password_is_default: !u.wimpy_password_hash } };
}

/* THE WIMPY-ONLY PASSWORD (Spec Kit 025, 2026-10-09; Nick: "users must have access to change their password for this, so
   their agent os password will now be different from wimpy" and then "make their default password for wimpy, wimpy123 and
   they can change it to what they want after that"). Every account starts on the one START PASSWORD below — the AgentOS
   password never opens lunch — and app_users.wimpy_password_hash (migration-060) holds the person's own once they set one
   on the page; NULL means "still on the start password". The account object handed to the SHARED checkPassword carries
   the effective hash — the lock, the counters and the audit log stay the account's own, and the shared block stays
   byte-identical to the Worker's (drift guard). A team leader's reset to the AgentOS start password clears the Wimpy hash
   too (trigger in migration-060), so a forgotten Wimpy password goes back to wimpy123 through the same door as today.
   The start password is a floor-wide convention like agentos123, not a secret — it is here, in the open, on purpose. */
export const WIMPY_DEFAULT_PASSWORD = 'wimpy123';
let defaultHashP = null;   // hashed once per process (PBKDF2 is deliberately slow)
const defaultHash = () => defaultHashP || (defaultHashP = hashPassword(WIMPY_DEFAULT_PASSWORD));
export async function wimpyAccount(u) {
  if (!u) return u;
  return { ...u, password_hash: u.wimpy_password_hash || await defaultHash() };
}
const WIMPY_PW_MIN = 10;
/** POST /api/wimpy/password {current, new} for the SESSION's account. Answers {status, body}. */
export async function changeWimpyPassword(DB, user, body, req, ctx, env) {
  const defer = (p) => { try { ctx && ctx.waitUntil(p); } catch { /* no ctx */ } return p; };
  const ip = clientIp(req, env) || '';
  const b = body && typeof body === 'object' ? body : {};
  const current = b.current == null ? '' : String(b.current), next = b.new == null ? '' : String(b.new);
  if (!current || !next) return { status: 400, body: { error: 'Type your current password and the new one.' } };
  if (next === WIMPY_DEFAULT_PASSWORD) return { status: 400, body: { error: 'Choose something other than the start password.' } };
  if (next.length < WIMPY_PW_MIN) return { status: 400, body: { error: 'The new password must be at least ' + WIMPY_PW_MIN + ' characters.' } };
  if (next.length > 200 || current.length > 200) return { status: 400, body: { error: 'That is too long to be a password.' } };
  if (next === current) return { status: 400, body: { error: 'The new password must be different from the current one.' } };
  const rows = await DB.select(`app_users?id=eq.${encodeURIComponent(user.user_id)}&limit=1`);
  const u = (rows && rows[0]) || null;
  /* the current password is proved through the shared check: a wrong one is a Wimpy sign-in failure, counted toward the
     account's lock exactly like a wrong password on the sign-in screen */
  const checked = await checkPassword(DB, await wimpyAccount(u), user.username, current, ip, defer, 'wimpy');
  if (!checked.ok) return { status: checked.status, body: { error: checked.status === 401 ? 'That is not your current Wimpy password.' : checked.error } };
  await DB.update(`app_users?id=eq.${u.id}`, { wimpy_password_hash: await hashPassword(next), failed_attempts: 0, locked_until: null });
  /* every OTHER Wimpy session of this account ends — a stolen token dies with the old password; this one stays */
  await DB.del(`app_sessions?user_id=eq.${u.id}&scope=eq.wimpy&token_hash=neq.${user.token_hash}`);
  defer(log(DB, u.id, user.username, 'wimpy_password_change', ip));
  return { status: 200, body: { ok: true } };
}

export async function logout(DB, user) {
  if (user?.token_hash) await DB.del(`app_sessions?token_hash=eq.${user.token_hash}`);
  await log(DB, user?.user_id, user?.username, 'logout', '');
}
