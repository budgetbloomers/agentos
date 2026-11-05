#!/usr/bin/env node
/**
 * check-2fa-code.mjs — why is this person's authenticator code refused? Read-only; never prints the secret.
 *
 *   node tools/check-2fa-code.mjs <username-or-CB> <6-digit-code-their-app-shows-now>
 *
 * Rejected codes are not stored, so the sign-in log cannot tell these apart. Given the code on their screen:
 *   MATCH NOW          the app entry is right; the code should be accepted (typing, or it expired before they pressed)
 *   CLOCK OFF by N s   the entry is right but the phone's time is wrong: every code will fail until it is set to automatic
 *   NO MATCH           the app entry is from an older QR (or another account): delete it and scan the current QR
 * The server accepts ±30 s (twofa.mjs SKEW 1). This searches ±30 minutes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pg = (await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'pg', 'lib', 'index.js')).href)).default;
const [who, codeArg] = process.argv.slice(2);
const code = String(codeArg || '').replace(/\D/g, '');
if (!who || code.length !== 6) { console.error('usage: node tools/check-2fa-code.mjs <username-or-CB> <6-digit-code>'); process.exit(2); }

const STEP = 30, SEARCH_STEPS = 60;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32dec(s) {
  let bits = 0, val = 0; const out = [];
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = (val << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(key, counter) {
  const msg = Buffer.alloc(8); let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(bin % 1000000).padStart(6, '0');
}

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2];
}
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 });
await c.connect();
const u = (await c.query('select username, totp_secret, totp_enabled, totp_pending_at from app_users where username = $1 or upper(cb) = upper($1) limit 1', [who])).rows[0];
await c.end();
if (!u) { console.error('no such account'); process.exit(1); }
if (!u.totp_secret) { console.log(u.username + ': no secret on file — they have not started setup (or were reset).'); process.exit(0); }

const key = b32dec(u.totp_secret), now = Math.floor(Date.now() / 1000 / STEP);
const hits = [];
for (let w = -SEARCH_STEPS; w <= SEARCH_STEPS; w++) if (totpAt(key, now + w) === code) hits.push(w);
const stage = u.totp_enabled ? 'setup finished' : 'setup NOT finished';
const pending = (!u.totp_enabled && u.totp_pending_at) ? ' · this QR was made ' + Math.round((Date.now() - new Date(u.totp_pending_at)) / 60000) + ' min ago and is replaced at 30' : '';
console.log(u.username + ' (' + stage + pending + ')');
if (!hits.length) console.log('NO MATCH — this code did not come from their current secret, at any time within ±30 min. The app entry is from an older QR or another account: delete it and scan the current QR.');
else {
  const best = hits.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  if (Math.abs(best) <= 1) console.log('MATCH NOW — the app entry and the phone clock are right; this code should be accepted if typed before it changes.');
  else console.log('CLOCK OFF — the entry is right but the phone is about ' + Math.abs(best * STEP) + ' s ' + (best > 0 ? 'FAST' : 'SLOW') + '. Set date & time to automatic; every code fails until then.');
}
