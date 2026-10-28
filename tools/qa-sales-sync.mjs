#!/usr/bin/env node
/* QA SALES SYNC — sales per agent per day, from AgentOS into the QA tool (spec 039, 2026-10-28).
 *
 *   node tools/qa-sales-sync.mjs --dry                 # what would be sent — runs the engine, writes nothing
 *   node tools/qa-sales-sync.mjs                       # send the days that changed (last 120 days)
 *   node tools/qa-sales-sync.mjs --days 365            # a wider backfill
 *   node tools/qa-sales-sync.mjs --from 2026-09-25 --to 2026-10-26
 *
 * WHY (Nick, 28 Oct): "I need the sale volumes per person … brought into the QA tool … how many sales were made
 * vs the QA evaluations … an SLA %", for Jared only. The QA tool (budgetbloomers/qa-ops) is a SEPARATE Supabase
 * project, so sales are SENT to it: one row per agent per day in its agent_sales_daily (its 08_agent_sales_daily.sql).
 *
 * WHERE THE NUMBERS COME FROM — THE ENGINE, NOT THE LAKE. The lake's bi_active_cases is missing whole days (on 28 Oct it
 * held nothing for 20–25 Oct), and the VAS sales rule is not a COUNT(DISTINCT): an uncased row is a feature line, a
 * cancelled case leaves the count, owners resolve to agents through the roster's aliases. So the deployed VAS engine is
 * booted headless (tools/digest-republish.mjs --qa-sales) and its own books are read:
 *   sales_net   cases created that day still active — what VAS counts (25 Sep – 26 Oct: Cuddle 5,153 · Courtesy 4,472 ·
 *               Training Gr 17 62, equal to VAS to the case)
 *   sales_made  sales_net + the cases created that day that later cancelled (Nick, D1: show both)
 *   campaign    the campaign the engine counted that day under (VT: the Agent List segment in force that day)
 * VT is on the roster, so it comes through too. Owners on no roster (Panimax partners) are counted and printed.
 *
 * ONLY THE DAYS THAT MOVED are sent (the lake-load delta pattern): the QA side's (cb, day) values are compared with
 * the engine's and only differing rows are upserted; a (cb, day) the engine no longer has is zeroed, never left stale.
 *
 * CREDENTIALS: the engine boots from supabase.env as digest-republish always does; the QA tool is reached with a
 * git-ignored qa-ops.env — QA_SUPABASE_URL and QA_SUPABASE_SERVICE_KEY — on the machine that runs the tick, nowhere
 * else. Without qa-ops.env a real run is SKIPPED with a note; --dry needs only the engine.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** AgentOS campaign → the QA tool's campaign key (qa-ops src/lib/data/constants.ts). Unknown = loud failure. */
export const CAMPAIGN_KEY = { Cuddle: 'matrix_cuddle', Courtesy: 'matrix_courtesy', VT: 'matrix_tracker', Nesting: 'sales_lab', 'Download & Test': 'download_test_upsell' };
export function campaignKey(c) {
  const s = String(c || '').trim();
  if (CAMPAIGN_KEY[s]) return CAMPAIGN_KEY[s];
  if (/^training\b/i.test(s)) return 'sales_lab';   // "Training Gr 17" — the nest, Nesting's successor
  return null;
}
/** 'CB123' / 'cb 123' / 'CB-0123' → 'CB-123' (the QA tool's format); anything without digits → null */
export const qaCb = (v) => { const m = /(\d+)/.exec(String(v || '')); return m ? 'CB-' + parseInt(m[1], 10) : null; };

/**
 * The engine's rows → the QA tool's rows. Pure.
 *   engine [{code, day, net, made, campaign, name}]
 * → { rows: [{cb, sale_date, sales_made, sales_net, campaign_key, agent_name}], unmapped: Set of campaigns }
 */
export function toQaRows(engine) {
  const unmapped = new Set(); const cell = new Map();
  for (const r of engine) {
    const cb = qaCb(r.code); if (!cb) continue;
    const key = campaignKey(r.campaign);
    if (!key) { unmapped.add(String(r.campaign || '(blank)')); continue; }
    const k = cb + '|' + r.day;
    const c = cell.get(k) || { cb, sale_date: r.day, sales_made: 0, sales_net: 0, campaign_key: key, agent_name: r.name || null };
    c.sales_made += Number(r.made) || 0; c.sales_net += Number(r.net) || 0;
    cell.set(k, c);
  }
  const rows = [...cell.values()].sort((a, b) => (a.sale_date + a.cb).localeCompare(b.sale_date + b.cb));
  return { rows, unmapped };
}

/** Which rows to send: new or different from what the QA tool holds; a (cb, day) only the QA side has is zeroed. Pure. */
export function rowsToSend(want, have) {
  const key = (r) => r.cb + '|' + String(r.sale_date).slice(0, 10);
  const H = new Map(have.map((r) => [key(r), r]));
  const W = new Map(want.map((r) => [key(r), r]));
  const out = [];
  for (const [k, r] of W) { const h = H.get(k);
    if (!h || h.sales_made !== r.sales_made || h.sales_net !== r.sales_net || h.campaign_key !== r.campaign_key || (h.agent_name || null) !== (r.agent_name || null)) out.push(r); }
  for (const [k, h] of H) if (!W.has(k) && (h.sales_made || h.sales_net))
    out.push({ cb: h.cb, sale_date: String(h.sale_date).slice(0, 10), sales_made: 0, sales_net: 0, campaign_key: h.campaign_key, agent_name: h.agent_name || null });
  return out;
}

