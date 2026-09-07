#!/usr/bin/env node
/**
 * reach-report.mjs — how far every source reaches, in one table (never-stale plan, Phase 4).
 *
 *   node tools/reach-report.mjs           # print
 *   node tools/reach-report.mjs --write   # also store kv:reach-report for the weekly post
 *
 * Two answers side by side: the DASHBOARDS' reach (the agent digest's dataReach stamp) and the
 * LAKE's reach (data_reach view), against the day each source should reach right now.
 */
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { expectedReachFor } = await import(pathToFileURL(path.join(ROOT, 'worker', 'src', 'health.mjs')).href);
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
const H = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const REST = env.SUPABASE_URL + '/rest/v1/';
const lake = await (await fetch(REST + 'data_reach?select=source,label,owner,reach', { headers: H })).json();
let digest = null; try { const b = await fetch(env.SUPABASE_URL + '/storage/v1/object/raw/kv/agent-digest', { headers: H }); let buf = Buffer.from(await b.arrayBuffer()); if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf); digest = JSON.parse(buf.toString()); } catch {}
const exp = expectedReachFor(Date.now());
const rows = (Array.isArray(lake) ? lake : []).map((r) => ({ source: r.source, label: r.label, owner: r.owner || '', expected: exp,
  dashboards: (digest && digest.dataReach && typeof digest.dataReach[r.source] === 'string') ? digest.dataReach[r.source] : null, lake: r.reach || null }));
console.log('expected through ' + exp + ' (SAST rule: yesterday after 13:00, no Sunday)');
console.log('source'.padEnd(12) + 'dashboards'.padEnd(13) + 'lake'.padEnd(13) + 'owner');
for (const r of rows) console.log(r.source.padEnd(12) + String(r.dashboards || '—').padEnd(13) + String(r.lake || '—').padEnd(13) + r.owner);
if (process.argv.includes('--write')) {
  const doc = { generatedAt: new Date().toISOString(), expected: exp, rows };
  const w = await fetch(REST + 'rules?on_conflict=key', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key: 'kv:reach-report', value: { data: JSON.stringify(doc) }, updated_by: 'reach-report', updated_at: doc.generatedAt }]) });
  console.log('kv:reach-report written (' + w.status + ')');
}
