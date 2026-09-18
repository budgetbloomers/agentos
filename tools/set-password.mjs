#!/usr/bin/env node
/* SET A PASSWORD FOR NAMED ACCOUNTS (2026-09-18).
   Nick asks for a password by name ("change nicholas, aarav and barry to …"); this is the one
   tool that does it the way the app does: the Worker's own hashPassword() (pbkdf2h scheme,
   100k iterations) and the database's set_password() (migration-025), which flags the account
   off the default and drops every other session for it — so the new password is the only one
   that signs in from the next attempt.

     node tools/set-password.mjs --users nicholas,aarav,barry --password 'new-secret'
     node tools/set-password.mjs --users nicholas --password-env NEW_PASSWORD

   Reads supabase.env (SUPABASE_URL, SUPABASE_SECRET_KEY). Prints one line per account and
   verifies each new hash against the password before writing it. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const { hashPassword, verifyPassword } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'auth.mjs')).href);

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const users = String(arg('--users') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const password = arg('--password') ?? (arg('--password-env') ? process.env[arg('--password-env')] : null);
if (!users.length || !password) {
  console.error('usage: node tools/set-password.mjs --users a,b,c (--password X | --password-env VAR)');
  process.exit(2);
}
if (password.length < 8) { console.error('refusing: password shorter than 8 characters'); process.exit(2); }

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)
  .filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const REST = env.SUPABASE_URL + '/rest/v1/';
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };

const rows = await (await fetch(REST + 'app_users?select=id,username,role,active&username=in.(' + users.map((u) => '"' + u + '"').join(',') + ')', { headers: H })).json();
if (!Array.isArray(rows)) { console.error('app_users read failed:', JSON.stringify(rows)); process.exit(1); }
const byName = Object.fromEntries(rows.map((r) => [r.username.toLowerCase(), r]));

let failed = 0;
for (const u of users) {
  const row = byName[u];
  if (!row) { console.log('  MISSING  ' + u + ' — no such account'); failed++; continue; }
  if (!row.active) { console.log('  INACTIVE ' + u + ' — set_password refuses inactive accounts'); failed++; continue; }
  const hash = await hashPassword(password);
  if (!(await verifyPassword(password, hash))) { console.log('  FAIL     ' + u + ' — hash does not verify'); failed++; continue; }
  const r = await fetch(REST + 'rpc/set_password', { method: 'POST', headers: H, body: JSON.stringify({ p_user_id: row.id, p_new_hash: hash, p_keep_token: null, p_ip: 'tools/set-password' }) });
  const body = await r.text();
  if (!r.ok) { console.log('  FAIL     ' + u + ' — HTTP ' + r.status + ' ' + body.slice(0, 200)); failed++; continue; }
  let dropped = '?'; try { dropped = JSON.parse(body).sessions_dropped ?? '?'; } catch (e) { /* the function returns jsonb; anything else is still a success */ }
  console.log('  set      ' + u.padEnd(12) + row.role.padEnd(18) + ' other sessions dropped: ' + dropped);
}
process.exit(failed ? 1 : 0);
