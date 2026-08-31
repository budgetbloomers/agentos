/* TEAM LEADER LOGINS FOLLOW THE AGENT LIST — the caller for sync_team_leaders().
 *
 * Agents have had this since migration-014: on the latest valid list ⇒ an account, off it ⇒
 * none. Leaders were left out for a good reason — the list names a leader but never carries
 * their CB, so an account could not be created without inventing a login. This closes that
 * without inventing anything: specs/team_leader_cbs.json is the map somebody maintained by
 * hand, it seeds the team_leader_cbs table, and the function creates only from a code that
 * is written down there.
 *
 *   node tools/sync-team-leaders.mjs            # seed the map, print the PLAN, write nothing
 *   node tools/sync-team-leaders.mjs --apply    # seed, then create and remove
 *
 * WHY THE HASHING IS HERE. Postgres cannot reproduce the WebCrypto PBKDF2 scheme the login
 * uses, so the function returns NEEDS_HASHES having written nothing, this hashes exactly the
 * CB numbers it named, and calls again — the same round trip worker/src/provision.mjs runs
 * for agents. Never teach pgcrypto a second password scheme.
 *
 * The hash format is pbkdf2h$<iters>$<saltHex>$<hashHex>, byte-identical to auth.mjs's
 * hashPassword, so a leader created here signs in through the same code path as everyone.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from '../nicks_code/diagnostics/node_modules/pg/lib/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const l of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2];
}
const APPLY = process.argv.includes('--apply');
const START_PASSWORD = 'agentos123';
const ITER = 100000;

/* auth.mjs's scheme, reproduced exactly: PBKDF2-SHA256, 16-byte salt, 256-bit output. */
const hashPassword = (password) => {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, ITER, 32, 'sha256');
  return `pbkdf2h$${ITER}$${salt.toString('hex')}$${hash.toString('hex')}`;
};

const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await client.connect();

/* ---- 1 · seed the map from the spec, which is the thing a human maintains ---- */
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', 'team_leader_cbs.json'), 'utf8'));
const names = Object.keys(spec);
for (const name of names) {
  await client.query(
    `insert into team_leader_cbs (leader_name, employee_code, updated_by, updated_at)
     values ($1, $2, 'sync-team-leaders', now())
     on conflict (leader_name) do update set employee_code = excluded.employee_code,
       updated_by = excluded.updated_by, updated_at = now()`,
    [name, String(spec[name] || '').trim() || null]);
}
const withCb = names.filter((n) => String(spec[n] || '').trim());
console.log(`map seeded: ${names.length} leaders, ${withCb.length} with a CB, ${names.length - withCb.length} without\n`);

/* ---- 2 · plan ---- */
const call = async (hashes, apply) => {
  const r = await client.query(
    `select sync_team_leaders($1::jsonb, $2::text, $3::boolean) as out`,
    [JSON.stringify(hashes || {}), 'sync-team-leaders', !!apply]);
  return r.rows[0].out;
};

let out = await call({}, false);
const show = (o) => {
  console.log(`status: ${o.status}${o.detail ? ' — ' + o.detail : ''}`);
  if (o.on_list != null) console.log(`leaders named on the current list: ${o.on_list}`);
  const list = (label, arr) => {
    const a = arr || [];
    if (!a.length) { console.log(`  ${label}: none`); return; }
    console.log(`  ${label}: ${a.length}`);
    for (const x of a) console.log(`     ${x.cb || x.username || x}${x.name ? '  ' + x.name : ''}${x.team ? '  (led: ' + x.team + ')' : ''}`);
  };
  list('create', o.would_create || o.created);
  list('remove', o.would_remove || o.removed);
  list('on the list but no CB on file — reported, never invented', o.unrepresented);
};
show(out);

if (out.status === 'REFUSED') { console.error('\nrefused — nothing was written.'); await client.end(); process.exit(1); }
if (!APPLY) {
  console.log('\nplan only — nothing written. Re-run with --apply.');
  await client.end(); process.exit(0);
}

/* ---- 3 · apply, hashing exactly what the function asked for ---- */
if (out.status === 'NEEDS_HASHES') {
  const hashes = {};
  for (const cb of out.needs_hashes || []) hashes[cb] = hashPassword(START_PASSWORD);
  console.log(`\nhashed ${Object.keys(hashes).length} new login(s) with the standard starting password`);
  out = await call(hashes, true);
} else {
  out = await call({}, true);
}
console.log('');
show(out);
if (out.status !== 'SUCCESS') { console.error('did not apply cleanly'); await client.end(); process.exit(1); }
console.log(`\ndone. New leaders sign in with their CB number and ${START_PASSWORD}.`);
await client.end();
