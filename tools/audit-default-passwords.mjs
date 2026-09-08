#!/usr/bin/env node
/**
 * audit-default-passwords.mjs — who is still on the start password, and mark them.
 *
 *   node tools/audit-default-passwords.mjs            report only
 *   node tools/audit-default-passwords.mjs --apply    write password_is_default / must_change_password
 *
 * WHY (Nick, 2026-09-08: "when they create their new password agentos123 must be removed").
 * migration-025 gave app_users a password_is_default flag and the triggers that keep it true
 * from then on — but the database cannot tell, from a salted PBKDF2 hash, whether an EXISTING
 * row is on the start password. This tool can: it verifies every hash against the start
 * password with the Worker's own verifyPassword() and writes the answer. A row on the default
 * is also set must_change_password = true, so the next sign-in (agent page or auth-gate) forces
 * a personal password. Nothing here changes a password.
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { verifyPassword, START_PASSWORD } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'auth.mjs')).href);
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const APPLY = process.argv.includes('--apply');

const users = await (await fetch(REST + 'app_users?select=id,username,full_name,role,active,password_hash,password_is_default,must_change_password,last_login&order=role,username', { headers: H })).json();
if (!Array.isArray(users)) { console.error('could not read app_users:', JSON.stringify(users).slice(0, 200)); process.exit(2); }

const onDefault = [], personal = [], unreadable = [];
for (const u of users) {
  if (!u.password_hash) { unreadable.push(u); continue; }
  (await verifyPassword(START_PASSWORD, u.password_hash) ? onDefault : personal).push(u);
}
const byRole = (list) => { const c = {}; for (const u of list) c[u.role] = (c[u.role] || 0) + 1; return Object.entries(c).map(([k, v]) => k + ' ' + v).join(', '); };
console.log(`accounts ${users.length} · on the start password ${onDefault.length} (${byRole(onDefault)}) · personal ${personal.length} (${byRole(personal)})${unreadable.length ? ' · no hash ' + unreadable.length : ''}`);
const mgmt = onDefault.filter((u) => u.role !== 'agent');
if (mgmt.length) { console.log('\nMANAGEMENT ACCOUNTS ON THE START PASSWORD — forced to change at next sign-in:'); for (const u of mgmt) console.log('  ' + u.username.padEnd(12) + (u.full_name || '').padEnd(24) + u.role.padEnd(18) + (u.active ? '' : 'INACTIVE ') + (u.last_login ? 'last sign-in ' + u.last_login.slice(0, 10) : 'never signed in')); }
const wrong = onDefault.filter((u) => u.password_is_default === false).length + personal.filter((u) => u.password_is_default === true).length;
console.log(`\nflags to correct: ${wrong} (defaults not marked ${onDefault.filter((u) => !u.password_is_default).length}, personal marked default ${personal.filter((u) => u.password_is_default).length}, defaults not yet forced ${onDefault.filter((u) => !u.must_change_password).length})`);

if (!APPLY) { console.log('\nreport only — add --apply to write the flags'); process.exit(0); }
const ids = (list) => list.map((u) => u.id).join(',');
let n1 = 0, n2 = 0;
if (onDefault.length) { const r = await fetch(REST + `app_users?id=in.(${ids(onDefault)})`, { method: 'PATCH', headers: { ...H, Prefer: 'return=headers-only' }, body: JSON.stringify({ password_is_default: true, must_change_password: true }) }); n1 = r.ok ? onDefault.length : -1; if (!r.ok) console.error('defaults PATCH failed', r.status, await r.text()); }
if (personal.length) { const r = await fetch(REST + `app_users?id=in.(${ids(personal)})`, { method: 'PATCH', headers: { ...H, Prefer: 'return=headers-only' }, body: JSON.stringify({ password_is_default: false }) }); n2 = r.ok ? personal.length : -1; if (!r.ok) console.error('personal PATCH failed', r.status, await r.text()); }
console.log(`\napplied: ${n1} marked on the start password and forced to change · ${n2} marked personal`);
const view = await (await fetch(REST + 'accounts_on_default_password?select=username,role,active&limit=1000', { headers: H })).json();
console.log(`accounts_on_default_password now lists ${Array.isArray(view) ? view.length : '?'} account(s)`);
process.exit(n1 < 0 || n2 < 0 ? 1 : 0);
