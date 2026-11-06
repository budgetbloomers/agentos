/**
 * Two-step sign-in (TOTP / authenticator app) + Cloudflare Turnstile, for the MAIN
 * AgentOS management sign-in only. Agent Analytics, the Coaching Hub and the KPI hub
 * are untouched: see TWOFA_ROLES below — it is the one place that decides who is in scope.
 *
 * Pure WebCrypto (HMAC-SHA-1 per RFC 6238); no dependency. Backed by app_users.totp_*
 * and app_login_challenges (migration-065). Secrets and recovery codes never appear in
 * a response except the one enrolment moment the user must see them.
 */

// WHO MUST USE THE SECOND STEP. The AgentOS management suite staff roles (admin/exec/tl/qa/viewer)
// AND the Agent Analytics team-leader and campaign-manager views (team_leader, campaign_manager).
// Only the plain agent role stays on single sign-in. Change scope HERE only.
export const TWOFA_ROLES = new Set(["admin", "exec", "tl", "qa", "viewer", "team_leader", "campaign_manager"]);
export const requires2FA = (user) => !!user && TWOFA_ROLES.has(user.role);

// WHO MUST PASS THE HUMAN CHECK (Turnstile). The management-suite staff roles only — they all sign in through
// site/auth-gate.js, which carries the widget. Agent Analytics (agents, team leaders, CMs) has its own sign-in page
// with no widget, so its roles are never asked for a token (TLs/CMs still have the second step above).
export const TURNSTILE_ROLES = new Set(["admin", "exec", "tl", "qa", "viewer"]);
export const needsTurnstile = (user) => !!user && TURNSTILE_ROLES.has(user.role);

/* ROLLOUT SWITCH. Worker env TWOFA_ENFORCE decides WHO the role-scoped 2-step is actually
   enforced for, so it can be turned on for one account first and then everyone:
     unset / ''      → nobody yet (ships dark, like Turnstile)
     'all'           → every in-scope staff role
     'nick,cb145'    → only these usernames / CB numbers (and only if they are an in-scope role)
   A person is never in scope unless requires2FA() is already true for their role. */
