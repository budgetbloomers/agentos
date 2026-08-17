// Apply a Supabase migration over a direct Postgres connection.
// Credentials come from agentos/supabase.env (gitignored) — never from the command line,
// so they stay out of shell history and process listings.
//   node tools/apply-migration.mjs supabase/migration-010-source-tables.sql
import fs from 'node:fs';
import path from 'node:path';
import pg from '../nicks_code/diagnostics/node_modules/pg/lib/index.js';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname — the repo path contains a space, which arrives %20-encoded
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2];
}
const url = env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL missing from supabase.env'); process.exit(1); }

const file = process.argv[2];
if (!file) { console.error('usage: node tools/apply-migration.mjs <path-to.sql>'); process.exit(1); }
const sql = fs.readFileSync(path.join(ROOT, file), 'utf8');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await client.connect();
console.log('connected to ' + url.replace(/:[^:@]*@/, ':****@'));

/* One transaction: a migration that half-applies is worse than one that fails. Every
   statement in 010 is IF NOT EXISTS / OR REPLACE, so a re-run is a no-op either way. */
try {
  await client.query('begin');
  await client.query(sql);
  await client.query('commit');
  console.log('APPLIED: ' + path.basename(file));
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error('FAILED (rolled back): ' + e.message);
  await client.end();
  process.exit(1);
}

const { rows: tabs } = await client.query(
  `select table_name, table_type from information_schema.tables
    where table_schema='public' order by table_type desc, table_name`);
console.log('\npublic schema now holds ' + tabs.length + ' objects:');
tabs.forEach(t => console.log('  ' + (t.table_type === 'VIEW' ? 'view ' : 'table') + '  ' + t.table_name));

try {
  const { rows } = await client.query('select * from lake_audit order by source');
  console.log('\nlake_audit — what is actually stored:');
  rows.forEach(r => console.log('  ' + String(r.source).padEnd(18) + String(r.rows).padStart(8) + ' rows   '
    + (r.first_day || '-') + ' -> ' + (r.last_day || '-')));
} catch (e) { console.log('\n(lake_audit not readable yet: ' + e.message + ')'); }

await client.end();
