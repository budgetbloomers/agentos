#!/usr/bin/env node
/* VT DB SIZE — how big the Vehicle Tracking tables are, and how fast they grow (spec 071, F4 + F6). READ-ONLY.
 *
 *   node tools/vt-db-size.mjs                      rows / MB per vt_* table + growth per business month vs plan §DB-5
 *   node tools/vt-db-size.mjs --agent-list-raw     also agent_list_raw: rows by sheet, oldest as_of, vs the 250k line (F6)
 *   node tools/vt-db-size.mjs --fixture f.json     the same report over a fixture (verify-vt-health.mjs)
 *
 * Reads with SUPABASE_DB_URL (supabase.env) through SELECTs only — no function that writes is called, no row is changed.
 * PASS when the growth of the last complete business month is ≤ 5 MB (the plan expects ≈ 2 MB a month, ≈ 27 MB steady
 * state after the 13-month trim). agent_list_raw: migration-073 (90-day retention for the hidden HR sheets) is proposed
 * ONLY past 250,000 rows — below that the answer is "not needed yet".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VT_TABLES = ['vt_cases', 'vt_case_events', 'vt_uploads', 'vt_upload_stage', 'vt_book_rev'];
export const GROWTH_PASS_BYTES = 5 * 1048576;         // plan F4: ≤ 5 MB per business month
export const PLAN_STEADY_BYTES = 27 * 1048576;        // plan §DB-5
export const ALR_RETENTION_ROWS = 250000;             // plan §DB-7.2 / F6
export const ROSTER_SHEETS = /^(vas|vt|vas tl|vt tl|team leaders?)$/i;   // sheets the roster is built from (never trimmed)

const MB = (b) => (b / 1048576).toFixed(1) + ' MB';

/** the report, pure. input = {tables:{name:{rows,bytes}}, added:{name:{'cycle-YYYY-MM':rows}}, lastComplete, agentListRaw:[{sheet,rows,oldest,days}]} */
export function assess(input) {
  const T = (input && input.tables) || {};
  const total = VT_TABLES.reduce((s, k) => s + (Number(T[k] && T[k].bytes) || 0), 0);
  const lc = input && input.lastComplete;
  let growth = 0; const per = [];
  for (const k of VT_TABLES) {
    const rows = Number(T[k] && T[k].rows) || 0, bytes = Number(T[k] && T[k].bytes) || 0;
    const add = lc && input.added && input.added[k] ? Number(input.added[k][lc]) || 0 : 0;
    const g = rows > 0 ? Math.round(bytes / rows * add) : 0;
    growth += g;
    per.push({ table: k, rows, bytes, addedLastCycle: add, growthBytes: g });
  }
  const growthVerdict = !lc ? 'NO COMPLETE MONTH YET' : growth <= GROWTH_PASS_BYTES ? 'PASS' : 'WARN';
  const alr = Array.isArray(input && input.agentListRaw) ? input.agentListRaw : null;
  const alrTotal = alr ? alr.reduce((s, r) => s + (Number(r.rows) || 0), 0) : null;
  const hidden = alr ? alr.filter((r) => !ROSTER_SHEETS.test(String(r.sheet || '').trim())).reduce((s, r) => s + (Number(r.rows) || 0), 0) : null;
  const alrVerdict = alr == null ? null : alrTotal > ALR_RETENTION_ROWS ? 'PROPOSE migration-073' : 'not needed yet';
  return { totalBytes: total, overPlan: total > PLAN_STEADY_BYTES, per, lastComplete: lc || null, growthBytes: growth, growthVerdict, alrTotal, alrHidden: hidden, alrVerdict, agentListRaw: alr };
}

