/**
 * App auth — PBKDF2 password hashing (WebCrypto), hashed session tokens,
 * lockout, per-app/per-tab permissions. Backed by app_users / app_sessions /
 * auth_log (migration 003). Passwords never touch disk or logs in plaintext.
 */
const ITER = 100000; // Cloudflare Workers caps PBKDF2 at 100k iterations
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MIN = 15;

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

/** POST /api/login {username,password} → sets cookie, returns profile+permissions. */
export async function login(DB, req, body) {
  const ip = req.headers.get('cf-connecting-ip') || '';
  const username = String(body.username || '').trim().toLowerCase();
  const rows = await DB.select(`app_users?username=eq.${encodeURIComponent(username)}&limit=1`);
  const u = rows && rows[0];
  const fail = async (why) => { await log(DB, u?.id, username, 'login_fail:' + why, ip); return { ok: false, status: 401, error: 'Invalid username or password.' }; };

  if (!u || !u.active) return fail(u ? 'disabled' : 'no_user');
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    await log(DB, u.id, username, 'locked', ip);
    return { ok: false, status: 423, error: 'Account locked after repeated failures. Try again in a few minutes.' };
  }
  if (!(await verifyPassword(String(body.password || ''), u.password_hash))) {
    const fails = (u.failed_attempts || 0) + 1;
    const patch = { failed_attempts: fails };
    if (fails >= MAX_FAILS) patch.locked_until = new Date(Date.now() + LOCK_MIN * 60000).toISOString();
    await DB.update(`app_users?id=eq.${u.id}`, patch);
    return fail('bad_password');
  }

  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await DB.insert('app_sessions', [{
    token_hash: await sha256hex(token),
    user_id: u.id,
    expires_at: new Date(Date.now() + SESSION_HOURS * 3600000).toISOString(),
    ip, user_agent: (req.headers.get('user-agent') || '').slice(0, 200),
  }]);
  await DB.update(`app_users?id=eq.${u.id}`, { failed_attempts: 0, locked_until: null, last_login: new Date().toISOString() });
  await log(DB, u.id, username, 'login_ok', ip);
  return {
    ok: true, token,
    user: { username: u.username, full_name: u.full_name, role: u.role, apps: u.apps, tabs: u.tabs, pii_unmask: u.pii_unmask, must_change_password: u.must_change_password },
  };
}

/** Session middleware: returns the user or null. Token from cookie or bearer. */
export async function session(DB, req) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/cbx_session=([^;]+)/);
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = m ? decodeURIComponent(m[1]) : bearer;
  if (!token) return null;
  const th = await sha256hex(token);
  const rows = await DB.select(`app_sessions?token_hash=eq.${th}&select=expires_at,user_id,app_users(username,full_name,role,apps,tabs,pii_unmask,active)`);
  const s = rows && rows[0];
  if (!s || new Date(s.expires_at) < new Date() || !s.app_users?.active) return null;
  return { ...s.app_users, user_id: s.user_id, token_hash: th };
}

export async function logout(DB, user) {
  if (user?.token_hash) await DB.del(`app_sessions?token_hash=eq.${user.token_hash}`);
  await log(DB, user?.user_id, user?.username, 'logout', '');
}

