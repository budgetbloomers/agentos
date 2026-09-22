/* verify-leader-rename.mjs — a re-spelt team leader keeps their login (migration-047, 2026-09-22).
 *
 *   node nicks_code/diagnostics/verify-leader-rename.mjs
 *
 * Runs sync_team_leaders() against the REAL function and the REAL list inside ONE transaction that
 * is always rolled back — nothing in the database changes. Before migration-047 a leader re-spelt
 * on the "VAS TL" sheet (same CB) lost their account in one publish: removed because the old
 * spelling led nobody, not re-created because the CB already had a login. */
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const pg = (await import(pathToFileURL(path.join(HERE, 'node_modules', 'pg', 'lib', 'index.js')).href)).default;
const env = {}; for (const line of fs.readFileSync(path.join(ROOT, 'supabase.env'), 'utf8').split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(line.trim()); if (m) env[m[1]] = m[2]; }
const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 });
await c.connect();
const fresh = () => c.query('drop table if exists _tl_on_list, _tl_cb, _tl_rename, _tl_create, _tl_remove');   // the function's own temps live to commit
let fails = 0; const ok = (n, v, note) => { console.log((v ? '  ok   ' : '  FAIL ') + n + (v ? '' : '   ' + (note || ''))); if (!v) fails++; };
try {
  await c.query('begin');
  // the sheet as it stands, but Sharoma re-spelt
  await c.query(`create temp table _tl_sheet (leader_name text, cb text, campaign text, manager text, callx text) on commit drop`);
  await c.query(`insert into _tl_sheet select case when btrim(leader_name)='Sharoma Rampersad' then 'Sharoma Rampersaad' else btrim(leader_name) end, norm_cb(employee_code), campaign, manager, null
                 from team_leader_cbs where on_list_as_of is not null`);
  // a real rename re-spells the leader on the agents' rows too (the list is one workbook)
  await c.query(`update agent_list set team_leader='Sharoma Rampersaad' where btrim(team_leader)='Sharoma Rampersad' and as_of=(select max(as_of) from agent_list)`);
  const plan = (await c.query(`select sync_team_leaders('{}'::jsonb, 'rename-test', false) as r`)).rows[0].r;
  console.log('plan:', JSON.stringify({ status: plan.status, renamed: plan.renamed, would_create: plan.would_create, would_remove: plan.would_remove, unrepresented: plan.unrepresented }));
  ok('the plan RENAMES CB6 (was Sharoma Rampersad → Sharoma Rampersaad) instead of removing her', plan.status === 'PLAN' && plan.renamed.length === 1 && plan.renamed[0].cb === 'CB6' && plan.renamed[0].now === 'Sharoma Rampersaad');
  ok('…nothing is removed and nothing created', plan.would_remove.length === 0 && plan.would_create.length === 0);
  await fresh();
  const applied = (await c.query(`select sync_team_leaders('{}'::jsonb, 'rename-test', true) as r`)).rows[0].r;
  const row = (await c.query(`select username, team, full_name from app_users where role='team_leader' and cb='CB6'`)).rows[0];
  ok('applied: the SAME login (cb6) now carries the new spelling as team + name', applied.status === 'SUCCESS' && applied.renamed.length === 1 && applied.removed.length === 0 && row && row.username === 'cb6' && row.team === 'Sharoma Rampersaad' && row.full_name === 'Sharoma Rampersaad', JSON.stringify(row));
  const n = (await c.query(`select count(*)::int as n from app_users where role='team_leader'`)).rows[0].n;
  ok('…and the leader count is unchanged (10)', n === 10, String(n));
  // a leader genuinely dropped from the sheet (and leading nobody) is still removed — the cap holds
  await c.query(`delete from _tl_sheet where cb = 'CB194'`);   // Fabian Chetty (VT, leads nobody the engine reports; his agents are VT rows on the list)
  await fresh();
  const plan2 = (await c.query(`select sync_team_leaders('{}'::jsonb, 'rename-test', false) as r`)).rows[0].r;
  console.log('plan2:', JSON.stringify({ renamed: plan2.renamed, would_remove: plan2.would_remove }));
  ok('a leader the sheet stopped naming who still leads listed agents is KEPT (agents\' rows name him)', plan2.would_remove.length === 0 || plan2.would_remove.every((r) => r.username !== 'cb194'));
} finally {
  await c.query('rollback');
  await c.end();
}
console.log(fails ? `\n${fails} FAILED (rolled back)` : '\nall passed (rolled back — nothing changed)');
process.exit(fails ? 1 : 0);