export function enforce2FAFor(user, enforceEnv) {
  if (!requires2FA(user)) return false;
  const cfg = String(enforceEnv == null ? "" : enforceEnv).trim();
  if (cfg === "") return false;
  if (cfg.toLowerCase() === "all") return true;
  const list = new Set(cfg.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const uname = String(user.username || "").toLowerCase();
  const cb = String(user.cb || "").toLowerCase();
  return list.has(uname) || (!!cb && list.has(cb));
}

const CHALLENGE_MIN = 5;          // a pending 2-step challenge is valid 5 minutes, spent by its first correct code
export const CHALLENGE_TRIES = 5;     // …and takes this many code attempts at most
export const PENDING_SECRET_MIN = 30; // an unfinished setup keeps its secret this long, from when it was made
const STEP = 30, DIGITS = 6, SKEW = 1; // standard TOTP: 30s step, 6 digits, ±1 step clock skew

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256hex = async (s) => toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

// ---- base32 (RFC 4648, no padding) — what authenticator apps expect ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(bytes) {
  let bits = 0, val = 0, out = "";
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  let bits = 0, val = 0; const out = [];
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    val = (val << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

export function newSecret() { return b32encode(crypto.getRandomValues(new Uint8Array(20))); }

export function otpauthURL(secret, username, issuer = "AgentOS") {
  const label = encodeURIComponent(issuer + ":" + username);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
}

const totpKey = (secret) => crypto.subtle.importKey("raw", b32decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
async function totpAt(key, counter) {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Verify a 6-digit TOTP against the secret, tolerating ±SKEW steps. now = ms (testable). */
export async function verifyTotp(secret, code, now = Date.now()) {
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length !== DIGITS || !secret) return false;
  const counter = Math.floor(now / 1000 / STEP), key = await totpKey(secret);
  for (let w = -SKEW; w <= SKEW; w++) {
    if (clean === (await totpAt(key, counter + w))) return true;
  }
  return false;
}

export const TOTP_STEP_MS = STEP * 1000;
const FIND_STEPS = 60;   // ±30 minutes

/** How far out is the clock that made this code? Steps from now, nearest first, or null if it matches nowhere near.
    Used to accept a phone with the wrong time during setup and to say so afterwards — never to accept a code at sign-in. */
export async function findTotpOffset(secret, code, now = Date.now()) {
  const clean = String(code || "").replace(/\D/g, "");
  if (clean.length !== DIGITS || !secret) return null;
  const counter = Math.floor(now / 1000 / STEP), key = await totpKey(secret);   // one key: this runs up to 121 HMACs
  for (let w = 0; w <= FIND_STEPS; w++) {
    if (clean === (await totpAt(key, counter + w))) return w;
    if (w && clean === (await totpAt(key, counter - w))) return -w;
  }
  return null;
}

/** Ten one-time recovery codes. Returns {plain:[...] shown once, hashes:[...] stored}. */
export async function newRecoveryCodes(n = 10) {
  const plain = [], hashes = [];
  for (let i = 0; i < n; i++) {
    const raw = toHex(crypto.getRandomValues(new Uint8Array(5))); // 10 hex chars
    const code = raw.slice(0, 5) + "-" + raw.slice(5);
    plain.push(code); hashes.push(await sha256hex(code));
  }
  return { plain, hashes };
}
export const hashRecovery = (code) => sha256hex(String(code || "").trim().toLowerCase());

// ---- pending login challenges (single use, short lived) ----
export async function startChallenge(DB, user_id, kind) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await DB.insert("app_login_challenges", [{
    challenge_hash: await sha256hex(token), user_id, kind, attempts: 0,
    expires_at: new Date(Date.now() + CHALLENGE_MIN * 60000).toISOString(),
  }]);
  return { challenge: token };
}
/* A WRONG CODE MUST NOT END THE ATTEMPT (Denise, 2026-11-05): the screen stays open after "That code is not right",
   but the challenge used to die with the first try, so the retry only said "expired". A challenge now lives until a
   correct code spends it or its 5 minutes run out. Retrying must not cheapen guessing, so every try first claims an
   attempt by compare-and-set (claimAttempt): parallel requests on one challenge cannot all be checked, whatever the
   lockout has or has not written yet, and one sign-in buys at most CHALLENGE_TRIES guesses. */
/** Look up a live challenge without using it: {user_id, kind, attempts}, or null if unknown or expired. */
export async function readChallenge(DB, token) {
  if (!token) return null;
  const th = await sha256hex(token);
  const rows = await DB.select(`app_login_challenges?challenge_hash=eq.${th}&select=user_id,kind,expires_at,attempts&limit=1`);
  const row = rows && rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await DB.del(`app_login_challenges?challenge_hash=eq.${th}`).catch(() => {});
    return null;
  }
  return { user_id: row.user_id, kind: row.kind, attempts: row.attempts || 0 };
}
/** Take one attempt: true for exactly one caller at each count, false for anyone who lost the race. */
export async function claimAttempt(DB, token, attempts) {
  const th = await sha256hex(token);
  const won = await DB.updateReturning(`app_login_challenges?challenge_hash=eq.${th}&attempts=eq.${attempts}`, { attempts: attempts + 1 });
  return !!(won && won.length);
}
/** Spend a challenge once its code is proven: not caught, so a failed delete can never leave it replayable. */
export async function spendChallenge(DB, token) {
  await DB.del(`app_login_challenges?challenge_hash=eq.${await sha256hex(token)}`);
}

const SITEVERIFY_MS = 8000;   // Cloudflare slower than this answers as verify_error, not a sign-in that hangs
const TOKEN_MAX = 2048;       // Cloudflare's own limit on a Turnstile token; anything longer is not one, so it is not forwarded

/* WHAT THE PERSON IS TOLD (2026-11-06). One sentence used to cover every reason and told them all to reload, which fixes
   only some. Cloudflare's own code goes to auth_log, never to the page. */
export function humanCheckMessage(reason) {
  if (reason === "missing") return "Finish the human check, then press Sign in.";
  if (/timeout-or-duplicate/.test(String(reason || ""))) return "That human check has expired. It has reset, so wait for it to finish and press Sign in again.";
  if (reason === "verify_error") return "The human check could not be confirmed just now. Wait a moment and try again.";
  return "The human check did not pass. Reload the page and try again. If it keeps failing, tell your administrator.";
}

/**
 * Cloudflare Turnstile verification. Rollout switch: with no TURNSTILE_SECRET configured it
 * is skipped (so the feature ships dark and is turned on by setting the secret). Once the
 * secret is set, a missing or invalid token is refused. fetchImpl is injectable for tests.
 */
export async function verifyTurnstile(env, token, ip, fetchImpl) {
  if (!env || !env.TURNSTILE_SECRET) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: "missing" };
  if (String(token).length > TOKEN_MAX) return { ok: false, reason: "token_too_long" };
  const doFetch = fetchImpl || fetch;
  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(token) });
    if (ip) form.set("remoteip", ip);
    const r = await doFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString(),
      signal: AbortSignal.timeout(SITEVERIFY_MS),
    });
    const d = await r.json();
    return { ok: !!d.success, reason: (d["error-codes"] || []).join(",") };
  } catch (e) {
    // fail CLOSED: if we cannot verify the human-check, do not let the sign-in through
    return { ok: false, reason: "verify_error" };
  }
}
