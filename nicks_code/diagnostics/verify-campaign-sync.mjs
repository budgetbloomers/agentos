#!/usr/bin/env node
/**
 * verify-campaign-sync.mjs — campaigns follow the Agent List, proven.
 *
 *   node nicks_code/diagnostics/verify-campaign-sync.mjs
 *
 * Runs the REAL sync_campaigns() (migration-019, DELETE semantics since migration-020:
 * Nick, 2026-09-03 — "if it's not in the next one it must be deleted") against the REAL database inside
 * one transaction that is always rolled back — the same posture as
 * verify-agent-sync.mjs. Every scenario mutates the current list snapshot and the
 * campaigns table, and none of it lands.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const pg = (await import(pathToFileURL(path.join(HERE, 'node_modules', 'pg', 'lib', 'index.js')).href)).default;
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2];
}
let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? ' — ' + extra : '')); } };
const head = (t) => console.log('\n' + t);
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await c.connect();
const q = async (sql, args) => (await c.query(sql, args)).rows;
const sync = async (apply, extra = '') => (await q(`select sync_campaigns('verify', ${apply}${extra}) as r`))[0].r;

try {
  await c.query('begin');

  head('A · THE TABLE EXISTS AND IS SEEDED FROM THE LIST');
  const seeded = await q('select key, label, active, agents from campaigns order by key');
  const onList = await q(`select campaign_key(campaign) as key, count(*)::int as n from agent_list_current
                          where campaign_key(campaign) is not null group by 1 order by 1`);
  ok(seeded.length >= onList.length, 'every campaign on the current list has a row (' + onList.map((r) => r.key).join(', ') + ')');
  ok(onList.every((l) => seeded.some((s) => s.key === l.key && s.active && s.agents === l.n)),
    'each is active with the list\'s own head count', JSON.stringify(seeded));
  const view = await q('select key from active_campaigns');
  ok(view.length === seeded.filter((s) => s.active).length, 'active_campaigns is exactly the active rows');

  head('B · A PLAN WRITES NOTHING; A SECOND APPLY CHANGES NOTHING');
  const plan = await sync(false);
  ok(plan.status === 'PLAN' && plan.applied === false, 'plan status', JSON.stringify(plan).slice(0, 200));
  ok((plan.would_create || []).length === 0 && (plan.would_delete || []).length === 0, 'a plan against the seeded state proposes no change', JSON.stringify(plan).slice(0, 200));
  const before = await q('select count(*)::int as n, max(updated_at) as u from campaigns');
  const again = await sync(true);
  ok(again.status === 'SUCCESS' && again.created.length === 0 && again.deleted.length === 0, 'idempotent: re-applying creates and deletes nothing');
  const after = await q('select count(*)::int as n from campaigns');
  ok(after[0].n === before[0].n, 'row count unchanged (' + after[0].n + ')');

  head('C · A NEW CAMPAIGN ON THE LIST IS CREATED, NAMED, COUNTED');
  const asof = (await q('select max(as_of) as d from agent_list'))[0].d;
  await q(`update agent_list set campaign = 'Retentions' where as_of = $1 and employee_code in
           (select employee_code from agent_list where as_of = $1 order by employee_code limit 3)`, [asof]);
  const p2 = await sync(false);
  ok((p2.would_create || []).some((x) => x.key === 'retentions' && x.label === 'Retentions' && x.agents === 3),
    'the plan names the new campaign with its head count', JSON.stringify(p2.would_create));
  const s2 = await sync(true);
  ok(s2.status === 'SUCCESS' && s2.created.some((x) => x.key === 'retentions'), 'apply creates it');
  const row = (await q(`select * from campaigns where key = 'retentions'`))[0];
  ok(row && row.active && row.agents === 3 && String(row.first_seen).slice(0, 10) === String(asof).slice(0, 10),
    'the row is active, carries 3 agents and first_seen = the list date', JSON.stringify(row));
  ok((await q(`select count(*)::int as n from campaign_sync_logs where created @> '[{"key":"retentions"}]'`))[0].n === 1,
    'the creation is on the log');

  head('D · A CAMPAIGN NOBODY CARRIES IS DELETED — OFF THE LIST MEANS GONE (Nick, 2026-09-03)');
  await q(`update agent_list set campaign = 'Courtesy' where as_of = $1 and campaign = 'Retentions'`, [asof]);
  const s3 = await sync(true);
  ok(s3.deleted.some((x) => x.key === 'retentions'), 'it is deleted when no agent carries it', JSON.stringify(s3.deleted));
  ok((await q(`select count(*)::int as n from campaigns where key = 'retentions'`))[0].n === 0, 'the row is gone');
  ok(!(await q('select key from active_campaigns')).some((r) => r.key === 'retentions'), 'and so leaves active_campaigns');
  ok((await q(`select count(*)::int as n from campaign_sync_logs where deleted @> '[{"key":"retentions"}]'`))[0].n === 1,
    'the deletion is on the log — the history lives there, not in the row');

  head('E · IT COMES BACK WHEN NAMED AGAIN — A NEW ROW, FIRST_SEEN = THIS LIST');
  await q(`update agent_list set campaign = 'Retentions' where as_of = $1 and employee_code in
           (select employee_code from agent_list where as_of = $1 order by employee_code limit 2)`, [asof]);
  const s4 = await sync(true);
  ok(s4.created.some((x) => x.key === 'retentions' && x.agents === 2), 'created again with the new head count');
  const row3 = (await q(`select active, first_seen from campaigns where key = 'retentions'`))[0];
  ok(row3.active && String(row3.first_seen).slice(0, 10) === String(asof).slice(0, 10), 'first_seen is this list\x27s date');

  head('F · SPELLING: KEY IS NORMALISED, LABEL IS THE LIST\'S OWN');
  const k = await q(`select campaign_key('  Matrix   Retentions ') as a, campaign_key('matrix retentions') as b, campaign_key('   ') as c`);
  ok(k[0].a === 'matrix retentions' && k[0].a === k[0].b && k[0].c === null, 'trim, collapse, lower; blank → NULL');

  head('G · GUARDS FAIL CLOSED');
  const r1 = await sync(false, ', 1000');
  ok(r1.status === 'REFUSED' && r1.reason === 'roster_too_small', 'a short list is refused whole');
  await q(`update agent_list set campaign = null where as_of = $1`, [asof]);
  const r2 = await sync(true);
  ok(r2.status === 'REFUSED' && r2.reason === 'no_campaigns_on_list', 'a list with no campaign column is refused, nothing deleted');
  ok((await q('select count(*)::int as n from active_campaigns'))[0].n > 0, '…and the active campaigns are all still there');
  await q(`update agent_list set campaign = 'Courtesy' where as_of = $1`, [asof]);
  const r3 = await sync(true, ', 25, 1');
  ok(r3.status === 'REFUSED' && r3.reason === 'too_many_deletions', 'more than the cap going at once is refused whole', JSON.stringify(r3).slice(0, 160));
} finally {
  await c.query('rollback');
  await c.end();
}
console.log('\n' + pass + ' passed, ' + fail + ' failed  (transaction rolled back — nothing was written)');
process.exitCode = fail ? 1 : 0;
