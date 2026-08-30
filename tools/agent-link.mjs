#!/usr/bin/env node
/* AGENT ANALYTICS LINK — the one link agents get.
 *
 *   node tools/agent-link.mjs            show the current link (mints one if there is none)
 *   node tools/agent-link.mjs --rotate   issue a NEW key — every link already sent stops working
 *
 * You can also copy the link straight out of Agent Analytics: open /agent/ while signed
 * in and there is a "Send this to your agents" box with a Copy button. This tool is for
 * when you want it from a terminal, or need to kill every outstanding copy at once.
 *
 * RETIRED, 2026-08-24. Agent Analytics now signs people in with a CB number and a
 * password, and the Worker no longer accepts this key on any route — /api/agent-digest
 * demands a session like everything else. A link built from this key opens the sign-in
 * screen, nothing more.
 *
 * The tool is kept because rotating still does one useful thing: it invalidates the key
 * stored in the rules table, so no value that was ever handed out survives anywhere. There is no
 * longer a share box in the page to copy it from.
 *
 * Read-only unless you pass --rotate (or no key exists yet).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const SITE = 'https://chatterbox-agentos.pages.dev';
const ROTATE = process.argv.includes('--rotate');

const get = async (p) => {
  const r = await fetch(REST + p, { headers: H });
  if (!r.ok) throw new Error(`GET ${p.split('?')[0]} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

const rows = await get('rules?key=eq.agent_link_key&select=value,updated_at');
let key = rows?.[0]?.value?.key || '';
let action = 'current';

if (!key || ROTATE) {
  action = key ? 'rotated' : 'created';
  key = crypto.randomBytes(24).toString('base64url');       // 192 bits — not guessable
  const r = await fetch(REST + 'rules', {
    method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key: 'agent_link_key', value: { key, issued: new Date().toISOString() }, updated_by: 'agent-link.mjs', updated_at: new Date().toISOString() }]),
  });
  if (!r.ok) throw new Error(`could not save the key → ${r.status} ${(await r.text()).slice(0, 200)}`);
}

const link = `${SITE}/agent/?k=${key}`;
console.log('');
console.log(`  Agent Analytics link (${action})`);
console.log('  ' + '─'.repeat(Math.min(link.length, 78)));
console.log('  ' + link);
console.log('');
if (action === 'rotated') console.log('  Every previously sent link is now dead. Send this one out.\n');
else if (action === 'current') console.log('  To kill every link already sent:  node tools/agent-link.mjs --rotate\n');

/* A live link over an unpublished digest is a confusing dead end, so say so here
   rather than letting an agent be the one to find out. */
const d = await get('rules?key=eq.' + encodeURIComponent('kv:agent-digest') + '&select=updated_at');
if (!d?.length) {
  console.log('  ⚠ Nothing has been published yet, so the link will say so.');
  console.log('    Open VAS Analytics (/pulse/) signed in and leave it ~15 seconds — it');
  console.log('    publishes automatically, then refreshes every 90 seconds.\n');
} else {
  console.log(`  Agent data last published: ${d[0].updated_at}\n`);
}
