#!/usr/bin/env node
/**
 * ASSEMBLE THE SERVICE'S ENVIRONMENT FROM THE SUITE'S GIT-IGNORED FILES (Spec Kit 018).
 *
 *   node scripts/env.mjs            writes wimpy-service/.env (git-ignored) with exactly the names the service reads,
 *                                   taken from ../supabase.env and ../wimpy-highlevel.env, plus a freshly generated
 *                                   CRON_SECRET (kept if .env already has one). Values are never printed.
 *   node scripts/env.mjs --vercel   additionally runs `vercel env add <NAME> production --force` for each name, the
 *                                   value piped on stdin (never on the command line, never in shell history). Needs
 *                                   `vercel login` and `vercel link` done in this folder first. --preview targets preview.
 *   node scripts/env.mjs --print    prints the names and a masked tail of each value, to check what was found.
 *
 * SUPABASE_DB_URL (the direct Postgres connection) is deliberately NOT carried over: the service speaks PostgREST only.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = path.resolve(HERE, '..');
const SUITE = path.resolve(SERVICE, '..');
const SOURCES = [path.join(SUITE, 'supabase.env'), path.join(SUITE, 'wimpy-highlevel.env')];
export const NAMES = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'WIMPY_HL_API_KEY', 'WIMPY_HL_LOCATION_ID', 'WIMPY_WEBHOOK_URL', 'CRON_SECRET'];
const OUT = path.join(SERVICE, '.env');

export function parseEnv(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function assemble({ sources = SOURCES, existing = '' } = {}) {
  const found = {};
  for (const f of sources) if (fs.existsSync(f)) Object.assign(found, parseEnv(fs.readFileSync(f, 'utf8')));
  const prev = parseEnv(existing);
  const env = {};
  for (const n of NAMES) if (found[n]) env[n] = found[n];
  env.CRON_SECRET = prev.CRON_SECRET || found.CRON_SECRET || crypto.randomBytes(32).toString('hex');
  const missing = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'].filter((n) => !env[n]);
  return { env, missing };
}

const mask = (v) => (v && v.length > 8 ? '…' + v.slice(-4) + ' (' + v.length + ' chars)' : v ? '(set)' : '(missing)');

function main(argv) {
  const { env, missing } = assemble({ existing: fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '' });
  if (missing.length) { console.error('Missing from ' + SOURCES.map((s) => path.basename(s)).join(' / ') + ': ' + missing.join(', ')); process.exit(1); }
  const lines = ['# Assembled by scripts/env.mjs on ' + new Date().toISOString() + ' — git-ignored; never commit.'];
  for (const n of NAMES) if (env[n]) lines.push(n + '=' + env[n]);
  fs.writeFileSync(OUT, lines.join('\n') + '\n', { mode: 0o600 });
  console.log('Wrote ' + OUT + ' with ' + Object.keys(env).length + ' settings: ' + Object.keys(env).join(', '));
  if (argv.includes('--print')) for (const n of NAMES) console.log('  ' + n.padEnd(22) + mask(env[n]));
  if (argv.includes('--vercel')) {
    const target = argv.includes('--preview') ? 'preview' : 'production';
    for (const n of NAMES) {
      if (!env[n]) continue;
      /* --sensitive: the value is write-only in Vercel's dashboard afterwards (security review 018 M3) */
      const r = spawnSync('vercel', ['env', 'add', n, target, '--force', '--sensitive'], { input: env[n], stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' });
      console.log((r.status === 0 ? '  set  ' : '  FAIL ') + n + ' (' + target + ')');
    }
    console.log('Now: vercel --prod');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
