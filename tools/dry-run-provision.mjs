#!/usr/bin/env node
/**
 * dry-run-provision.mjs — what the next Agent List sync WOULD do, against live data.
 *
 *   node tools/dry-run-provision.mjs
 *
 * Calls the real sync_agent_list() in PLAN mode: it stages the current list,
 * compares it to app_users, prints the answer, and removes its own staging rows
 * before returning. Nothing is created, updated or deleted. Run it before a list
 * upload you are unsure about, and any time a sync REFUSES — this is where the
 * reason becomes a list of names.
 *
 * The plan is computed by exactly the code that would apply it, so this cannot
 * drift from the real thing the way a separate simulation would.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pg = (await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'pg', 'lib', 'index.js')).href)).default;

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2];
}
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await c.connect();

const rec = (await c.query('select value from rules where key = $1', ['kv:roster-current'])).rows[0];
const v = rec && rec.value;
if (!v || !(v.roster || []).length) { console.error('no roster of record — nothing to compare against'); process.exit(1); }
console.log(`Agent List of record: ${v.roster.length} agents, as of ${v.as_of || '(unknown)'}, fingerprint ${v.fingerprint}`);

const roles = (await c.query(`select role, count(*)::int n from app_users group by role order by n desc`)).rows;
console.log('app_users: ' + roles.map((r) => r.n + ' ' + r.role).join(' · '));

const out = (await c.query(
  `select sync_agent_list($1::date, $2::jsonb, $3, $4, $5, '{}'::jsonb, false) as out`,
  [v.as_of || null, JSON.stringify(v.roster), 'dry-run', v.fingerprint, 'dry-run-provision'])).rows[0].out;

console.log('\nstatus: ' + out.status + (out.reason ? '  (' + out.reason + ')' : ''));
if (out.detail) console.log(out.detail);

const show = (label, arr, fmt) => {
  if (!arr || !arr.length) return;
  console.log('\n' + label + ' (' + arr.length + '):');
  for (const x of arr.slice(0, 40)) console.log('  ' + fmt(x));
  if (arr.length > 40) console.log('  … and ' + (arr.length - 40) + ' more');
};
show('WOULD CREATE — new on the list, password agentos123', out.create, (x) => '+ ' + String(x.cb).padEnd(8) + x.name);
show('WOULD REMOVE — no longer on the list', out.remove, (x) => '- ' + String(x.cb).padEnd(8) + x.name);
show('WOULD UPDATE', out.update, (x) => '~ ' + String(x.cb).padEnd(8) + String(x.name).padEnd(26)
  + (x.was_team !== x.team ? 'team ' + (x.was_team || '(none)') + ' → ' + x.team : 'name ' + x.was_name + ' → ' + x.name));

const L = out.leaders || {};
show('TEAM LEADERS ON THE LIST WITH NO ACCOUNT — a human must create these',
  L.unrepresented, (x) => '! ' + x + '  (no CB number on the list, so no login can be made from it)');
show('TEAM LEADER ACCOUNTS LEADING NOBODY on the current list',
  L.orphaned, (x) => '! ' + String(x.username).padEnd(10) + String(x.name).padEnd(24) + 'team: ' + (x.team || '(none)'));
show('TEAM LEADER LINKS THAT WOULD BE REPAIRED', L.repaired, (x) => '~ ' + x.username + ': ' + (x.was || '(none)') + ' → ' + x.now);

if (out.errors) console.log('\nERRORS:\n  ' + JSON.stringify(out.errors, null, 2).split('\n').join('\n  '));

const staged = (await c.query('select count(*)::int n from agent_list_import')).rows[0].n;
console.log('\n(plan only — ' + staged + ' rows left in staging, and no account was touched)');
await c.end();
