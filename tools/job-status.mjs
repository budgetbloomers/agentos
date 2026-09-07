#!/usr/bin/env node
/**
 * job-status.mjs — a scheduled step reports that it ran (never-stale plan, Phase 1).
 *
 *   node tools/job-status.mjs <step> <success|failure|ok|fail> [note]
 *
 * Writes kv:jobs-status {steps:{<step>:{ranAt, ok, note}}, updatedAt} — one small legacy row
 * so GET /api/kv serves it to the Settings page directly. The Worker's sentinel raises
 * runner-never-ran while the row does not exist, runner-silent when it stops moving in
 * working hours, and verification-failed when a verify* step reports ok=false.
 */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const [step, outcome, ...rest] = process.argv.slice(2);
if (!step || !outcome) { console.error('usage: node tools/job-status.mjs <step> <success|failure> [note]'); process.exit(1); }
const ok = /^(success|ok|pass|true)$/i.test(outcome);
const cur = (await (await fetch(REST + 'rules?key=eq.kv:jobs-status&select=value', { headers: H })).json())[0];
let doc = { steps: {} };
try { const v = (cur && cur.value) || {}; doc = v.steps ? v : (v.data ? JSON.parse(v.data) : doc); } catch {}
doc.steps = doc.steps || {};
doc.steps[step] = { ranAt: new Date().toISOString(), ok, note: rest.join(' ').slice(0, 200) };
doc.updatedAt = new Date().toISOString();
const r = await fetch(REST + 'rules?on_conflict=key', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify([{ key: 'kv:jobs-status', value: { data: JSON.stringify(doc) }, updated_by: 'job-status', updated_at: doc.updatedAt }]) });
console.log('jobs-status: ' + step + ' → ' + (ok ? 'ok' : 'FAILED') + ' (' + r.status + ')');
process.exitCode = r.ok ? 0 : 1;