const readEnv = (f) => { const p = path.join(ROOT, f); if (!fs.existsSync(p)) return {};
  return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l.trim()))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])); };

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i < 0 ? null : argv[i + 1]; };
  const DRY = argv.includes('--dry');
  const sast = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const to = flag('--to') || sast;
  const from = flag('--from') || new Date(Date.parse(to) - (Number(flag('--days')) || 120) * 864e5).toISOString().slice(0, 10);
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  if (!DAY.test(from) || !DAY.test(to) || from > to) { console.error(`FAILED: --from/--to must be YYYY-MM-DD with from ≤ to (got ${from} .. ${to})`); process.exitCode = 1; return; }
  const qa = readEnv('qa-ops.env');
  if (!DRY && (!qa.QA_SUPABASE_URL || !qa.QA_SUPABASE_SERVICE_KEY)) {
    console.log('SKIPPED — qa-ops.env (QA_SUPABASE_URL, QA_SUPABASE_SERVICE_KEY) is not configured on this machine; nothing sent. Run with --dry to see what would go.');
    return;
  }

  /* the engine's own books, via the same headless boot the digests use — written into a private temp folder (names and
     sales figures) that is removed whatever happens */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-sales-'));
  let eng;
  try {
    const tmp = path.join(dir, 'sales.json');
    const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'digest-republish.mjs'), `--qa-sales=${from}..${to}`, '--out', tmp],
      { cwd: ROOT, encoding: 'utf8', timeout: 15 * 60e3, maxBuffer: 32 * 1024 * 1024 });
    if (run.status !== 0 || !fs.existsSync(tmp)) {
      /* the tail of the engine's output, with anything token-shaped blanked — it lands in the tick log */
      const tail = String(run.stderr || run.stdout || '').trim().split('\n').slice(-3).join(' | ')
        .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]').replace(/((?:key|secret|token|password)=)[^&\s]+/gi, '$1[redacted]').slice(0, 300);
      console.error('FAILED: the engine did not produce the sales (digest-republish --qa-sales exited ' + run.status + ') — ' + tail);
      process.exitCode = 1; return;
    }
    eng = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const { rows, unmapped } = toQaRows(eng.rows || []);
  if (unmapped.size) { console.error('FAILED: campaign(s) with no QA campaign key: ' + [...unmapped].join(', ') + ' — add them to CAMPAIGN_KEY'); process.exitCode = 1; return; }

  const tot = (k) => rows.reduce((t, r) => t + r[k], 0);
  const un = Object.entries(eng.unresolved || {}).sort((a, b) => b[1] - a[1]);
  console.log(`engine ${from} → ${to}: ${rows.length} agent-days · ${tot('sales_made')} sales made · ${tot('sales_net')} net · ${new Set(rows.map((r) => r.cb)).size} agents`
    + (un.length ? `\n  owners on no Agent List (not sent): ${un.length} owner(s), ${un.reduce((t, x) => t + x[1], 0)} sales — ${un.slice(0, 5).map(([n, k]) => n + ' ' + k).join(', ')}` : ''));
  const byCamp = {};
  for (const r of rows) { const b = byCamp[r.campaign_key] = byCamp[r.campaign_key] || { made: 0, net: 0, agents: new Set() }; b.made += r.sales_made; b.net += r.sales_net; b.agents.add(r.cb); }
  for (const [k, b] of Object.entries(byCamp).sort((x, y) => y[1].net - x[1].net))
    console.log(`  ${k.padEnd(22)} ${String(b.made).padStart(6)} made · ${String(b.net).padStart(6)} net · ${b.agents.size} agents`);
  if (DRY) { console.log('--dry: nothing sent'); return; }

  const H = { apikey: qa.QA_SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + qa.QA_SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' };
  const base = qa.QA_SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/';
  const have = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${base}agent_sales_daily?select=cb,sale_date,sales_made,sales_net,campaign_key,agent_name&sale_date=gte.${from}&sale_date=lte.${to}&order=sale_date,cb&limit=1000&offset=${off}`, { headers: H });
    if (!r.ok) { console.error('FAILED: reading the QA tool\'s agent_sales_daily — HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160)); process.exitCode = 1; return; }
    const page = await r.json(); have.push(...page); if (page.length < 1000) break;
  }
  const send = rowsToSend(rows, have);
  const now = new Date().toISOString();
  for (let i = 0; i < send.length; i += 500) {
    const r = await fetch(`${base}agent_sales_daily?on_conflict=cb,sale_date`, { method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(send.slice(i, i + 500).map((x) => ({ ...x, synced_at: now }))) });
    if (!r.ok) { console.error('FAILED: upsert into agent_sales_daily — HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160)); process.exitCode = 1; return; }
  }
  const maxDay = rows.reduce((m, r) => (r.sales_made && r.sale_date > m ? r.sale_date : m), '') || null;
  const days = new Set(send.map((r) => r.sale_date)).size;
  const rec = await fetch(`${base}sales_sync_runs`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ from_day: from, to_day: to, days_sent: days, rows_upserted: send.length, max_sale_date: maxDay, note: un.length ? `${un.length} owner(s) on no Agent List` : null }) });
  if (!rec.ok) { console.error('FAILED: recording the run — HTTP ' + rec.status); process.exitCode = 1; return; }
  console.log(`sent ${send.length} row(s) over ${days} day(s); sales up to ${maxDay}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main().catch((e) => { console.error('FAILED: ' + (e && e.message || e)); process.exitCode = 1; });
