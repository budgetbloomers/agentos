// Reset a person's two-step sign-in so they can enrol again (lost phone + lost recovery codes).
// Admin-run from the laptop. Credentials come from agentos/supabase.env (gitignored) — never the
// command line. This clears the TOTP secret/enabled flag/recovery codes for ONE account; their
// next sign-in starts enrolment fresh. It does not touch the password.
//   node tools/reset-2fa.mjs <username-or-CB>
import fs from 'node:fs';
import path from 'node:path';
import pg from '../nicks_code/diagnostics/node_modules/pg/lib/index.js';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2];
}
if (!env.SUPABASE_DB_URL) { console.error('SUPABASE_DB_URL missing from supabase.env'); process.exit(1); }

const who = process.argv[2];
if (!who) { console.error('usage: node tools/reset-2fa.mjs <username-or-CB>'); process.exit(1); }

const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 });
await client.connect();
try {
  const { rows } = await client.query(
    `update app_users
        set totp_secret = null, totp_enabled = false, totp_recovery = '[]'::jsonb,
            failed_attempts = 0, locked_until = null
      where username = $1 or upper(cb) = upper($1)
      returning username, role, cb`,
    [who]);
  if (!rows.length) console.error('No account matched "' + who + '".');
  else rows.forEach((r) => console.log('2FA reset for ' + r.username + ' (role ' + r.role + ', cb ' + (r.cb || '-') + ') — next sign-in re-enrols, and the account is unlocked.'));
} finally {
  await client.end();
}
