/**
 * App auth — PBKDF2 password hashing (WebCrypto), hashed session tokens,
 * lockout, per-app/per-tab permissions. Backed by app_users / app_sessions /
 * auth_log (migration 003). Passwords never touch disk or logs in plaintext.
 */
/* THE START PASSWORD (Nick, 2026-09-08: "agentos123 must be removed"). Every provisioned account
   is born on it with password_is_default = true (migration-025), which forces a change at first
   sign-in; nobody may choose it as a new password; tools/audit-default-passwords.mjs finds every
   account still on it. One definition — provision.mjs imports it from here. */
export const START_PASSWORD = 'agentos123';
const SESSION_HOURS = 12;

/* SHARED-AUTH:hashing BEGIN — copied VERBATIM into wimpy-service/src/auth.mjs (Spec Kit 018, 2026-10-09): the Wimpy
   lunch app is its own service now and signs people in with the same password through the same rules. Four blocks are
   shared (hashing, lookup, lock, session); nicks_code/diagnostics/verify-wimpy-service-drift.mjs fails if a block differs
   by one character between the two files. Change a block HERE and THERE in the same commit. */
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

/* SHARED-AUTH:lookup BEGIN (Spec Kit 018 — see the hashing block) */
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

/* SHARED-AUTH:lock BEGIN (Spec Kit 018 — see the hashing block). WIMPY_NO_MATCH lives in this block because
   checkPassword's `via === 'wimpy'` branch belongs to the Wimpy service's sign-in; the Worker itself has not passed
   'wimpy' since Spec Kit 018 moved that sign-in out. */
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

/** POST /api/login {username,password} → sets cookie, returns profile+permissions.
 *
 * SIGNING IN USED TO COST FOUR SEQUENTIAL SUPABASE ROUND TRIPS — select the user,
 * insert the session, reset the counters, write the audit log — each awaited in
 * turn. Measured from the Worker, one round trip is ~500ms, so a login that had
 * already found the user still sat there for two seconds before the app could
 * even start loading. Only ONE of the four has to finish before we can answer:
 * the session insert, because the token we hand back must already be valid.
 * The counter reset and the audit write are fire-and-forget — `defer` hands them
 * to ctx.waitUntil so the Worker still finishes them after the response is sent.
 * Failure paths keep awaiting the counter update, because lockout must not race.
 */
export async function login(DB, req, body, ctx) {
  const defer = (p) => { try { ctx && ctx.waitUntil(p); } catch { /* no ctx: let it run detached */ } return p; };
  const ip = req.headers.get('cf-connecting-ip') || '';
  const username = loginKey(body.username);
  const u = await findAccount(DB, username);
  const checked = await checkPassword(DB, u, username, body.password, ip, defer, '');
  if (!checked.ok) return checked;

  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await DB.insert('app_sessions', [{
    token_hash: await sha256hex(token),
    user_id: u.id,
    expires_at: new Date(Date.now() + SESSION_HOURS * 3600000).toISOString(),
    ip, user_agent: (req.headers.get('user-agent') || '').slice(0, 200),
  }]);
  // Neither of these gates the response: the token above is already valid.
  defer(DB.update(`app_users?id=eq.${u.id}`, { failed_attempts: 0, locked_until: null, last_login: new Date().toISOString() }).catch(() => {}));
  defer(log(DB, u.id, username, 'login_ok', ip));
  /* user_id is for the Worker's own records (the usage report's app open, Spec Kit 028) — the route never puts it in
     the answer the page receives */
  return {
    ok: true, token, user_id: u.id,
    user: { username: u.username, full_name: u.full_name, role: u.role, apps: u.apps, tabs: u.tabs,
      pii_unmask: u.pii_unmask, must_change_password: u.must_change_password, cb: u.cb || '', team: u.team || '' },
  };
}

/* SHARED-AUTH:session BEGIN (Spec Kit 018 — see the hashing block) */
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

/* THE WIMPY SIGN-IN LEFT THIS WORKER (Spec Kit 018, 2026-10-09). signinWimpy — a CB number and the person's own
   password, a session scoped to lunch — now lives in wimpy-service/src/auth.mjs, built on the SAME four SHARED-AUTH blocks
   above (checkPassword, the lock, the session read), which verify-wimpy-service-drift.mjs keeps identical. The Worker
   refuses a wimpy-scoped session on every route (index.mjs); migration-058 ended the ones minted before the move. */

export async function logout(DB, user) {
  if (user?.token_hash) await DB.del(`app_sessions?token_hash=eq.${user.token_hash}`);
  await log(DB, user?.user_id, user?.username, 'logout', '');
}


/**
 * CHANGE YOUR OWN PASSWORD (Nick, 2026-09-08: "the option to change their password, for the
 * campaign manager, for the team leader and for the agent"). Rules, in order:
 *   · at least 10 characters (the same floor the login screen states);
 *   · unless the account is on a FORCED first-sign-in change, the CURRENT password must be
 *     given and must verify — a colleague at an unlocked desk cannot lock someone out of
 *     their own account;
 *   · the new password may not equal the current one;
 *   · on success every OTHER session of that account is signed out (a stolen token dies
 *     with the old password) and auth_log records password_change.
 * Pure of transport: the route hands in the parsed body and gets back {status, body}.
 */
export async function changePassword(DB, user, body, req, ctx) {
  const b = body || {};
  const next = String(b.new_password || '');
  if (next.length < 10) return { status: 400, body: { error: 'Password must be at least 10 characters.' } };
  if (next === START_PASSWORD) return { status: 400, body: { error: 'That is the start password everyone was given. Choose one only you know.' } };
  const rows = await DB.select(`app_users?id=eq.${user.user_id}&select=password_hash,must_change_password`);
  const row = rows && rows[0];
  if (!row) return { status: 404, body: { error: 'Account not found.' } };
  const forced = !!row.must_change_password;
  const cur = String(b.current_password || '');
  if (!forced && !cur) return { status: 400, body: { error: 'Enter your current password.' } };
  /* a current password that IS given is verified even on a forced change — a screen that asks for it never lets a wrong one through */
  if (cur && !(await verifyPassword(cur, row.password_hash))) return { status: 403, body: { error: 'Your current password is not right.' } };
  if (await verifyPassword(next, row.password_hash)) return { status: 400, body: { error: 'Choose a password you are not already using.' } };
  /* ONE TRANSACTION IN THE DATABASE (migration-025 set_password): the hash, password_is_default
     → false, must_change_password → false, lockout reset, every OTHER session dropped, auth_log
     row. The Worker's job is the PBKDF2 work Postgres cannot do; the state change is the table's. */
  const out = await DB.rpc('set_password', { p_user_id: user.user_id, p_new_hash: await hashPassword(next),
    p_keep_token: user.token_hash || null, p_ip: (req && req.headers && req.headers.get('cf-connecting-ip')) || '' });
  return { status: 200, body: { ok: true, signed_out_elsewhere: true, sessions_dropped: out && out.sessions_dropped } };
}