export function render(r) {
  const L = ['Vehicle Tracking tables (vt_*)'];
  for (const p of r.per) L.push(`  ${p.table.padEnd(16)} ${String(p.rows).padStart(8)} rows  ${MB(p.bytes).padStart(9)}` + (r.lastComplete ? `   +${p.addedLastCycle} rows in ${r.lastComplete} ≈ ${MB(p.growthBytes)}` : ''));
  L.push(`  total ${MB(r.totalBytes)} (plan steady state ≈ ${MB(PLAN_STEADY_BYTES)}${r.overPlan ? ' — OVER the plan' : ''})`);
  L.push(`  growth in the last complete business month: ${r.lastComplete ? MB(r.growthBytes) : '—'} → ${r.growthVerdict} (limit ${MB(GROWTH_PASS_BYTES)})`);
  if (r.agentListRaw) {
    L.push('', 'agent_list_raw (every row of every sheet of every Agent List, one copy per as_of day)');
    for (const s of r.agentListRaw) L.push(`  ${String(s.sheet || '(none)').padEnd(16)} ${String(s.rows).padStart(8)} rows  oldest ${s.oldest || '—'}  ${s.days != null ? s.days + ' list day(s)' : ''}`);
    L.push(`  total ${r.alrTotal} rows (${r.alrHidden} on sheets the roster is not built from) — line ${ALR_RETENTION_ROWS} → ${r.alrVerdict}`);
  }
  return L.join('\n');
}

/** the measurement, over any client with query(text, params) → {rows} (pg in production, PGlite in the suite). SELECTs only,
    inside a READ ONLY transaction that is rolled back. */
export async function readFrom(c, withAlr, today = null) {
  await c.query('begin read only');
  try {
    const tables = {};
    for (const t of VT_TABLES) {
      const r = await c.query(`select count(*)::int as rows, pg_total_relation_size('${t}')::bigint as bytes from ${t}`);
      tables[t] = { rows: Number(r.rows[0].rows), bytes: Number(r.rows[0].bytes) };
    }
    const cyc = (col) => `to_char(case when extract(day from ${col}) >= 26 then ${col} + interval '1 month' else ${col} end, '"cycle-"YYYY-MM')`;
    const map = async (q) => Object.fromEntries((await c.query(q)).rows.map((x) => [x.k, Number(x.n)]));
    const added = {
      vt_cases: await map(`select ${cyc('first_seen')} k, count(*)::int n from vt_cases group by 1`),
      vt_case_events: await map(`select ${cyc('on_date')} k, count(*)::int n from vt_case_events group by 1`),
      vt_uploads: await map(`select cycle_key k, count(*)::int n from vt_uploads group by 1`),
    };
    const d = today || String((await c.query(`select ((now() at time zone 'Africa/Johannesburg')::date)::text d`)).rows[0].d);
    const prev = (await c.query(`select ${cyc(`(date '${d.slice(0, 10)}' - interval '1 month')::date`)} k`)).rows[0].k;
    let agentListRaw = null;
    if (withAlr) agentListRaw = (await c.query(`select sheet, count(*)::int as rows, min(as_of)::text as oldest, count(distinct as_of)::int as days from agent_list_raw group by sheet order by 2 desc`)).rows
      .map((x) => ({ sheet: x.sheet, rows: Number(x.rows), oldest: x.oldest, days: Number(x.days) }));
    return { tables, added, lastComplete: prev, agentListRaw };
  } finally { await c.query('rollback').catch(() => {}); }
}

async function readLive(withAlr) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]));
  const { default: pg } = await import(pathToFileURL(path.join(ROOT, 'nicks_code', 'diagnostics', 'node_modules', 'pg', 'lib', 'index.js')).href);
  const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
  await c.connect();
  try { return await readFrom(c, withAlr); } finally { await c.end(); }
}

async function main(argv) {
  const fi = argv.indexOf('--fixture');
  const input = fi > -1 ? JSON.parse(fs.readFileSync(path.resolve(argv[fi + 1] || ''), 'utf8')) : await readLive(argv.includes('--agent-list-raw'));
  const r = assess(input);
  console.log(render(r));
  return r.growthVerdict === 'WARN' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
